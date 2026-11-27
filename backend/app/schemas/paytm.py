from typing import Optional, Dict, Any
from pydantic import BaseModel, Field


class PaytmConfigResponse(BaseModel):
    provider: str = Field(..., description="Active payment provider: 'simulated' or 'paytm'")
    enabled: bool = Field(..., description="Whether Paytm sandbox integration is available")
    environment: str = Field(..., description="Target environment ('staging' or 'production')")
    mid_masked: Optional[str] = Field(None, description="Masked Merchant ID for secure display")
    checkout_js_url: str = Field(..., description="Paytm JS Checkout script URL")
    is_paytm_configured: bool = Field(False, description="Whether live staging credentials are fully configured")
    is_live: bool = Field(False, description="Whether active provider is paytm and configured")


class PaytmInitiateRequest(BaseModel):
    order_id: str = Field(..., min_length=3, max_length=64, description="Unique Store or Demo Order ID")
    amount: float = Field(..., gt=0, description="Transaction amount in INR")
    currency: str = Field("INR", max_length=10, description="Currency code")
    customer_email: Optional[str] = Field(None, description="Customer contact email")
    customer_id: Optional[str] = Field(None, description="Optional customer identifier")
    callback_url: Optional[str] = Field(None, description="Optional custom callback URL override")


class PaytmInitiateResponse(BaseModel):
    transaction_id: str
    payment_reference: str
    order_id: str
    amount: float
    currency: str
    txn_token: str
    mid: str
    callback_url: str
    checkout_js_url: str
    status: str


class PaytmStatusResponse(BaseModel):
    order_id: str
    transaction_id: Optional[str] = None
    payment_reference: Optional[str] = None
    status: str
    is_finalized: bool
    amount: float
    gateway_transaction_id: Optional[str] = None
    gateway_response_code: Optional[str] = None
    gateway_response_msg: Optional[str] = None
    store_order_status: Optional[str] = None
