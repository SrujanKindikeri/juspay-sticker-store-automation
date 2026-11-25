import uuid
from typing import Optional, List, Tuple
from datetime import datetime
from sqlalchemy.orm import Session
from fastapi import HTTPException, status
from app.models.payment import PaymentTransaction
from app.schemas.payment import PaymentInitiateRequest
from app.core.config import settings
from app.services.store_service import prepare_store_order_for_payment, sync_store_order_payment_status


VALID_TRANSITIONS = {
    "PENDING": {"AUTHENTICATED", "FAILED"},
    "AUTHENTICATED": {"PROCESSING"},
    "PROCESSING": {"SUCCESS", "DECLINED", "FAILED"},
    "SUCCESS": set(),
    "DECLINED": set(),
    "FAILED": set(),
}


def validate_state_transition(current_status: str, target_status: str) -> None:
    """
    Enforces strict payment lifecycle state transitions on the backend.
    Rejects invalid state jumps with HTTP 400 Bad Request.
    """
    allowed = VALID_TRANSITIONS.get(current_status, set())
    if target_status not in allowed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Invalid transaction status transition from '{current_status}' to '{target_status}'. "
                f"Allowed transitions: {sorted(list(allowed)) if allowed else 'None (terminal state)'}."
            ),
        )


def mask_customer_email(email: Optional[str]) -> Optional[str]:
    """
    Masks customer email for safe public responses (e.g. te****@juspay.demo).
    """
    if not email or "@" not in email:
        return email
    user, domain = email.split("@", 1)
    if len(user) <= 2:
        masked_user = user[0] + "*"
    else:
        masked_user = user[:2] + "****"
    return f"{masked_user}@{domain}"


def generate_transaction_id() -> str:
    """Generates a unique simulation transaction ID (e.g. TXN_8F9A1B2C3D4E)."""
    return f"TXN_{uuid.uuid4().hex[:12].upper()}"


def generate_payment_reference() -> str:
    """Generates a unique payment reference (e.g. PAY_REF_7A8B9C0D1E2F)."""
    return f"PAY_REF_{uuid.uuid4().hex[:12].upper()}"


def initiate_payment_transaction(
    db: Session,
    request: PaymentInitiateRequest,
    idempotency_key: Optional[str] = None,
) -> PaymentTransaction:
    """
    Initiates and records a new payment transaction in PostgreSQL.
    Initial status is set to PENDING.
    
    SECURITY:
    - Sensitive payment credentials (card numbers, CVV, passwords) are
      never saved or persisted.
    - Test scenario triggers ('DECLINE', 'FAIL') are strictly blocked in production.
    
    DUPLICATE & IDEMPOTENCY PROTECTION:
    - Prevents initiating new payments for orders already settled with SUCCESS.
    - If idempotency_key is provided, re-returns the existing transaction.
    """
    # 1. Production security audit: Block test scenario triggers in production
    if not settings.is_development:
        order_upper = (request.order_id or "").upper()
        email_upper = (request.customer_email or "").upper()
        if "DECLINE" in order_upper or "FAIL" in order_upper or "DECLINE" in email_upper or "FAIL" in email_upper:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Test scenario order IDs and email triggers are disabled in production environment.",
            )

    # 2. Duplicate protection: Check if order has already been successfully paid
    existing_success = (
        db.query(PaymentTransaction)
        .filter(
            PaymentTransaction.order_id == request.order_id,
            PaymentTransaction.status == "SUCCESS",
        )
        .first()
    )
    if existing_success:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Order '{request.order_id}' has already been successfully paid (Txn: {existing_success.transaction_id}). Duplicate payment is not allowed.",
        )

    # 3. Phase 8 Store Order verification: Authoritative amount and stock reservation
    prepare_store_order_for_payment(
        db=db,
        order_id=request.order_id,
        requested_amount=request.amount,
    )

    # 4. Idempotency protection: Return existing transaction if matching idempotency key
    if idempotency_key:
        existing_txn = (
            db.query(PaymentTransaction)
            .filter(PaymentTransaction.idempotency_key == idempotency_key)
            .first()
        )
        if existing_txn:
            return existing_txn

    transaction_id = generate_transaction_id()
    payment_reference = generate_payment_reference()

    transaction = PaymentTransaction(
        transaction_id=transaction_id,
        payment_reference=payment_reference,
        order_id=request.order_id,
        amount=request.amount,
        currency=request.currency,
        payment_method=request.payment_method.value,
        status="PENDING",
        customer_email=request.customer_email,
        idempotency_key=idempotency_key,
    )

    db.add(transaction)
    db.commit()
    db.refresh(transaction)

    return transaction


def determine_simulation_outcome(
    txn: PaymentTransaction,
    requested_outcome: Optional[str] = None,
) -> str:
    """
    Safely determines the simulated payment settlement outcome:
    - SUCCESS (default)
    - DECLINED (simulated bank/card network decline)
    - FAILED (simulated gateway processing failure)
    
    Security:
    In production mode, simulation outcome overrides and test keywords
    are strictly disabled.
    """
    # Production security: No outcome overrides or test keyword matching in production
    if not settings.is_development:
        if requested_outcome:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Simulation outcome overrides are disabled in production environment.",
            )
        return "SUCCESS"

    if requested_outcome and requested_outcome.upper() in ("SUCCESS", "FAILED", "DECLINED"):
        return requested_outcome.upper()

    order_upper = (txn.order_id or "").upper()
    email_upper = (txn.customer_email or "").upper()

    if "DECLINE" in order_upper or "DECLINE" in email_upper:
        return "DECLINED"
    if "FAIL" in order_upper or "FAIL" in email_upper:
        return "FAILED"

    return "SUCCESS"


def process_authenticated_payment(
    db: Session,
    transaction_id: str,
    outcome: Optional[str] = None,
    idempotency_key: Optional[str] = None,
) -> PaymentTransaction:
    """
    Processes an AUTHENTICATED payment transaction.
    Executes the simulated settlement lifecycle:
    AUTHENTICATED -> PROCESSING -> SUCCESS / DECLINED / FAILED.
    
    DUPLICATE & CONCURRENCY PROTECTION:
    - Uses SELECT ... FOR UPDATE database row locking to prevent concurrent races.
    - Blocks re-processing of transactions that are PROCESSING or already completed.
    - Safely returns existing finalized transaction if matching idempotency key is supplied.
    """
    # Row-level lock to prevent concurrent duplicate processing races
    txn = (
        db.query(PaymentTransaction)
        .filter(PaymentTransaction.transaction_id == transaction_id)
        .with_for_update()
        .first()
    )
    if not txn:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Transaction '{transaction_id}' not found",
        )

    # Duplicate protection check 1: Currently being processed
    if txn.status == "PROCESSING":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Transaction '{transaction_id}' is currently being processed. Duplicate submission prevented.",
        )

    # Duplicate protection check 2: Already finalized
    if txn.status in ("SUCCESS", "DECLINED", "FAILED"):
        # Idempotent replay: if the caller provides the same idempotency key, return safely
        if idempotency_key and txn.idempotency_key == idempotency_key:
            return txn
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Transaction '{transaction_id}' has already been processed with final status '{txn.status}'. Duplicate payment processing is not allowed.",
        )

    # State transition validation: must be AUTHENTICATED to proceed to PROCESSING
    validate_state_transition(txn.status, "PROCESSING")

    # Step 1: Validate outcome and permissions prior to state mutation
    final_status = determine_simulation_outcome(txn, requested_outcome=outcome)
    validate_state_transition("PROCESSING", final_status)

    # Step 2: Transition status to PROCESSING (atomic flush)
    txn.status = "PROCESSING"
    txn.updated_at = datetime.utcnow()
    db.flush()

    # Step 3: Transition to final status
    now = datetime.utcnow()
    txn.status = final_status
    txn.otp_hash = None  # Ensure OTP hash is never retained once finalized
    txn.finalized_at = now
    txn.updated_at = now
    if idempotency_key:
        txn.idempotency_key = idempotency_key

    # Phase 8: Synchronize final outcome with StoreOrder and inventory
    sync_store_order_payment_status(
        db=db,
        order_id=txn.order_id,
        payment_status=final_status,
        payment_transaction_id=txn.transaction_id,
        payment_reference=txn.payment_reference,
    )

    db.commit()
    db.refresh(txn)

    # Feature 2 & 4: Automatically send HTML confirmation + PDF receipt ONLY after verified SUCCESS
    # Email failures must never roll back or alter a confirmed successful payment.
    if final_status == "SUCCESS" and (txn.order_id or "").startswith("STK-ORD-"):
        try:
            from app.services.email_service import send_order_confirmation_email
            send_order_confirmation_email(db=db, order_id=txn.order_id)
        except Exception:
            pass

    return txn


def get_payment_transaction(db: Session, transaction_id: str) -> PaymentTransaction:
    """
    Retrieves a single payment transaction by transaction_id.
    Raises 404 Not Found if transaction does not exist.
    """
    txn = (
        db.query(PaymentTransaction)
        .filter(PaymentTransaction.transaction_id == transaction_id)
        .first()
    )
    if not txn:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Transaction '{transaction_id}' not found",
        )
    return txn


def get_payment_history(
    db: Session,
    page: int = 1,
    limit: int = 10,
    status_filter: Optional[str] = None,
    payment_method_filter: Optional[str] = None,
) -> Tuple[List[PaymentTransaction], int]:
    """
    Retrieves paginated transaction history, ordered newest-first.
    Supports filtering by status and payment method.
    """
    query = db.query(PaymentTransaction)

    if status_filter:
        query = query.filter(PaymentTransaction.status == status_filter.upper())
    if payment_method_filter:
        query = query.filter(PaymentTransaction.payment_method == payment_method_filter.upper())

    total = query.count()
    items = (
        query.order_by(PaymentTransaction.created_at.desc(), PaymentTransaction.id.desc())
        .offset((page - 1) * limit)
        .limit(limit)
        .all()
    )

    return items, total
