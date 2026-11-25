import logging
from typing import Optional, List
from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
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
from app.services.store_service import (
    list_products,
    get_product_by_id,
    list_categories,
    create_store_order,
    get_store_order,
)

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


@router.post(
    "/orders",
    response_model=StoreOrderResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create Sticker Order",
    description="Validates cart items and inventory, calculates authoritative pricing, saves delivery info, generates a secure access token, and creates an order with status PENDING_PAYMENT.",
)
def place_order(
    request: CreateOrderRequest,
    db: Session = Depends(get_db),
) -> StoreOrderResponse:
    logger.info(f"Creating store order for customer '{request.delivery.full_name}' with {len(request.items)} item(s)")
    order, items, delivery, order_token = create_store_order(db=db, request=request)
    logger.info(f"Order created successfully: {order.order_id}, Total: ₹{order.total_amount}")

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
    return StoreOrderResponse(
        order_id=order.order_id,
        status=order.status,
        subtotal=order.subtotal,
        delivery_fee=order.delivery_fee,
        total_amount=order.total_amount,
        currency=order.currency,
        order_token=effective_token,
        payment_transaction_id=order.payment_transaction_id,
        payment_reference=order.payment_reference,
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
