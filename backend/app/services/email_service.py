import html
import logging
import smtplib
import time
from datetime import datetime
from email.message import EmailMessage
from email.utils import formataddr
from typing import Optional, Tuple
from sqlalchemy.orm import Session
from app.core.config import settings
from app.models.store import StoreOrder, StoreOrderItem, CustomerDelivery
from app.models.payment import PaymentTransaction
from app.services.pdf_receipt_service import generate_order_receipt_pdf

logger = logging.getLogger("juspay.email")


def _mask_email(email: str) -> str:
    if "@" not in email:
        return "***"
    local, domain = email.split("@", 1)
    prefix = local[:2] if len(local) >= 2 else local[:1]
    return f"{prefix}***@{domain}"


def _send_smtp_email(
    to_email: str,
    subject: str,
    text_body: str,
    html_body: str,
    pdf_attachment: Optional[Tuple[str, bytes]] = None,
) -> None:
    """
    Sends an email message via configured SMTP settings with automatic transient retry handling.
    Never logs passwords or sensitive credentials.
    """
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = formataddr((settings.smtp_from_name, settings.smtp_from_email))
    msg["To"] = to_email
    msg.set_content(text_body)
    msg.add_alternative(html_body, subtype="html")

    if pdf_attachment:
        filename, pdf_bytes = pdf_attachment
        msg.add_attachment(
            pdf_bytes,
            maintype="application",
            subtype="pdf",
            filename=filename,
        )

    max_attempts = max(1, settings.email_max_retries)
    last_exc: Optional[Exception] = None

    for attempt in range(1, max_attempts + 1):
        try:
            if settings.smtp_use_ssl:
                with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=10) as server:
                    server.ehlo()
                    if settings.smtp_username and settings.smtp_password and server.has_extn("auth"):
                        server.login(settings.smtp_username, settings.smtp_password)
                    server.send_message(msg)
            else:
                with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as server:
                    server.ehlo()
                    if settings.smtp_use_tls:
                        server.starttls()
                        server.ehlo()
                    if settings.smtp_username and settings.smtp_password and server.has_extn("auth"):
                        server.login(settings.smtp_username, settings.smtp_password)
                    server.send_message(msg)
            return
        except (smtplib.SMTPException, OSError, TimeoutError) as exc:
            last_exc = exc
            logger.warning(
                f"SMTP delivery attempt {attempt}/{max_attempts} failed for {_mask_email(to_email)}: {type(exc).__name__}"
            )
            if attempt < max_attempts:
                time.sleep(0.25 * attempt)

    raise RuntimeError(f"SMTP delivery failed after {max_attempts} attempt(s): {type(last_exc).__name__}")


def send_email_verification_otp_email(to_email: str, otp_code: str, expires_minutes: int) -> None:
    """
    Sends the customer email verification 6-digit OTP email.
    Note: Plaintext OTP is delivered strictly to the SMTP transport and NEVER logged.
    """
    subject = "Stickora — Verify Your Email Address"
    text_body = (
        f"Stickora — Premium Vinyl Stickers\n\n"
        f"Your email verification code is: {otp_code}\n\n"
        f"This code expires in {expires_minutes} minutes.\n"
        f"If you did not request this verification code, please ignore this email.\n\n"
        f"Educational payment simulation — no real money transferred."
    )
    html_body = f"""
    <!DOCTYPE html>
    <html>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background:#f5f5f7; padding:24px; color:#1d1d1f;">
      <div style="max-width:520px; margin:0 auto; background:#ffffff; border-radius:16px; padding:28px; border:1px solid #e5e7eb;">
        <div style="font-size:12px; font-weight:700; color:#0071e3; letter-spacing:0.05em; text-transform:uppercase;">Stickora · Premium Vinyl Stickers</div>
        <h2 style="margin:8px 0 12px; font-size:20px;">Verify Your Email Address</h2>
        <p style="font-size:14px; color:#515154; line-height:1.5;">
          Enter the 6-digit verification code below on the Stickora delivery checkout page to confirm your email address:
        </p>
        <div style="margin:20px 0; padding:16px; background:#f5f5f7; border-radius:12px; text-align:center;">
          <span style="font-size:30px; font-weight:800; letter-spacing:8px; font-family:monospace; color:#1d1d1f;">{html.escape(otp_code)}</span>
        </div>
        <p style="font-size:13px; color:#6e6e73;">This verification code expires in <strong>{expires_minutes} minutes</strong> and allows up to 3 verification attempts.</p>
        <hr style="border:none; border-top:1px solid #e5e7eb; margin:20px 0;" />
        <p style="font-size:11px; color:#86868b; margin:0;">Educational payment simulation — no real money transferred.</p>
      </div>
    </body>
    </html>
    """
    _send_smtp_email(
        to_email=to_email,
        subject=subject,
        text_body=text_body,
        html_body=html_body,
    )


def _build_confirmation_email_bodies(
    order: StoreOrder,
    items: list[StoreOrderItem],
    delivery: Optional[CustomerDelivery],
    transaction: PaymentTransaction,
) -> Tuple[str, str]:
    customer_name = delivery.full_name if delivery else order.customer_name
    customer_email = delivery.email if delivery else order.customer_email
    order_dt = (transaction.finalized_at or order.updated_at or order.created_at).strftime(
        "%Y-%m-%d %H:%M:%S UTC"
    )
    delivery_fee_str = "FREE" if order.delivery_fee == 0 else f"₹{order.delivery_fee:.2f}"

    address_summary = (
        f"{delivery.full_name}, {delivery.address_line}, {delivery.city}, {delivery.state} - {delivery.pincode} (Phone: {delivery.mobile_number})"
        if delivery
        else "Digital / Standard Dispatch"
    )

    item_text_lines = "\n".join(
        f"  - {it.product_name} | Qty: {it.quantity} | Unit: ₹{it.unit_price:.2f} | Total: ₹{it.total_price:.2f}"
        for it in items
    )

    text_body = (
        f"Your Juspay Sticker Store Order Confirmation\n"
        f"Stickora — Premium Vinyl Stickers\n\n"
        f"Hello {customer_name},\n\n"
        f"Thank you for your order! Your payment has been verified and confirmed.\n\n"
        f"Order ID: {order.order_id}\n"
        f"Transaction ID: {transaction.transaction_id}\n"
        f"Payment Reference: {transaction.payment_reference}\n"
        f"Customer Email: {customer_email}\n"
        f"Order Date & Time: {order_dt}\n"
        f"Payment Method: {transaction.payment_method}\n"
        f"Payment Status: {transaction.status}\n"
        f"Order Status: {order.status}\n\n"
        f"Purchased Products:\n{item_text_lines}\n\n"
        f"Subtotal: ₹{order.subtotal:.2f}\n"
        f"Delivery Charges: {delivery_fee_str}\n"
        f"Final Amount Paid: ₹{order.total_amount:.2f} {order.currency}\n\n"
        f"Delivery Address Summary:\n  {address_summary}\n\n"
        f"Your official PDF payment receipt is attached to this email.\n"
        f"Educational payment simulation — no real money transferred.\n"
    )

    item_html_rows = "".join(
        f"""
        <tr>
          <td style="padding:10px 8px; border-bottom:1px solid #e5e7eb;">{html.escape(it.product_name)}</td>
          <td style="padding:10px 8px; border-bottom:1px solid #e5e7eb; text-align:center;">{it.quantity}</td>
          <td style="padding:10px 8px; border-bottom:1px solid #e5e7eb; text-align:right;">₹{it.unit_price:.2f}</td>
          <td style="padding:10px 8px; border-bottom:1px solid #e5e7eb; text-align:right; font-weight:600;">₹{it.total_price:.2f}</td>
        </tr>
        """
        for it in items
    )

    html_body = f"""
    <!DOCTYPE html>
    <html>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background:#f5f5f7; padding:24px; color:#1d1d1f;">
      <div style="max-width:640px; margin:0 auto; background:#ffffff; border-radius:18px; padding:32px; border:1px solid #e5e7eb;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
          <span style="font-size:12px; font-weight:700; color:#0071e3; text-transform:uppercase; letter-spacing:0.05em;">Stickora · Premium Vinyl Stickers</span>
          <span style="background:#ecfdf5; color:#047857; border:1px solid #a7f3d0; padding:4px 10px; border-radius:9999px; font-size:12px; font-weight:700;">PAID</span>
        </div>

        <h1 style="margin:0 0 8px; font-size:22px; color:#1d1d1f;">Your Juspay Sticker Store Order Confirmation</h1>
        <p style="font-size:14px; color:#515154; margin:0 0 20px;">
          Hello <strong>{html.escape(customer_name)}</strong>, your payment has been verified and confirmed. Your PDF receipt is attached.
        </p>

        <div style="background:#f5f5f7; border-radius:12px; padding:16px; margin-bottom:20px; font-size:13px;">
          <table style="width:100%; border-collapse:collapse;">
            <tr><td style="padding:4px 0; color:#6e6e73;">Order ID</td><td style="padding:4px 0; font-weight:700; text-align:right;">{html.escape(order.order_id)}</td></tr>
            <tr><td style="padding:4px 0; color:#6e6e73;">Payment Transaction ID</td><td style="padding:4px 0; font-weight:700; text-align:right;">{html.escape(transaction.transaction_id)}</td></tr>
            <tr><td style="padding:4px 0; color:#6e6e73;">Customer Email</td><td style="padding:4px 0; text-align:right;">{html.escape(customer_email)}</td></tr>
            <tr><td style="padding:4px 0; color:#6e6e73;">Order Date &amp; Time</td><td style="padding:4px 0; text-align:right;">{html.escape(order_dt)}</td></tr>
            <tr><td style="padding:4px 0; color:#6e6e73;">Payment Method</td><td style="padding:4px 0; font-weight:600; text-align:right;">{html.escape(transaction.payment_method)}</td></tr>
            <tr><td style="padding:4px 0; color:#6e6e73;">Payment Status</td><td style="padding:4px 0; font-weight:700; color:#047857; text-align:right;">{html.escape(transaction.status)}</td></tr>
            <tr><td style="padding:4px 0; color:#6e6e73;">Order Status</td><td style="padding:4px 0; font-weight:700; color:#047857; text-align:right;">{html.escape(order.status)}</td></tr>
          </table>
        </div>

        <h3 style="font-size:15px; margin:0 0 10px;">Purchased Stickers</h3>
        <table style="width:100%; border-collapse:collapse; font-size:13px; margin-bottom:16px;">
          <thead>
            <tr style="background:#1d1d1f; color:#ffffff;">
              <th style="padding:9px 8px; text-align:left;">Sticker</th>
              <th style="padding:9px 8px; text-align:center;">Qty</th>
              <th style="padding:9px 8px; text-align:right;">Unit Price</th>
              <th style="padding:9px 8px; text-align:right;">Total</th>
            </tr>
          </thead>
          <tbody>
            {item_html_rows}
          </tbody>
        </table>

        <div style="border-top:1px solid #e5e7eb; padding-top:12px; margin-bottom:20px; font-size:14px;">
          <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
            <span style="color:#515154;">Subtotal</span>
            <span>₹{order.subtotal:.2f}</span>
          </div>
          <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
            <span style="color:#515154;">Delivery Charges</span>
            <span>{delivery_fee_str}</span>
          </div>
          <div style="display:flex; justify-content:space-between; font-size:16px; font-weight:800; color:#1d1d1f; margin-top:8px;">
            <span>Final Amount Paid</span>
            <span>₹{order.total_amount:.2f} {html.escape(order.currency)}</span>
          </div>
        </div>

        <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:12px 14px; font-size:13px; margin-bottom:20px;">
          <strong style="display:block; margin-bottom:4px;">Delivery Address Summary</strong>
          <span style="color:#475569;">{html.escape(address_summary)}</span>
        </div>

        <p style="font-size:11px; color:#86868b; margin:0;">
          Educational payment simulation — no real money transferred.
        </p>
      </div>
    </body>
    </html>
    """
    return text_body, html_body


def send_order_confirmation_email(db: Session, order_id: str) -> Optional[StoreOrder]:
    """
    Sends the authoritative HTML order confirmation + PDF receipt email ONLY after
    backend-confirmed SUCCESS payment and PAID order status.
    - Guarantees idempotency (never sends duplicates if receipt_email_status == 'SENT').
    - Never rolls back a successful payment if SMTP fails; records FAILED status and attempts safely.
    """
    order = (
        db.query(StoreOrder)
        .filter(StoreOrder.order_id == order_id)
        .with_for_update()
        .first()
    )
    if not order:
        return None

    # Strict lifecycle gate: only PAID orders with verified SUCCESS payment get a receipt
    if order.status != "PAID" or not order.payment_transaction_id:
        return order

    # Duplicate email protection
    if order.receipt_email_status == "SENT":
        return order

    txn = (
        db.query(PaymentTransaction)
        .filter(PaymentTransaction.transaction_id == order.payment_transaction_id)
        .first()
    )
    if not txn or txn.status != "SUCCESS":
        return order

    items = db.query(StoreOrderItem).filter(StoreOrderItem.order_id == order.order_id).all()
    delivery = db.query(CustomerDelivery).filter(CustomerDelivery.order_id == order.order_id).first()
    recipient_email = delivery.email if delivery else order.customer_email

    now = datetime.utcnow()
    order.receipt_email_attempts += 1
    order.receipt_email_last_attempt_at = now

    try:
        pdf_bytes = generate_order_receipt_pdf(
            order=order,
            items=items,
            delivery=delivery,
            transaction=txn,
        )
        text_body, html_body = _build_confirmation_email_bodies(
            order=order,
            items=items,
            delivery=delivery,
            transaction=txn,
        )
        _send_smtp_email(
            to_email=recipient_email,
            subject="Your Juspay Sticker Store Order Confirmation",
            text_body=text_body,
            html_body=html_body,
            pdf_attachment=(f"Stickora-Receipt-{order.order_id}.pdf", pdf_bytes),
        )
        order.receipt_email_status = "SENT"
        order.receipt_email_sent_at = datetime.utcnow()
        order.receipt_email_last_error = None
        logger.info(f"Confirmation email with PDF receipt sent for order {order.order_id} to {_mask_email(recipient_email)}")
    except Exception as exc:
        order.receipt_email_status = "FAILED"
        order.receipt_email_last_error = f"Email delivery error ({type(exc).__name__})"
        logger.error(f"Failed to send receipt email for order {order.order_id}: {type(exc).__name__}")

    db.commit()
    db.refresh(order)
    return order
