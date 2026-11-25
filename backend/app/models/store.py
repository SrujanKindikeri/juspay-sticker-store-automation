from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, Boolean, Text, DateTime
from app.database.base import Base


class Category(Base):
    """Product Category Model (e.g. laptop, anime, cute, gaming, aesthetic, quotes, packs)."""
    __tablename__ = "store_categories"

    id = Column(Integer, primary_key=True, index=True)
    slug = Column(String(50), unique=True, index=True, nullable=False)
    name = Column(String(100), nullable=False)
    description = Column(String(255), nullable=True)
    icon = Column(String(50), nullable=True)

    def __repr__(self) -> str:
        return f"<Category {self.slug}: {self.name}>"


class Product(Base):
    """
    Physical Sticker Product Model.
    Stores metadata, pricing, inventory stock, dimensions, and finishes.
    """
    __tablename__ = "store_products"

    id = Column(String(50), primary_key=True, index=True)  # e.g. STK-001
    name = Column(String(150), nullable=False)
    slug = Column(String(150), unique=True, index=True, nullable=False)
    description = Column(Text, nullable=False)
    category = Column(String(50), index=True, nullable=False)
    price = Column(Float, nullable=False)  # in INR
    stock_quantity = Column(Integer, nullable=False, default=100)
    size = Column(String(50), nullable=False)  # e.g. "3x3 inches"
    material = Column(String(50), nullable=False)  # e.g. "Matte Vinyl"
    image_url = Column(String(255), nullable=False)
    gallery_images = Column(Text, nullable=True)  # Comma-separated or JSON list of URLs
    rating = Column(Float, default=4.8, nullable=False)
    review_count = Column(Integer, default=24, nullable=False)
    is_featured = Column(Boolean, default=False, nullable=False)
    is_best_seller = Column(Boolean, default=False, nullable=False)
    is_new_arrival = Column(Boolean, default=False, nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    @property
    def is_in_stock(self) -> bool:
        return self.stock_quantity > 0

    def __repr__(self) -> str:
        return f"<Product {self.id} '{self.name}' - ₹{self.price} (Stock: {self.stock_quantity})>"


class CustomerDelivery(Base):
    """
    Customer Delivery Information Model.
    Stores shipping details associated with an order.
    """
    __tablename__ = "store_customer_deliveries"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(String(64), index=True, nullable=False)
    full_name = Column(String(100), nullable=False)
    mobile_number = Column(String(20), nullable=False)
    email = Column(String(120), nullable=False)
    address_line = Column(String(255), nullable=False)
    city = Column(String(100), nullable=False)
    state = Column(String(100), nullable=False)
    pincode = Column(String(10), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    def __repr__(self) -> str:
        return f"<CustomerDelivery {self.order_id}: {self.full_name}, {self.city} - {self.pincode}>"


class StoreOrder(Base):
    """
    Store Order Model.
    Tracks physical sticker order before payment gateway settlement.
    Status starts as PENDING_PAYMENT.
    """
    __tablename__ = "store_orders"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(String(64), unique=True, index=True, nullable=False)  # e.g. STK-ORD-89210
    status = Column(String(30), default="PENDING_PAYMENT", index=True, nullable=False)
    subtotal = Column(Float, nullable=False)
    delivery_fee = Column(Float, default=0.0, nullable=False)
    total_amount = Column(Float, nullable=False)
    currency = Column(String(10), default="INR", nullable=False)
    customer_name = Column(String(100), nullable=False)
    customer_email = Column(String(120), nullable=False)

    # Secure authorization and stock tracking
    order_token_hash = Column(String(128), nullable=True)
    stock_reserved = Column(Boolean, default=True, nullable=False)
    payment_transaction_id = Column(String(64), nullable=True)
    payment_reference = Column(String(64), nullable=True)

    # Email & WhatsApp contact verification + confirmation receipt tracking
    contact_verification_channel = Column(String(20), default="email", nullable=False)
    email_verified = Column(Boolean, default=False, nullable=False)
    email_verified_at = Column(DateTime, nullable=True)
    email_verification_session_id = Column(String(64), nullable=True)
    whatsapp_verified = Column(Boolean, default=False, nullable=False)
    whatsapp_verified_at = Column(DateTime, nullable=True)
    whatsapp_verification_session_id = Column(String(64), nullable=True)
    receipt_email_status = Column(String(30), default="NOT_SENT", nullable=False)  # NOT_SENT, SENT, FAILED
    receipt_email_sent_at = Column(DateTime, nullable=True)
    receipt_email_attempts = Column(Integer, default=0, nullable=False)
    receipt_email_last_error = Column(String(255), nullable=True)
    receipt_email_last_attempt_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    def __repr__(self) -> str:
        return f"<StoreOrder {self.order_id}: {self.total_amount} {self.currency} - {self.status}>"


class StoreOrderItem(Base):
    """
    Store Order Line Item.
    Links products to an order with snapshot prices at the moment of order creation.
    """
    __tablename__ = "store_order_items"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(String(64), index=True, nullable=False)
    product_id = Column(String(50), index=True, nullable=False)
    product_name = Column(String(150), nullable=False)
    unit_price = Column(Float, nullable=False)
    quantity = Column(Integer, nullable=False)
    total_price = Column(Float, nullable=False)

    def __repr__(self) -> str:
        return f"<StoreOrderItem {self.order_id}: {self.product_name} x{self.quantity}>"
