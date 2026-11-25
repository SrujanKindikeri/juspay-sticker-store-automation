import uuid
import hmac
import hashlib
import secrets
from datetime import datetime
from typing import Optional, List, Tuple
from sqlalchemy.orm import Session
from sqlalchemy import or_
from fastapi import HTTPException, status
from app.models.store import Category, Product, CustomerDelivery, StoreOrder, StoreOrderItem
from app.schemas.store import CreateOrderRequest
from app.core.config import settings
from app.services.email_verification_service import assert_email_verified_for_order


SAMPLE_CATEGORIES = [
    {"slug": "laptop", "name": "Laptop & Tech", "description": "High-durability tech, programming, and geek culture stickers.", "icon": "💻"},
    {"slug": "anime", "name": "Anime & Manga", "description": "Original anime art, mecha, and Japanese folklore aesthetic stickers.", "icon": "🎌"},
    {"slug": "cute", "name": "Cute & Kawaii", "description": "Chibi animals, boba drinks, pastel food, and sweet characters.", "icon": "🧸"},
    {"slug": "gaming", "name": "Gaming & Esports", "description": "Pixel art, controllers, gaming crests, and retro arcade icons.", "icon": "🎮"},
    {"slug": "aesthetic", "name": "Aesthetic & Retro", "description": "Vaporwave, synthwave cassettes, neon sunsets, and lo-fi vibes.", "icon": "✨"},
    {"slug": "quotes", "name": "Quotes & Typography", "description": "Witty developer quotes, humorous puns, and motivational badges.", "icon": "💬"},
    {"slug": "packs", "name": "Sticker Packs", "description": "Curated bundles of 5-10 themed die-cut stickers at special bundle prices.", "icon": "📦"},
]

SAMPLE_PRODUCTS = [
    {
        "id": "STK-001",
        "name": "Cyberpunk Neon Cat",
        "slug": "cyberpunk-neon-cat",
        "description": "Futuristic cyberpunk feline equipped with neon visor and glowing cybernetics. Printed on ultra-durable holographic vinyl with scratch-resistant coating.",
        "category": "gaming",
        "price": 99.0,
        "stock_quantity": 150,
        "size": "3x3 inches",
        "material": "Holographic Die-Cut Vinyl",
        "image_url": "/stickers/cyberpunk-cat.svg",
        "rating": 4.9,
        "review_count": 84,
        "is_featured": True,
        "is_best_seller": True,
        "is_new_arrival": False,
    },
    {
        "id": "STK-002",
        "name": "Coffee First, Code Later",
        "slug": "coffee-first-code-later",
        "description": "The ultimate developer mantra. Premium matte vinyl sticker featuring a steaming ceramic cup and retro terminal font. Dishwasher and microwave safe.",
        "category": "quotes",
        "price": 89.0,
        "stock_quantity": 200,
        "size": "3x2.5 inches",
        "material": "Matte Waterproof Vinyl",
        "image_url": "/stickers/coffee-code.svg",
        "rating": 4.8,
        "review_count": 62,
        "is_featured": True,
        "is_best_seller": False,
        "is_new_arrival": False,
    },
    {
        "id": "STK-003",
        "name": "Matcha Boba Bear",
        "slug": "matcha-boba-bear",
        "description": "An adorable pastel bear savoring a cold iced matcha bubble tea with tapioca pearls. High-gloss UV laminate prevents fading in sunlight.",
        "category": "cute",
        "price": 99.0,
        "stock_quantity": 120,
        "size": "3x3.5 inches",
        "material": "Glossy Waterproof Vinyl",
        "image_url": "/stickers/matcha-bear.svg",
        "rating": 5.0,
        "review_count": 47,
        "is_featured": False,
        "is_best_seller": True,
        "is_new_arrival": False,
    },
    {
        "id": "STK-004",
        "name": "Pixel Dragon Boss",
        "slug": "pixel-dragon-boss",
        "description": "16-bit retro arcade boss dragon breathing violet pixel flames. Finished with subtle glitter sparkle that glints in ambient lighting.",
        "category": "gaming",
        "price": 119.0,
        "stock_quantity": 90,
        "size": "4x3.5 inches",
        "material": "Glitter Finish Vinyl",
        "image_url": "/stickers/pixel-dragon.svg",
        "rating": 4.7,
        "review_count": 39,
        "is_featured": False,
        "is_best_seller": False,
        "is_new_arrival": True,
    },
    {
        "id": "STK-005",
        "name": "Minimalist Mountain Sunset",
        "slug": "minimalist-mountain-sunset",
        "description": "Serene geometric mountain peaks bathed in golden hour pastel sunset hues. Elegant satin finish with precision laser die-cut borders.",
        "category": "aesthetic",
        "price": 89.0,
        "stock_quantity": 180,
        "size": "3x3 inches",
        "material": "Satin Matte Vinyl",
        "image_url": "/stickers/mountain-sunset.svg",
        "rating": 4.9,
        "review_count": 51,
        "is_featured": True,
        "is_best_seller": False,
        "is_new_arrival": False,
    },
    {
        "id": "STK-006",
        "name": "Samurai Kitsune Mask",
        "slug": "samurai-kitsune-mask",
        "description": "Traditional Japanese fox mask with golden cherry blossom motifs and crimson tassels. Printed on heavy metallic chrome vinyl for a mirror shine.",
        "category": "anime",
        "price": 129.0,
        "stock_quantity": 75,
        "size": "3.5x4 inches",
        "material": "Metallic Chrome Vinyl",
        "image_url": "/stickers/kitsune-mask.svg",
        "rating": 4.9,
        "review_count": 93,
        "is_featured": True,
        "is_best_seller": True,
        "is_new_arrival": False,
    },
    {
        "id": "STK-007",
        "name": "Eat Sleep Deploy Repeat",
        "slug": "eat-sleep-deploy-repeat",
        "description": "DevOps lifecycle badge celebrating successful production releases without rollbacks. Durable vinyl resistant to coffee spills and desk wear.",
        "category": "quotes",
        "price": 89.0,
        "stock_quantity": 140,
        "size": "3.5x2 inches",
        "material": "Matte Waterproof Vinyl",
        "image_url": "/stickers/deploy-repeat.svg",
        "rating": 4.6,
        "review_count": 28,
        "is_featured": False,
        "is_best_seller": False,
        "is_new_arrival": False,
    },
    {
        "id": "STK-008",
        "name": "Cosmic Astronaut Floating",
        "slug": "cosmic-astronaut-floating",
        "description": "An interstellar explorer drifting among neon nebula clouds and glowing planets. Rainbow holographic sheen creates stunning space reflections.",
        "category": "laptop",
        "price": 109.0,
        "stock_quantity": 110,
        "size": "3.5x3.5 inches",
        "material": "Holographic Rainbow Vinyl",
        "image_url": "/stickers/cosmic-astronaut.svg",
        "rating": 4.8,
        "review_count": 71,
        "is_featured": True,
        "is_best_seller": False,
        "is_new_arrival": True,
    },
    {
        "id": "STK-009",
        "name": "Retro Synthwave Cassette",
        "slug": "retro-synthwave-cassette",
        "description": "80s outrun synthwave cassette tape with chrome tape wheels and grid sun aesthetic. High-definition glossy finish perfect for skateboards and laptops.",
        "category": "aesthetic",
        "price": 99.0,
        "stock_quantity": 130,
        "size": "4x2.5 inches",
        "material": "Glossy Die-Cut Vinyl",
        "image_url": "/stickers/synthwave-cassette.svg",
        "rating": 4.7,
        "review_count": 42,
        "is_featured": False,
        "is_best_seller": False,
        "is_new_arrival": True,
    },
    {
        "id": "STK-010",
        "name": "Level Up Arcade Token",
        "slug": "level-up-arcade-token",
        "description": "Vintage brass arcade token stamped with '+1 UP' and pixel star. Textured matte surface feels like genuine vintage gaming hardware.",
        "category": "gaming",
        "price": 79.0,
        "stock_quantity": 160,
        "size": "2.5x2.5 inches",
        "material": "Textured Matte Vinyl",
        "image_url": "/stickers/level-up.svg",
        "rating": 4.8,
        "review_count": 33,
        "is_featured": False,
        "is_best_seller": False,
        "is_new_arrival": False,
    },
    {
        "id": "STK-011",
        "name": "Kawaii Ramen Bowl",
        "slug": "kawaii-ramen-bowl",
        "description": "Steaming bowl of delicious ramen with smiling soft-boiled egg, narutomaki fish cake, and nori. Tear-proof, waterproof outdoor vinyl.",
        "category": "cute",
        "price": 99.0,
        "stock_quantity": 85,
        "size": "3x3 inches",
        "material": "Glossy Waterproof Vinyl",
        "image_url": "/stickers/kawaii-ramen.svg",
        "rating": 4.9,
        "review_count": 55,
        "is_featured": False,
        "is_best_seller": True,
        "is_new_arrival": False,
    },
    {
        "id": "STK-012",
        "name": "Full-Stack Dev Pack (5-Pack)",
        "slug": "full-stack-dev-pack",
        "description": "The ultimate developer bundle! Includes 5 high-grade vinyl stickers: Cyberpunk Cat, Coffee First, Deploy Repeat, Pixel Dragon, and Level Up.",
        "category": "packs",
        "price": 299.0,
        "stock_quantity": 50,
        "size": "5 Stickers (3x3 in each)",
        "material": "Premium Vinyl Bundle",
        "image_url": "/stickers/dev-pack.svg",
        "rating": 5.0,
        "review_count": 112,
        "is_featured": True,
        "is_best_seller": True,
        "is_new_arrival": False,
    },
]


def seed_store_catalog(db: Session) -> None:
    """
    Seeds initial categories and physical sticker products if not already populated.
    """
    if db.query(Category).count() == 0:
        for cat_data in SAMPLE_CATEGORIES:
            db.add(Category(**cat_data))
        db.commit()

    if db.query(Product).count() == 0:
        for prod_data in SAMPLE_PRODUCTS:
            db.add(Product(**prod_data))
        db.commit()


def list_products(
    db: Session,
    category: Optional[str] = None,
    search: Optional[str] = None,
    featured: Optional[bool] = None,
    best_seller: Optional[bool] = None,
    new_arrival: Optional[bool] = None,
    skip: int = 0,
    limit: int = 50,
) -> Tuple[List[Product], int]:
    """
    Lists products with optional filtering by category, search query, and flags.
    """
    query = db.query(Product)

    if category and category.lower() != "all":
        query = query.filter(Product.category == category.lower())

    if search and search.strip():
        term = f"%{search.strip().lower()}%"
        query = query.filter(
            or_(
                Product.name.ilike(term),
                Product.description.ilike(term),
                Product.category.ilike(term),
                Product.material.ilike(term),
            )
        )

    if featured is not None:
        query = query.filter(Product.is_featured == featured)
    if best_seller is not None:
        query = query.filter(Product.is_best_seller == best_seller)
    if new_arrival is not None:
        query = query.filter(Product.is_new_arrival == new_arrival)

    total = query.count()
    items = query.order_by(Product.is_featured.desc(), Product.id.asc()).offset(skip).limit(limit).all()
    return items, total


def get_product_by_id(db: Session, product_id: str) -> Product:
    """
    Retrieves a single product by ID or slug. Raises 404 if not found.
    """
    prod = (
        db.query(Product)
        .filter(or_(Product.id == product_id, Product.slug == product_id))
        .first()
    )
    if not prod:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Sticker product '{product_id}' not found.",
        )
    return prod


def list_categories(db: Session) -> List[Category]:
    """
    Retrieves all product categories.
    """
    return db.query(Category).order_by(Category.id.asc()).all()


def hash_order_token(token: str) -> str:
    """
    Cryptographically hashes an order access token using HMAC-SHA256 with the server secret key.
    Ensures that access tokens are never stored in plaintext in the database.
    """
    return hmac.new(
        settings.otp_secret_key.encode("utf-8"),
        token.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def verify_order_token(submitted_token: Optional[str], stored_hash: Optional[str]) -> bool:
    """
    Constant-time verification of an order access token against its stored hash.
    Protects against timing attacks.
    """
    if not submitted_token or not stored_hash:
        return False
    expected = hash_order_token(submitted_token)
    return hmac.compare_digest(expected, stored_hash)


def create_store_order(
    db: Session,
    request: CreateOrderRequest,
) -> Tuple[StoreOrder, List[StoreOrderItem], CustomerDelivery, str]:
    """
    Creates a new physical sticker order in PostgreSQL.
    Status starts as PENDING_PAYMENT.
    
    SECURITY & INTEGRITY:
    - Verifies product existence and available stock quantity.
    - Prevents negative stock.
    - Calculates subtotal and delivery fee authoritatively on the backend.
    - Does NOT trust client-supplied prices.
    - Generates a cryptographically secure random order access token (secrets.token_urlsafe).
    - Sets initial status to PENDING_PAYMENT (never marked paid).
    """
    if not request.items:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Order must contain at least one item.",
        )

    verified_session = None
    if settings.email_verification_enabled:
        verified_session = assert_email_verified_for_order(
            db=db,
            email=request.delivery.email,
            session_id=request.email_verification_session_id,
            verification_token=request.email_verification_token,
        )

    order_id = f"STK-ORD-{uuid.uuid4().hex[:10].upper()}"
    calculated_subtotal = 0.0
    created_items: List[StoreOrderItem] = []

    # 1. Validate items and verify inventory
    for item_input in request.items:
        product = db.query(Product).filter(Product.id == item_input.product_id).with_for_update().first()
        if not product:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Product with ID '{item_input.product_id}' does not exist.",
            )

        if product.stock_quantity < item_input.quantity:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Insufficient stock for '{product.name}'. Available: {product.stock_quantity}, requested: {item_input.quantity}.",
            )

        item_total = round(product.price * item_input.quantity, 2)
        calculated_subtotal += item_total

        # Decrement stock safely
        product.stock_quantity -= item_input.quantity

        order_item = StoreOrderItem(
            order_id=order_id,
            product_id=product.id,
            product_name=product.name,
            unit_price=product.price,
            quantity=item_input.quantity,
            total_price=item_total,
        )
        created_items.append(order_item)

    # 2. Compute authoritative delivery fee (Free delivery if subtotal >= 499, else 50)
    calculated_subtotal = round(calculated_subtotal, 2)
    delivery_fee = 0.0 if calculated_subtotal >= 499.0 else 50.0
    total_amount = round(calculated_subtotal + delivery_fee, 2)

    # 3. Generate secure order access token for customer ownership authorization
    order_token = secrets.token_urlsafe(32)
    order_token_hash = hash_order_token(order_token)

    # 4. Create StoreOrder record
    order = StoreOrder(
        order_id=order_id,
        status="PENDING_PAYMENT",
        subtotal=calculated_subtotal,
        delivery_fee=delivery_fee,
        total_amount=total_amount,
        currency="INR",
        customer_name=request.delivery.full_name,
        customer_email=request.delivery.email,
        order_token_hash=order_token_hash,
        stock_reserved=True,
        email_verified=bool(verified_session),
        email_verified_at=verified_session.verified_at if verified_session else None,
        email_verification_session_id=verified_session.session_id if verified_session else None,
        receipt_email_status="NOT_SENT",
        receipt_email_attempts=0,
    )
    db.add(order)

    # 5. Create CustomerDelivery record
    delivery = CustomerDelivery(
        order_id=order_id,
        full_name=request.delivery.full_name,
        mobile_number=request.delivery.mobile_number,
        email=request.delivery.email,
        address_line=request.delivery.address_line,
        city=request.delivery.city,
        state=request.delivery.state,
        pincode=request.delivery.pincode,
    )
    db.add(delivery)

    for oi in created_items:
        db.add(oi)

    db.commit()
    db.refresh(order)
    db.refresh(delivery)

    return order, created_items, delivery, order_token


def get_store_order(
    db: Session,
    order_id: str,
    order_token: Optional[str] = None,
) -> Tuple[StoreOrder, List[StoreOrderItem], CustomerDelivery]:
    """
    Retrieves an existing order, its line items, and delivery address.
    SECURITY:
    If order has an access token hash, validates order ownership via constant-time token comparison.
    Rejects unauthorized access with 401 (missing) or 403 (invalid).
    """
    order = db.query(StoreOrder).filter(StoreOrder.order_id == order_id).first()
    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Order '{order_id}' not found.",
        )

    # Enforce order ownership authorization if order was created with a token
    if order.order_token_hash:
        if not order_token:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Order access token is required to view order and customer delivery details.",
            )
        if not verify_order_token(order_token, order.order_token_hash):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Invalid order access token. You do not have permission to access this order.",
            )

    items = db.query(StoreOrderItem).filter(StoreOrderItem.order_id == order_id).all()
    delivery = db.query(CustomerDelivery).filter(CustomerDelivery.order_id == order_id).first()

    return order, items, delivery


def prepare_store_order_for_payment(
    db: Session,
    order_id: str,
    requested_amount: float,
) -> Optional[StoreOrder]:
    """
    Validates and prepares a StoreOrder for payment initiation.
    
    SECURITY & INTEGRITY RULES:
    1. Rejects tampered amounts: if requested_amount does not match order.total_amount.
    2. Rejects duplicate payment: if order is already PAID (HTTP 409).
    3. Supports safe payment retry: if order previously failed/declined and stock was restored,
       re-checks and re-reserves stock atomically before allowing a retry.
    """
    order = (
        db.query(StoreOrder)
        .filter(StoreOrder.order_id == order_id)
        .with_for_update()
        .first()
    )
    if not order:
        # Non-store simulated order (e.g. DEMO-ORD-...)
        return None

    # Check 1: Already paid
    if order.status == "PAID":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Store order '{order_id}' has already been paid in full (Status: PAID). Duplicate payment is not allowed.",
        )

    # Check 2: Authoritative amount enforcement
    if abs(requested_amount - order.total_amount) > 0.01:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Submitted amount ({requested_amount} INR) does not match authoritative "
                f"store order total ({order.total_amount} INR). Tampered amount rejected."
            ),
        )

    # Check 3: Retry handling - If payment previously failed and stock was unreserved, re-reserve
    if order.status == "PAYMENT_FAILED" and not order.stock_reserved:
        items = db.query(StoreOrderItem).filter(StoreOrderItem.order_id == order_id).all()
        for item in items:
            product = (
                db.query(Product)
                .filter(Product.id == item.product_id)
                .with_for_update()
                .first()
            )
            if not product or product.stock_quantity < item.quantity:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Cannot retry payment: item '{item.product_name}' is out of stock.",
                )
            product.stock_quantity -= item.quantity

        order.stock_reserved = True
        order.status = "PENDING_PAYMENT"
        order.updated_at = datetime.utcnow()
        db.flush()

    return order


def sync_store_order_payment_status(
    db: Session,
    order_id: str,
    payment_status: str,
    payment_transaction_id: Optional[str] = None,
    payment_reference: Optional[str] = None,
) -> Optional[StoreOrder]:
    """
    Synchronizes payment transaction outcomes to StoreOrder status and inventory.
    
    LIFECYCLE RULES:
    - SUCCESS -> StoreOrder.status = 'PAID'. Stock permanently consumed.
    - DECLINED / FAILED -> StoreOrder.status = 'PAYMENT_FAILED'. Reserved inventory is restored.
    - Idempotent: repeated updates or finalized transactions do not restore stock twice.
    """
    order = (
        db.query(StoreOrder)
        .filter(StoreOrder.order_id == order_id)
        .with_for_update()
        .first()
    )
    if not order:
        return None

    now = datetime.utcnow()

    if payment_status == "SUCCESS":
        if order.status == "PAID":
            return order  # Idempotent replay

        order.status = "PAID"
        order.stock_reserved = False  # Stock permanently consumed/purchased
        if payment_transaction_id:
            order.payment_transaction_id = payment_transaction_id
        if payment_reference:
            order.payment_reference = payment_reference
        order.updated_at = now
        db.flush()

    elif payment_status in ("DECLINED", "FAILED"):
        if order.status == "PAID":
            return order  # Never downgrade an already successful order

        # Transition to PAYMENT_FAILED and restore stock if currently reserved
        if order.status != "PAYMENT_FAILED" or order.stock_reserved:
            order.status = "PAYMENT_FAILED"
            if order.stock_reserved:
                items = db.query(StoreOrderItem).filter(StoreOrderItem.order_id == order_id).all()
                for item in items:
                    product = (
                        db.query(Product)
                        .filter(Product.id == item.product_id)
                        .with_for_update()
                        .first()
                    )
                    if product:
                        product.stock_quantity += item.quantity
                order.stock_reserved = False

            if payment_transaction_id:
                order.payment_transaction_id = payment_transaction_id
            if payment_reference:
                order.payment_reference = payment_reference
            order.updated_at = now
            db.flush()

    return order
