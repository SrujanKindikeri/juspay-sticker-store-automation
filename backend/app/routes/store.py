import logging
from typing import Optional, List
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response, status
from sqlalchemy.orm import Session
from app.database.session import get_db
from app.schemas.store import (
    ProductResponse,
    ProductListResponse,
    CategoryResponse,
    CreateOrderRequest,
    StoreOrderResponse,
    OrderItemResponse,
    CustomerDeliveryResponse,
)
from app.schemas.email_verification import RetryReceiptResponse
from app.services.store_service import (
    list_products,
    get_product_by_id,
    list_categories,
    create_store_order,
    get_store_order,
)
from app.services.email_service import send_order_confirmation_email
from app.services.pdf_receipt_service import generate_order_receipt_pdf
from app.models.payment import PaymentTransaction

logger = logging.getLogger("juspay.store")

router = APIRouter(prefix="/store", tags=["Sticker Store"])


@router.get(
    "/categories",
    response_model=List[CategoryResponse],
    summary="Get Sticker Categories",
    description="Returns all available sticker product categories (Anime, Cute, Laptop, Gaming, Aesthetic, Quotes, Packs).",
)
def get_categories(db: Session = Depends(get_db)) -> List[CategoryResponse]:
    categories = list_categories(db)
    return [CategoryResponse.model_validate(c) for c in categories]


@router.get(
    "/products",
    response_model=ProductListResponse,
    summary="List Sticker Products",
    description="Returns catalogue of physical stickers supporting category filter, keyword search, and pagination.",
)
def get_products(
    category: Optional[str] = Query(None, description="Filter by category slug"),
    search: Optional[str] = Query(None, description="Search term for name or description"),
    featured: Optional[bool] = Query(None, description="Filter by featured stickers"),
    best_seller: Optional[bool] = Query(None, description="Filter by best-sellers"),
    new_arrival: Optional[bool] = Query(None, description="Filter by new arrivals"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
) -> ProductListResponse:
    products, total = list_products(
        db=db,
        category=category,
        search=search,
        featured=featured,
        best_seller=best_seller,
        new_arrival=new_arrival,
        skip=skip,
        limit=limit,
    )
    categories = list_categories(db)
    return ProductListResponse(
        items=[ProductResponse.model_validate(p) for p in products],
        total=total,
        categories=[CategoryResponse.model_validate(c) for c in categories],
    )


@router.get(
    "/products/{product_id}",
    response_model=ProductResponse,
    summary="Get Product Details",
    description="Returns detailed information for a single sticker product by ID or slug.",
)
def get_product(product_id: str, db: Session = Depends(get_db)) -> ProductResponse:
    product = get_product_by_id(db, product_id)
    return ProductResponse.model_validate(product)


def _build_store_order_response(order, items, delivery, order_token: Optional[str]) -> StoreOrderResponse:
    return StoreOrderResponse(
        order_id=order.order_id,
        status=order.status,
        subtotal=order.subtotal,
        delivery_fee=order.delivery_fee,
        total_amount=order.total_amount,
        currency=order.currency,
        order_token=order_token,
        payment_transaction_id=order.payment_transaction_id,
        payment_reference=order.payment_reference,
        email_verified=bool(order.email_verified),
        email_verified_at=order.email_verified_at,
        receipt_email_status=order.receipt_email_status or "NOT_SENT",
        receipt_email_sent_at=order.receipt_email_sent_at,
        receipt_email_attempts=order.receipt_email_attempts or 0,
        items=[
            OrderItemResponse(
                product_id=it.product_id,
                product_name=it.product_name,
                unit_price=it.unit_price,
                quantity=it.quantity,
                total_price=it.total_price,
            )
            for it in items
        ],
        delivery=CustomerDeliveryResponse(
            full_name=delivery.full_name,
            mobile_number=delivery.mobile_number,
            email=delivery.email,
            address_line=delivery.address_line,
            city=delivery.city,
            state=delivery.state,
            pincode=delivery.pincode,
        ),
        created_at=order.created_at,
    )


@router.post(
    "/orders",
    response_model=StoreOrderResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create Sticker Order",
    description="Validates verified email, cart items, and inventory, calculates authoritative pricing, saves delivery info, generates a secure access token, and creates an order with status PENDING_PAYMENT.",
)
def place_order(
    request: CreateOrderRequest,
    db: Session = Depends(get_db),
) -> StoreOrderResponse:
    logger.info(f"Creating store order for customer '{request.delivery.full_name}' with {len(request.items)} item(s)")
    order, items, delivery, order_token = create_store_order(db=db, request=request)
    logger.info(f"Order created successfully: {order.order_id}, Total: ₹{order.total_amount}")
    return _build_store_order_response(order, items, delivery, order_token)


@router.get(
    "/orders/{order_id}",
    response_model=StoreOrderResponse,
    summary="Get Store Order Details",
    description="Retrieves created physical sticker order details by order_id. Protected by order access token.",
)
def get_order(
    order_id: str,
    order_token: Optional[str] = Header(None, alias="X-Order-Token"),
    token: Optional[str] = Query(None, description="Order access token"),
    db: Session = Depends(get_db),
) -> StoreOrderResponse:
    effective_token = order_token or token
    order, items, delivery = get_store_order(db=db, order_id=order_id, order_token=effective_token)
    return _build_store_order_response(order, items, delivery, effective_token)


@router.post(
    "/orders/{order_id}/retry-receipt",
    response_model=RetryReceiptResponse,
    summary="Retry Sending Confirmation Receipt Email",
    description="Retries sending the HTML confirmation email and PDF receipt for a PAID store order if previous delivery failed.",
)
def retry_order_receipt(
    order_id: str,
    order_token: Optional[str] = Header(None, alias="X-Order-Token"),
    token: Optional[str] = Query(None, description="Order access token"),
    db: Session = Depends(get_db),
) -> RetryReceiptResponse:
    effective_token = order_token or token
    order, _, _ = get_store_order(db=db, order_id=order_id, order_token=effective_token)

    if order.status != "PAID":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot send payment receipt for order with status '{order.status}'. Order must be PAID.",
        )

    if order.receipt_email_status == "SENT":
        return RetryReceiptResponse(
            order_id=order.order_id,
            receipt_email_status=order.receipt_email_status,
            receipt_email_sent_at=order.receipt_email_sent_at,
            receipt_email_attempts=order.receipt_email_attempts,
            message="Confirmation receipt email was already delivered.",
        )

    updated_order = send_order_confirmation_email(db=db, order_id=order.order_id)
    if not updated_order or updated_order.receipt_email_status != "SENT":
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unable to deliver receipt email right now. Please try again later.",
        )

    return RetryReceiptResponse(
        order_id=updated_order.order_id,
        receipt_email_status=updated_order.receipt_email_status,
        receipt_email_sent_at=updated_order.receipt_email_sent_at,
        receipt_email_attempts=updated_order.receipt_email_attempts,
        message="Confirmation email with PDF receipt delivered successfully.",
    )


@router.get(
    "/orders/{order_id}/receipt-pdf",
    summary="Download Authoritative Order PDF Receipt",
    description="Generates and returns the PDF receipt directly from authoritative backend order and payment records.",
)
def download_order_receipt_pdf(
    order_id: str,
    order_token: Optional[str] = Header(None, alias="X-Order-Token"),
    token: Optional[str] = Query(None, description="Order access token"),
    db: Session = Depends(get_db),
) -> Response:
    effective_token = order_token or token
    order, items, delivery = get_store_order(db=db, order_id=order_id, order_token=effective_token)

    if order.status != "PAID" or not order.payment_transaction_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="PDF receipt is only available after payment is confirmed (PAID).",
        )

    txn = (
        db.query(PaymentTransaction)
        .filter(PaymentTransaction.transaction_id == order.payment_transaction_id)
        .first()
    )
    if not txn or txn.status != "SUCCESS":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Verified successful payment record not found for this order.",
        )

    pdf_bytes = generate_order_receipt_pdf(
        order=order,
        items=items,
        delivery=delivery,
        transaction=txn,
    )
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="Stickora-Receipt-{order.order_id}.pdf"'},
    )
