#!/usr/bin/env python3
"""
Gmail OTP Retrieval Service for Stickora Customer Journey
Securely connects to Gmail IMAP via SSL, searches for Stickora Email Verification OTPs,
extracts the 6-digit code without exposing it in plaintext logs, and returns JSON.
"""

import sys
import os
import re
import time
import json
import email
import imaplib
import argparse
from email.header import decode_header
from email.utils import parsedate_to_datetime
from datetime import datetime, timezone

def load_credentials():
    env_path = os.path.join(os.path.dirname(__file__), '..', '.env')
    smtp_user = "lifeflow4u.support@gmail.com"
    smtp_pass = None

    if os.path.exists(env_path):
        with open(env_path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#'):
                    continue
                if '=' in line:
                    k, v = line.split('=', 1)
                    k = k.strip()
                    v = v.strip().strip("'\"")
                    if k == 'SMTP_USERNAME':
                        smtp_user = v
                    elif k == 'SMTP_PASSWORD':
                        smtp_pass = v

    return smtp_user, smtp_pass

def decode_mime_header(header_value):
    if not header_value:
        return ""
    decoded_parts = decode_header(header_value)
    result = ""
    for part, enc in decoded_parts:
        if isinstance(part, bytes):
            result += part.decode(enc or 'utf-8', errors='ignore')
        else:
            result += part
    return result

def extract_otp_from_body(body):
    # Match patterns in Stickora email template:
    # 1. "Your email verification code is: 123456"
    # 2. HTML: font-weight:800; ... >123456</span>
    # 3. "code is: 123456"
    patterns = [
        r'verification code is:\s*(\d{6})\b',
        r'code is:\s*(\d{6})\b',
        r'font-weight:800[^>]*>\s*(\d{6})\s*</span>',
        r'\b(\d{6})\b'
    ]
    for pattern in patterns:
        m = re.search(pattern, body, re.IGNORECASE)
        if m:
            return m.group(1)
    return None

def fetch_latest_otp(recipient, min_timestamp=None, exclude_ids=None, exclude_otps=None, timeout_seconds=90, poll_interval=3):
    username, password = load_credentials()
    if not username or not password:
        return {
            "success": False,
            "error": "Gmail credentials (SMTP_USERNAME/SMTP_PASSWORD) not found in .env"
        }

    exclude_ids = set(exclude_ids or [])
    exclude_otps = set(exclude_otps or [])
    start_time = time.time()
    last_error = None

    while time.time() - start_time <= timeout_seconds:
        mail = None
        try:
            mail = imaplib.IMAP4_SSL("imap.gmail.com", 993)
            mail.login(username, password)
            
            # Select '[Gmail]/All Mail' (or INBOX if All Mail unavailable)
            try:
                mail.select('"[Gmail]/All Mail"', readonly=True)
            except Exception:
                mail.select("INBOX", readonly=True)
            
            # Fast IMAP search specifically for Stickora messages
            status, messages = mail.search(None, 'SUBJECT', 'Stickora')
            if status != 'OK' or not messages[0]:
                status, messages = mail.search(None, 'ALL')

            if status == 'OK' and messages[0]:
                msg_ids = messages[0].split()
                # Inspect newest first
                recent_ids = list(msg_ids)
                recent_ids.reverse()

                for mid in recent_ids:
                    mid_str = mid.decode()
                    if mid_str in exclude_ids:
                        continue

                    # Fetch headers first
                    res, data = mail.fetch(mid, '(RFC822.HEADER)')
                    if res != 'OK' or not data or not data[0]:
                        continue

                    header_bytes = data[0][1]
                    msg_header = email.message_from_bytes(header_bytes)
                    subject = decode_mime_header(msg_header.get("Subject", ""))
                    to_addr = decode_mime_header(msg_header.get("To", ""))
                    from_addr = decode_mime_header(msg_header.get("From", ""))
                    date_str = msg_header.get("Date", "")
                    message_id = msg_header.get("Message-ID", mid_str)

                    # Filter for Stickora verification emails
                    is_stickora_subj = "stickora" in subject.lower() and "verify" in subject.lower()
                    if not is_stickora_subj:
                        continue

                    # Filter recipient if specified
                    if recipient and recipient.lower() not in to_addr.lower() and recipient.lower() not in from_addr.lower():
                        continue

                    # Filter timestamp if specified
                    if min_timestamp:
                        try:
                            msg_dt = parsedate_to_datetime(date_str)
                            msg_epoch = msg_dt.timestamp()
                            # Allow 30 seconds clock skew
                            if msg_epoch < (min_timestamp - 30):
                                continue
                        except Exception:
                            pass

                    # Fetch full body
                    res_body, body_data = mail.fetch(mid, '(RFC822)')
                    if res_body != 'OK' or not body_data:
                        continue

                    full_msg = email.message_from_bytes(body_data[0][1])
                    body = ""
                    if full_msg.is_multipart():
                        for part in full_msg.walk():
                            ctype = part.get_content_type()
                            if ctype in ["text/plain", "text/html"]:
                                payload = part.get_payload(decode=True)
                                if payload:
                                    body += payload.decode('utf-8', errors='ignore')
                    else:
                        payload = full_msg.get_payload(decode=True)
                        if payload:
                            body = payload.decode('utf-8', errors='ignore')

                    otp = extract_otp_from_body(body)
                    if not otp:
                        continue

                    if otp in exclude_otps:
                        continue

                    mail.logout()
                    return {
                        "success": True,
                        "otp": otp,
                        "message_id": message_id,
                        "imap_id": mid_str,
                        "subject": subject,
                        "date": date_str,
                        "to": to_addr,
                        "from": from_addr
                    }

            mail.logout()
        except Exception as e:
            last_error = str(e)
            if mail:
                try:
                    mail.logout()
                except Exception:
                    pass

        # Wait before next poll
        remaining = timeout_seconds - (time.time() - start_time)
        if remaining > 0:
            time.sleep(min(poll_interval, remaining))

    return {
        "success": False,
        "error": last_error or f"Timeout after {timeout_seconds}s waiting for OTP email"
    }

def main():
    parser = argparse.ArgumentParser(description="Retrieve latest Stickora Email Verification OTP via Gmail")
    parser.add_argument("--recipient", default="lifeflow4u.support@gmail.com", help="Expected recipient email")
    parser.add_argument("--min-timestamp", type=float, default=None, help="Epoch timestamp for message receipt threshold")
    parser.add_argument("--exclude-ids", nargs="*", default=[], help="Message IDs to ignore")
    parser.add_argument("--exclude-otps", nargs="*", default=[], help="Previously seen OTP values to ignore")
    parser.add_argument("--timeout", type=int, default=90, help="Max wait seconds")
    parser.add_argument("--interval", type=int, default=3, help="Polling interval seconds")
    args = parser.parse_args()

    result = fetch_latest_otp(
        recipient=args.recipient,
        min_timestamp=args.min_timestamp,
        exclude_ids=args.exclude_ids,
        exclude_otps=args.exclude_otps,
        timeout_seconds=args.timeout,
        poll_interval=args.interval
    )

    # Print only single-line JSON to stdout
    print(json.dumps(result))
    if not result.get("success"):
        sys.exit(1)

if __name__ == "__main__":
    main()
