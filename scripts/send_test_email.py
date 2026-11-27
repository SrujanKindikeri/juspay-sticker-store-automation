import sys
import os
import smtplib
from email.message import EmailMessage
from email.utils import formataddr, make_msgid

# Add backend directory to module search path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

from app.core.config import settings

RECIPIENT = "lifeflow4u.support@gmail.com"
SUBJECT = "Stickora Store - Email Delivery Test"
BODY_TEXT = """Hello,

This is a test email from the Stickora Store application.

We are checking whether our email delivery system is working correctly.

If you received this message, email delivery is working.

Regards,
Stickora Store"""

BODY_HTML = """<!DOCTYPE html>
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background:#f5f5f7; padding:24px; color:#1d1d1f;">
  <div style="max-width:520px; margin:0 auto; background:#ffffff; border-radius:16px; padding:28px; border:1px solid #e5e7eb;">
    <div style="font-size:12px; font-weight:700; color:#0071e3; letter-spacing:0.05em; text-transform:uppercase;">Stickora · Store System</div>
    <h2 style="margin:8px 0 16px; font-size:20px; color:#111827;">Email Delivery Test</h2>
    <p style="font-size:14px; color:#374151; line-height:1.6; margin:0 0 12px;">Hello,</p>
    <p style="font-size:14px; color:#374151; line-height:1.6; margin:0 0 12px;">This is a test email from the Stickora Store application.</p>
    <p style="font-size:14px; color:#374151; line-height:1.6; margin:0 0 12px;">We are checking whether our email delivery system is working correctly.</p>
    <p style="font-size:14px; color:#374151; line-height:1.6; margin:0 0 16px;">If you received this message, email delivery is working.</p>
    <p style="font-size:14px; color:#374151; line-height:1.6; margin:0;">Regards,<br><strong>Stickora Store</strong></p>
    <hr style="border:none; border-top:1px solid #e5e7eb; margin:24px 0 16px;" />
    <p style="font-size:11px; color:#86868b; margin:0;">Stickora Store Email Delivery Verification · Automated Diagnostic Message</p>
  </div>
</body>
</html>"""

def run_test():
    print("=" * 72)
    print("  STICKORA STORE — EMAIL DELIVERY TEST")
    print(f"  Recipient : {RECIPIENT}")
    print(f"  Subject   : {SUBJECT}")
    print("=" * 72)
    print()

    # Step 1: Validate SMTP configuration
    config_pass = False
    connection_pass = False
    sending_request_pass = False
    server_acceptance_pass = False
    message_id = None
    exact_error = None

    print("▶ Step 1: Inspecting SMTP Configuration...")
    if not settings.smtp_host or not settings.smtp_port or not settings.smtp_from_email:
        exact_error = "Incomplete SMTP configuration: host, port, or from_email missing"
        print(f"  ❌ {exact_error}")
    elif not settings.smtp_username or not settings.smtp_password:
        exact_error = "SMTP credentials missing: username or password not provided"
        print(f"  ❌ {exact_error}")
    else:
        config_pass = True
        print(f"  ✓ SMTP Host       : {settings.smtp_host}")
        print(f"  ✓ SMTP Port       : {settings.smtp_port}")
        print(f"  ✓ SMTP TLS Active : {settings.smtp_use_tls}")
        print(f"  ✓ SMTP Sender     : {settings.smtp_from_name} <{settings.smtp_from_email}>")
        print(f"  ✓ Credentials     : Configured (Password hidden)")

    if not config_pass:
        print_report(config_pass, connection_pass, sending_request_pass, server_acceptance_pass, message_id, exact_error)
        sys.exit(1)

    print()
    print("▶ Step 2: Testing SMTP Connection & TLS Handshake...")
    server = None
    try:
        if settings.smtp_use_ssl:
            server = smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=15)
            server.ehlo()
        else:
            server = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15)
            server.ehlo()
            if settings.smtp_use_tls:
                server.starttls()
                server.ehlo()

        # Authenticate
        server.login(settings.smtp_username, settings.smtp_password)
        connection_pass = True
        print(f"  ✓ Successfully connected and authenticated to {settings.smtp_host}:{settings.smtp_port}")
    except Exception as exc:
        exact_error = f"{type(exc).__name__}: {str(exc)}"
        print(f"  ❌ Connection/Authentication failed: {exact_error}")
        if server:
            try:
                server.close()
            except Exception:
                pass
        print_report(config_pass, connection_pass, sending_request_pass, server_acceptance_pass, message_id, exact_error)
        sys.exit(1)

    print()
    print("▶ Step 3: Preparing & Dispatching Exactly ONE Test Email...")
    try:
        msg = EmailMessage()
        msg["Subject"] = SUBJECT
        msg["From"] = formataddr((settings.smtp_from_name, settings.smtp_from_email))
        msg["To"] = RECIPIENT

        # Generate standard RFC 5322 Message-ID
        message_id = make_msgid(domain=settings.smtp_host)
        msg["Message-ID"] = message_id

        msg.set_content(BODY_TEXT)
        msg.add_alternative(BODY_HTML, subtype="html")

        sending_request_pass = True
        print(f"  ✓ Email message constructed.")
        print(f"  ✓ Message-ID: {message_id}")

        # Send via active authenticated SMTP connection
        refused = server.send_message(msg)

        if len(refused) == 0:
            server_acceptance_pass = True
            print(f"  ✓ SMTP Server accepted message for recipient: {RECIPIENT}")
        else:
            server_acceptance_pass = False
            exact_error = f"Recipient refused by SMTP server: {refused}"
            print(f"  ❌ {exact_error}")

    except Exception as exc:
        exact_error = f"{type(exc).__name__}: {str(exc)}"
        print(f"  ❌ Send failed: {exact_error}")
    finally:
        try:
            server.quit()
        except Exception:
            try:
                server.close()
            except Exception:
                pass

    print()
    print_report(config_pass, connection_pass, sending_request_pass, server_acceptance_pass, message_id, exact_error)

    if not server_acceptance_pass:
        sys.exit(1)

def print_report(config_pass, connection_pass, sending_request_pass, server_acceptance_pass, message_id, exact_error):
    print("=" * 72)
    print("  STICKORA STORE — EMAIL DELIVERY VERIFICATION REPORT")
    print("=" * 72)
    print(f"- SMTP configuration: {'PASS' if config_pass else 'FAIL'}")
    print(f"- SMTP connection: {'PASS' if connection_pass else 'FAIL'}")
    print(f"- Email sending request: {'PASS' if sending_request_pass else 'FAIL'}")
    print(f"- SMTP server acceptance: {'PASS' if server_acceptance_pass else 'FAIL'}")
    print(f"- Message ID: {message_id if message_id else 'None'}")
    print(f"- Exact error: {exact_error if exact_error else 'None'}")
    print("=" * 72)
    print()
    if server_acceptance_pass:
        print("Note: The SMTP server (Google smtp.gmail.com) has successfully accepted")
        print("the email message for onward delivery to lifeflow4u.support@gmail.com.")
        print("This confirms server acceptance. Inbox delivery depends on recipient mailbox filtering.")
    print()

if __name__ == "__main__":
    run_test()

