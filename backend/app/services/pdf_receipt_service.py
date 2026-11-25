from io import BytesIO
from typing import List, Optional
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
from app.models.store import StoreOrder, StoreOrderItem, CustomerDelivery
from app.models.payment import PaymentTransaction


def generate_order_receipt_pdf(
    order: StoreOrder,
    items: List[StoreOrderItem],
    delivery: Optional[CustomerDelivery],
    transaction: PaymentTransaction,
) -> bytes:
    """
    Generates an authoritative PDF payment receipt strictly from verified PostgreSQL
    StoreOrder, StoreOrderItem, CustomerDelivery, and PaymentTransaction records.
    """
    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=18 * mm,
        leftMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
        title=f"Stickora Receipt - {order.order_id}",
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "ReceiptTitle",
        parent=styles["Heading1"],
        fontSize=18,
        textColor=colors.HexColor("#1d1d1f"),
        spaceAfter=4,
    )
    subtitle_style = ParagraphStyle(
        "ReceiptSubtitle",
        parent=styles["Normal"],
        fontSize=10,
        textColor=colors.HexColor("#515154"),
        spaceAfter=10,
    )
    section_heading = ParagraphStyle(
        "SectionHeading",
        parent=styles["Heading2"],
        fontSize=11,
        textColor=colors.HexColor("#0071e3"),
        spaceBefore=10,
        spaceAfter=6,
    )
    normal_style = ParagraphStyle(
        "BodyNormal",
        parent=styles["Normal"],
        fontSize=9.5,
        leading=14,
        textColor=colors.HexColor("#1d1d1f"),
    )
    muted_style = ParagraphStyle(
        "MutedNote",
        parent=styles["Normal"],
        fontSize=8.5,
        leading=12,
        textColor=colors.HexColor("#6e6e73"),
    )

    story = []

    # Header
    story.append(Paragraph("Stickora — Premium Vinyl Stickers", title_style))
    story.append(
        Paragraph(
            "Official Payment & Order Confirmation Receipt · Powered by JUSPAY Gateway (Simulated Sandbox)",
            subtitle_style,
        )
    )
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#d2d2d7")))
    story.append(Spacer(1, 8))

    order_dt = (transaction.finalized_at or order.updated_at or order.created_at).strftime(
        "%Y-%m-%d %H:%M:%S UTC"
    )
    customer_name = delivery.full_name if delivery else order.customer_name
    customer_email = delivery.email if delivery else order.customer_email

    # Order & Payment Metadata Table
    story.append(Paragraph("Order & Payment Details", section_heading))
    meta_rows = [
        ["Customer Name", customer_name, "Order ID", order.order_id],
        ["Customer Email", customer_email, "Transaction ID", transaction.transaction_id],
        ["Order Date & Time", order_dt, "Payment Reference", transaction.payment_reference],
        ["Payment Method", transaction.payment_method, "Payment Status", transaction.status],
        ["Currency", order.currency, "Order Status", order.status],
    ]
    meta_table = Table(meta_rows, colWidths=[34 * mm, 55 * mm, 35 * mm, 50 * mm])
    meta_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f5f5f7")),
                ("BACKGROUND", (2, 0), (2, -1), colors.HexColor("#f5f5f7")),
                ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
                ("FONTNAME", (2, 0), (2, -1), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 8.5),
                ("TEXTCOLOR", (0, 0), (-1, -1), colors.HexColor("#1d1d1f")),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#d2d2d7")),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("PADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    story.append(meta_table)
    story.append(Spacer(1, 10))

    # Delivery Address Summary
    if delivery:
        story.append(Paragraph("Delivery Address Summary", section_heading))
        address_text = (
            f"<b>{delivery.full_name}</b><br/>"
            f"{delivery.address_line}<br/>"
            f"{delivery.city}, {delivery.state} - {delivery.pincode}<br/>"
            f"Mobile: {delivery.mobile_number} | Email: {delivery.email}"
        )
        story.append(Paragraph(address_text, normal_style))
        story.append(Spacer(1, 10))

    # Purchased Items Table
    story.append(Paragraph("Purchased Stickers & Pricing Summary", section_heading))
    item_rows = [["Product Name", "Unit Price (INR)", "Quantity", "Line Total (INR)"]]
    for item in items:
        item_rows.append(
            [
                item.product_name,
                f"INR {item.unit_price:.2f}",
                str(item.quantity),
                f"INR {item.total_price:.2f}",
            ]
        )

    delivery_label = "FREE" if order.delivery_fee == 0 else f"INR {order.delivery_fee:.2f}"
    item_rows.append(["", "", "Subtotal", f"INR {order.subtotal:.2f}"])
    item_rows.append(["", "", "Delivery Charges", delivery_label])
    item_rows.append(["", "", "Final Amount Paid", f"INR {order.total_amount:.2f}"])

    items_table = Table(item_rows, colWidths=[82 * mm, 32 * mm, 26 * mm, 34 * mm])
    total_row_idx = len(item_rows) - 1
    subtotal_row_idx = len(item_rows) - 3
    items_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1d1d1f")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
                ("ALIGN", (2, 0), (2, -1), "CENTER"),
                ("GRID", (0, 0), (-1, subtotal_row_idx - 1), 0.5, colors.HexColor("#d2d2d7")),
                ("LINEABOVE", (2, subtotal_row_idx), (-1, subtotal_row_idx), 0.75, colors.HexColor("#86868b")),
                ("BACKGROUND", (2, total_row_idx), (-1, total_row_idx), colors.HexColor("#ecfdf5")),
                ("FONTNAME", (2, total_row_idx), (-1, total_row_idx), "Helvetica-Bold"),
                ("TEXTCOLOR", (2, total_row_idx), (-1, total_row_idx), colors.HexColor("#047857")),
                ("PADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    story.append(items_table)
    story.append(Spacer(1, 16))
    story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#d2d2d7")))
    story.append(Spacer(1, 6))
    story.append(
        Paragraph(
            "Educational payment simulation — no real money transferred. "
            "Generated authoritatively by the Stickora / JUSPAY Backend Service.",
            muted_style,
        )
    )

    doc.build(story)
    return buffer.getvalue()
