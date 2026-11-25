import logging
import math
from typing import Optional, List
from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy.orm import Session
from app.database.session import get_db
from app.core.config import settings
from app.schemas.payment import (
    PaymentInitiateRequest,
    PaymentInitiateResponse,
    PaymentProcessRequest,
    PaymentProcessResponse,
    PaymentStatusResponse,
    PaymentHistoryItem,
    PaymentHistoryResponse,
)
from app.services.payment_service import (
    initiate_payment_transaction,
    process_authenticated_payment,
    get_payment_transaction,
    get_payment_history,
    mask_customer_email,
)

logger = logging.getLogger("juspay.payments")

router = APIRouter(prefix="/payments", tags=["Payments"])


@router.get(
    "",
    response_model=PaymentHistoryResponse,
    status_code=status.HTTP_200_OK,
    summary="Get Transaction History",
    description=(
        "Retrieves paginated payment transaction history sorted newest-first. "
        "Supports filtering by status and payment method. "
        "SECURITY NOTICE: This endpoint is provided for the local demonstration environment and merchant dashboard. "
        "Prior to public production deployment, it must be secured with production authentication and role-based access control."
    ),
)
def list_payments(
    page: int = Query(1, ge=1, description="Page number starting at 1"),
    limit: int = Query(10, ge=1, le=100, description="Items per page"),
    status_filter: Optional[str] = Query(None, alias="status", description="Filter by status (PENDING, AUTHENTICATED, PROCESSING, SUCCESS, DECLINED, FAILED)"),
    payment_method: Optional[str] = Query(None, alias="payment_method", description="Filter by payment method (CARD, UPI, NET_BANKING)"),
    db: Session = Depends(get_db),
) -> PaymentHistoryResponse:
    """
    Endpoint: GET /api/v1/payments
    """
    items, total = get_payment_history(
        db=db,
        page=page,
        limit=limit,
        status_filter=status_filter,
        payment_method_filter=payment_method,
    )
    pages = math.ceil(total / limit) if total > 0 else 1
    history_items = [
        PaymentHistoryItem(
            transaction_id=t.transaction_id,
            payment_reference=t.payment_reference,
            order_id=t.order_id,
            amount=t.amount,
            currency=t.currency,
            payment_method=t.payment_method,
            status=t.status,
            is_finalized=t.is_finalized,
            customer_email=mask_customer_email(t.customer_email),
            created_at=t.created_at,
            updated_at=t.updated_at,
            finalized_at=t.finalized_at,
        )
        for t in items
    ]
    return PaymentHistoryResponse(
        items=history_items,
        total=total,
        page=page,
        limit=limit,
        pages=pages,
    )


@router.post(
    "/initiate",
    response_model=PaymentInitiateResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Initiate Simulated Payment",
    description="Initiates a simulated payment transaction (CARD, UPI, NET_BANKING), generates a transaction ID and payment reference, and stores the record as PENDING in PostgreSQL.",
)
def initiate_payment(
    request: PaymentInitiateRequest,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
) -> PaymentInitiateResponse:
    """
    Endpoint: POST /api/v1/payments/initiate
    """
    logger.info(
        f"Received payment initiation request for order {request.order_id} "
        f"using method {request.payment_method} amount: {request.amount} {request.currency}"
    )

    transaction = initiate_payment_transaction(db=db, request=request, idempotency_key=idempotency_key)

    logger.info(
        f"Payment initiated successfully: TxnID={transaction.transaction_id}, "
        f"Ref={transaction.payment_reference}, Status={transaction.status}"
    )

    return PaymentInitiateResponse(
        transaction_id=transaction.transaction_id,
        payment_reference=transaction.payment_reference,
        order_id=transaction.order_id,
        amount=transaction.amount,
        currency=transaction.currency,
        payment_method=transaction.payment_method,
        status=transaction.status,
        created_at=transaction.created_at,
    )


@router.post(
    "/{transaction_id}/process",
    response_model=PaymentProcessResponse,
    status_code=status.HTTP_200_OK,
    summary="Process Authenticated Payment",
    description="Processes an AUTHENTICATED payment transaction, transitioning status: AUTHENTICATED -> PROCESSING -> SUCCESS/DECLINED/FAILED.",
)
def process_payment(
    transaction_id: str,
    payload: Optional[PaymentProcessRequest] = None,
    outcome: Optional[str] = None,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
) -> PaymentProcessResponse:
    """
    Endpoint: POST /api/v1/payments/{transaction_id}/process
    """
    requested_outcome = payload.outcome if payload and payload.outcome else outcome
    if not settings.is_development and requested_outcome:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Simulation outcome overrides are disabled in production environment.",
        )
    logger.info(f"Processing payment for transaction {transaction_id} (outcome target: {requested_outcome or 'AUTO'})")
    txn = process_authenticated_payment(
        db=db,
        transaction_id=transaction_id,
        outcome=requested_outcome,
        idempotency_key=idempotency_key,
    )
    logger.info(f"Payment completed: TxnID={txn.transaction_id}, Status={txn.status}")

    msg_map = {
        "SUCCESS": "Payment processed and captured successfully",
        "DECLINED": "Payment was declined by simulated card network or bank",
        "FAILED": "Payment processing failed in simulation sandbox",
    }

    return PaymentProcessResponse(
        transaction_id=txn.transaction_id,
        payment_reference=txn.payment_reference,
        order_id=txn.order_id,
        amount=txn.amount,
        currency=txn.currency,
        payment_method=txn.payment_method,
        status=txn.status,
        message=msg_map.get(txn.status, f"Transaction status: {txn.status}"),
        updated_at=txn.updated_at,
        finalized_at=txn.finalized_at,
    )


@router.get(
    "/{transaction_id}",
    response_model=PaymentStatusResponse,
    status_code=status.HTTP_200_OK,
    summary="Get Transaction Status",
    description=(
        "Retrieves authoritative, sanitized status and details for a payment transaction. "
        "Never exposes OTP values, hashes, card numbers, CVVs, or sensitive credentials."
    ),
)
def get_payment_status(
    transaction_id: str,
    db: Session = Depends(get_db),
) -> PaymentStatusResponse:
    """
    Endpoint: GET /api/v1/payments/{transaction_id}
    """
    txn = get_payment_transaction(db=db, transaction_id=transaction_id)
    return PaymentStatusResponse(
        transaction_id=txn.transaction_id,
        payment_reference=txn.payment_reference,
        order_id=txn.order_id,
        amount=txn.amount,
        currency=txn.currency,
        payment_method=txn.payment_method,
        status=txn.status,
        current_status=txn.status,
        is_finalized=txn.is_finalized,
        customer_email=mask_customer_email(txn.customer_email),
        created_at=txn.created_at,
        updated_at=txn.updated_at,
        finalized_at=txn.finalized_at,
    )
