import re
from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field, ConfigDict, field_validator


class CategoryResponse(BaseModel):
    id: int
    slug: str
    name: str
    description: Optional[str] = None
    icon: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class ProductResponse(BaseModel):
    id: str
    name: str
    slug: str
    description: str
    category: str
    price: float
    stock_quantity: int
    size: str
    material: str
    image_url: str
    gallery_images: Optional[str] = None
    rating: float
    review_count: int
    is_featured: bool
    is_best_seller: bool
    is_new_arrival: bool
    is_in_stock: bool

    model_config = ConfigDict(from_attributes=True)


class ProductListResponse(BaseModel):
    items: List[ProductResponse]
    total: int
    categories: Optional[List[CategoryResponse]] = None

    model_config = ConfigDict(from_attributes=True)


class CustomerDeliveryInput(BaseModel):
    full_name: str = Field(..., min_length=2, max_length=100, description="Customer full name")
    mobile_number: str = Field(..., description="10-digit Indian mobile number")
    email: str = Field(..., max_length=120, description="Customer email address")
    address_line: str = Field(..., min_length=5, max_length=255, description="Street address")
    city: str = Field(..., min_length=2, max_length=100, description="City")
    state: str = Field(..., min_length=2, max_length=100, description="State")
    pincode: str = Field(..., description="6-digit Indian PIN code")

    @field_validator("mobile_number")
    def validate_mobile(cls, v: str) -> str:
        clean = re.sub(r"[\s\-\+]", "", v)
        if clean.startswith("91") and len(clean) == 12:
            clean = clean[2:]
        if not (clean.isdigit() and len(clean) == 10 and clean[0] in "6789"):
            raise ValueError("Mobile number must be a valid 10-digit Indian number starting with 6, 7, 8, or 9.")
        return clean

    @field_validator("email")
    def validate_email(cls, v: str) -> str:
        clean = v.strip().lower()
        if not re.match(r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$", clean):
            raise ValueError("Invalid email format.")
        return clean

    @field_validator("pincode")
    def validate_pincode(cls, v: str) -> str:
        clean = re.sub(r"\s", "", v)
        if not (clean.isdigit() and len(clean) == 6):
            raise ValueError("PIN code must be a 6-digit number.")
        return clean

    model_config = ConfigDict(extra="ignore")


class OrderItemInput(BaseModel):
    product_id: str = Field(..., min_length=1, max_length=50, description="Sticker product identifier")
    quantity: int = Field(..., gt=0, le=50, description="Quantity to purchase (1-50)")

    model_config = ConfigDict(extra="ignore")


class CreateOrderRequest(BaseModel):
    items: List[OrderItemInput] = Field(..., min_length=1, description="List of items in cart")
    delivery: CustomerDeliveryInput = Field(..., description="Customer delivery address")

    model_config = ConfigDict(extra="ignore")


class OrderItemResponse(BaseModel):
    product_id: str
    product_name: str
    unit_price: float
    quantity: int
    total_price: float

    model_config = ConfigDict(from_attributes=True)


class CustomerDeliveryResponse(BaseModel):
    full_name: str
    mobile_number: str
    email: str
    address_line: str
    city: str
    state: str
    pincode: str

    model_config = ConfigDict(from_attributes=True)


class StoreOrderResponse(BaseModel):
    order_id: str
    status: str
    subtotal: float
    delivery_fee: float
    total_amount: float
    currency: str
    items: List[OrderItemResponse]
    delivery: CustomerDeliveryResponse
    created_at: datetime
    order_token: Optional[str] = None
    payment_transaction_id: Optional[str] = None
    payment_reference: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)
