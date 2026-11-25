from enum import Enum
from typing import Optional
from datetime import datetime
import re
from pydantic import BaseModel, Field, ConfigDict, model_validator


class PaymentMethodEnum(str, Enum):
    CARD = "CARD"
    UPI = "UPI"
    NET_BANKING = "NET_BANKING"


class CardDetails(BaseModel):
    """
    Simulated Card input details.
    NOTE: These details are strictly for input validation in the simulation;
    they are NEVER persisted in the database.
    """
    card_number: str = Field(..., description="13 to 19 digit card number (demo)")
    expiry: str = Field(..., description="Card expiry in MM/YY format")
    cvv: str = Field(..., description="3 or 4 digit security code")
    card_holder: str = Field(..., min_length=2, max_length=100, description="Cardholder name")

    model_config = ConfigDict(extra="ignore")


class UpiDetails(BaseModel):
    """Simulated UPI VPA details."""
    upi_id: str = Field(..., description="Virtual Payment Address (e.g. user@bank)")
    app_name: Optional[str] = Field(None, description="UPI client app name (e.g. gpay, phonepe)")

    model_config = ConfigDict(extra="ignore")


class NetBankingDetails(BaseModel):
    """Simulated Net Banking details."""
    bank_code: str = Field(..., min_length=2, max_length=20, description="Bank identifier (e.g. HDFC, ICICI, SBI)")

    model_config = ConfigDict(extra="ignore")


class PaymentInitiateRequest(BaseModel):
    """
    Request schema for POST /api/v1/payments/initiate
    """
    order_id: str = Field(..., min_length=1, max_length=64, description="Merchant order reference")
    amount: float = Field(..., gt=0, description="Transaction amount (must be > 0)")
    currency: str = Field(default="INR", max_length=10, description="Currency code (e.g. INR)")
    payment_method: PaymentMethodEnum = Field(..., description="Selected payment method")
    
    # Method-specific payload sections
    card_details: Optional[CardDetails] = None
    upi_details: Optional[UpiDetails] = None
    netbanking_details: Optional[NetBankingDetails] = None
    customer_email: Optional[str] = Field(None, max_length=120)

    model_config = ConfigDict(extra="ignore")

    @model_validator(mode="after")
    def validate_payment_method_payload(self) -> "PaymentInitiateRequest":
        """Enforces that required contextual fields are provided according to payment method."""
        method = self.payment_method

        if method == PaymentMethodEnum.CARD:
            if not self.card_details:
                raise ValueError("card_details is required when payment_method is CARD")
            
            # Validate card number digits (strip spaces and dashes)
            raw_card = re.sub(r"[\s\-]", "", self.card_details.card_number)
            if not (raw_card.isdigit() and 13 <= len(raw_card) <= 19):
                raise ValueError("Invalid card number. Must be between 13 and 19 digits")

            # Validate expiry format MM/YY
            expiry_match = re.match(r"^(0[1-9]|1[0-2])\/([0-9]{2})$", self.card_details.expiry.strip())
            if not expiry_match:
                raise ValueError("Invalid card expiry format. Expected MM/YY (e.g. 12/28)")

            # Validate CVV
            cvv_clean = self.card_details.cvv.strip()
            if not (cvv_clean.isdigit() and len(cvv_clean) in (3, 4)):
                raise ValueError("Invalid CVV. Must be 3 or 4 digits")

            # Validate cardholder name
            if not self.card_details.card_holder.strip():
                raise ValueError("Cardholder name cannot be empty")

        elif method == PaymentMethodEnum.UPI:
            if not self.upi_details:
                raise ValueError("upi_details is required when payment_method is UPI")
            
            # Validate UPI ID format: username@bank
            upi_clean = self.upi_details.upi_id.strip()
            if not re.match(r"^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$", upi_clean):
                raise ValueError("Invalid UPI ID format. Expected format: username@bank (e.g. demo@okhdfcbank)")

        elif method == PaymentMethodEnum.NET_BANKING:
            if not self.netbanking_details:
                raise ValueError("netbanking_details is required when payment_method is NET_BANKING")
            
            bank_code = self.netbanking_details.bank_code.strip()
            if not bank_code:
                raise ValueError("bank_code is required for NET_BANKING")

        return self


class PaymentInitiateResponse(BaseModel):
    """
    Response schema for POST /api/v1/payments/initiate
    """
    transaction_id: str = Field(..., description="Unique generated transaction identifier")
    payment_reference: str = Field(..., description="Unique generated payment reference")
    order_id: str = Field(..., description="Associated merchant order ID")
    amount: float = Field(..., description="Transaction amount")
    currency: str = Field(..., description="Currency code")
    payment_method: str = Field(..., description="Method used for payment")
    status: str = Field(default="PENDING", description="Initial payment lifecycle status")
    created_at: datetime = Field(..., description="UTC creation timestamp")

    model_config = ConfigDict(from_attributes=True)


class PaymentProcessRequest(BaseModel):
    """Optional payload to request specific simulation outcome (development/testing only)."""
    outcome: Optional[str] = Field(None, description="Requested simulation outcome: SUCCESS, DECLINED, FAILED")

    model_config = ConfigDict(extra="ignore")


class PaymentProcessResponse(BaseModel):
    """
    Response schema for POST /api/v1/payments/{transaction_id}/process
    """
    transaction_id: str = Field(..., description="Unique generated transaction identifier")
    payment_reference: str = Field(..., description="Unique generated payment reference")
    order_id: str = Field(..., description="Associated merchant order ID")
    amount: float = Field(..., description="Processed amount")
    currency: str = Field(..., description="Currency code")
    payment_method: str = Field(..., description="Method used for payment")
    status: str = Field(..., description="Final payment status: SUCCESS, FAILED, or DECLINED")
    message: str = Field(..., description="Status description")
    updated_at: datetime = Field(..., description="UTC update timestamp")
    finalized_at: Optional[datetime] = Field(None, description="UTC settlement timestamp")

    model_config = ConfigDict(from_attributes=True)


class PaymentStatusResponse(BaseModel):
    """
    Response schema for GET /api/v1/payments/{transaction_id}
    Authoritative, sanitized status response.
    Never exposes OTP values, OTP hashes, card numbers, or sensitive financial credentials.
    """
    transaction_id: str = Field(..., description="Unique generated transaction identifier")
    payment_reference: str = Field(..., description="Unique generated payment reference")
    order_id: str = Field(..., description="Associated merchant order ID")
    amount: float = Field(..., description="Transaction amount")
    currency: str = Field(..., description="Currency code (e.g. INR)")
    payment_method: str = Field(..., description="Payment method used (CARD, UPI, NET_BANKING)")
    status: str = Field(..., description="Current transaction status: PENDING, AUTHENTICATED, PROCESSING, SUCCESS, DECLINED, FAILED")
    current_status: str = Field(..., description="Alias for current transaction status")
    is_finalized: bool = Field(..., description="True if transaction has reached a terminal state (SUCCESS, DECLINED, FAILED)")
    customer_email: Optional[str] = Field(None, description="Masked customer contact email")
    created_at: datetime = Field(..., description="UTC creation timestamp")
    updated_at: datetime = Field(..., description="UTC last update timestamp")
    finalized_at: Optional[datetime] = Field(None, description="UTC settlement timestamp, when applicable")

    model_config = ConfigDict(from_attributes=True)


class PaymentHistoryItem(BaseModel):
    """
    Individual sanitized record in transaction history.
    """
    transaction_id: str = Field(..., description="Unique generated transaction identifier")
    payment_reference: str = Field(..., description="Unique generated payment reference")
    order_id: str = Field(..., description="Associated merchant order ID")
    amount: float = Field(..., description="Transaction amount")
    currency: str = Field(..., description="Currency code")
    payment_method: str = Field(..., description="Payment method")
    status: str = Field(..., description="Transaction status")
    is_finalized: bool = Field(..., description="True if transaction is finalized")
    customer_email: Optional[str] = Field(None, description="Masked customer contact email")
    created_at: datetime = Field(..., description="UTC creation timestamp")
    updated_at: datetime = Field(..., description="UTC last update timestamp")
    finalized_at: Optional[datetime] = Field(None, description="UTC settlement timestamp, when applicable")

    model_config = ConfigDict(from_attributes=True)


class PaymentHistoryResponse(BaseModel):
    """
    Response schema for paginated transaction history GET /api/v1/payments
    """
    items: list[PaymentHistoryItem] = Field(..., description="List of sanitized transaction records")
    total: int = Field(..., description="Total count of transactions matching filter")
    page: int = Field(..., description="Current page number (1-indexed)")
    limit: int = Field(..., description="Maximum items per page")
    pages: int = Field(..., description="Total available pages")

    model_config = ConfigDict(from_attributes=True)
