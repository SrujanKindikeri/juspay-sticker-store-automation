import json
import logging
from typing import Optional, Dict, Any
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response, status
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.core.config import settings
from app.schemas.paytm import (
    PaytmConfigResponse,
    PaytmInitiateRequest,
    PaytmInitiateResponse,
    PaytmStatusResponse,
)
from app.services.paytm_service import (
    initiate_paytm_transaction,
    process_paytm_callback,
    query_paytm_transaction_status,
    reconcile_paytm_transaction,
    get_paytm_checkout_js_url,
    verify_paytm_signature,
)
from app.models.payment import PaymentTransaction
from app.models.store import StoreOrder

logger = logging.getLogger("juspay.paytm.routes")

router = APIRouter(prefix="/payments/paytm", tags=["Paytm Gateway Sandbox"])


@router.get(
    "/config",
    response_model=PaytmConfigResponse,
    summary="Get Paytm Gateway Configuration",
    description="Returns public configuration for the active payment provider and Paytm Sandbox environment.",
)
def get_paytm_config() -> PaytmConfigResponse:
    mid = settings.paytm_mid or ""
    masked_mid = f"{mid[:4]}****{mid[-4:]}" if len(mid) >= 8 else (f"{mid[:2]}****" if mid else None)
    is_configured = settings.is_paytm_configured
    is_live = settings.payment_provider.lower() == "paytm" and is_configured
    return PaytmConfigResponse(
        provider=settings.payment_provider,
        enabled=settings.payment_provider == "paytm" or is_configured,
        environment=settings.paytm_environment,
        mid_masked=masked_mid,
        checkout_js_url=get_paytm_checkout_js_url(),
        is_paytm_configured=is_configured,
        is_live=is_live,
    )


@router.post(
    "/initiate",
    response_model=PaytmInitiateResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Initiate Paytm Transaction",
    description="Generates an authoritative txnToken for Paytm JS Checkout Sandbox using the official initiateTransaction API.",
)
def initiate_transaction(
    request: PaytmInitiateRequest,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
) -> PaytmInitiateResponse:
    logger.info(f"Initiating Paytm payment for order {request.order_id} (amount: {request.amount} {request.currency})")
    data = initiate_paytm_transaction(
        db=db,
        order_id=request.order_id,
        amount=request.amount,
        currency=request.currency,
        customer_email=request.customer_email,
        customer_id=request.customer_id,
        callback_url=request.callback_url,
        idempotency_key=idempotency_key,
    )
    return PaytmInitiateResponse(**data)


@router.post(
    "/callback",
    summary="Paytm Payment Callback Endpoint",
    description=(
        "Receives POST callbacks from Paytm Gateway. Validates cryptographic CHECKSUMHASH, "
        "performs S2S authoritative query, and updates transaction and store order status."
    ),
)
async def paytm_callback(
    request: Request,
    db: Session = Depends(get_db),
):
    # Parse payload from form-data or JSON
    content_type = request.headers.get("content-type", "")
    callback_data: Dict[str, Any] = {}

    if "application/x-www-form-urlencoded" in content_type or "multipart/form-data" in content_type:
        form = await request.form()
        callback_data = {k: str(v) for k, v in form.items()}
    else:
        try:
            callback_data = await request.json()
        except Exception:
            body_bytes = await request.body()
            try:
                callback_data = json.loads(body_bytes.decode("utf-8"))
            except Exception:
                callback_data = {}

    order_id = callback_data.get("ORDERID") or callback_data.get("orderId")
    logger.info(f"Received Paytm callback for order '{order_id}'")

    txn, store_order = process_paytm_callback(db=db, callback_data=callback_data)

    # If request is from browser form POST, redirect back to payment status page
    accept_header = request.headers.get("accept", "")
    frontend_base = "http://localhost:3001"
    
    redirect_target = f"{frontend_base}/payment?order_id={order_id}&paytm_status={txn.status}&transaction_id={txn.transaction_id}"

    if "text/html" in accept_header or "application/x-www-form-urlencoded" in content_type:
        # Return an HTML auto-redirect so the browser navigates smoothly to frontend status
        html_content = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <title>Processing Payment...</title>
            <meta http-equiv="refresh" content="1;url={redirect_target}">
        </head>
        <body style="font-family: -apple-system, sans-serif; text-align: center; padding: 40px;">
            <h2>Payment Complete</h2>
            <p>Finalizing transaction status ({txn.status}). Redirecting to Stickora Store...</p>
            <script>window.location.href = "{redirect_target}";</script>
        </body>
        </html>
        """
        return HTMLResponse(content=html_content, status_code=200)

    return {
        "status": "ok",
        "order_id": order_id,
        "transaction_id": txn.transaction_id,
        "payment_status": txn.status,
        "store_order_status": store_order.status if store_order else None,
        "is_finalized": txn.is_finalized,
    }


@router.get(
    "/status/{order_id}",
    response_model=PaytmStatusResponse,
    summary="Get Paytm Transaction Status",
    description="Retrieves the current authoritative payment status for an order paid via Paytm.",
)
def get_status(
    order_id: str,
    db: Session = Depends(get_db),
) -> PaytmStatusResponse:
    txn = (
        db.query(PaymentTransaction)
        .filter(PaymentTransaction.order_id == order_id)
        .order_by(PaymentTransaction.created_at.desc())
        .first()
    )
    if not txn:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No payment transaction found for order '{order_id}'.",
        )

    store_order = db.query(StoreOrder).filter(StoreOrder.order_id == order_id).first()

    return PaytmStatusResponse(
        order_id=order_id,
        transaction_id=txn.transaction_id,
        payment_reference=txn.payment_reference,
        status=txn.status,
        is_finalized=txn.is_finalized,
        amount=txn.amount,
        gateway_transaction_id=txn.gateway_transaction_id,
        gateway_response_code=txn.gateway_response_code,
        gateway_response_msg=txn.gateway_response_msg,
        store_order_status=store_order.status if store_order else None,
    )


@router.post(
    "/reconcile/{order_id}",
    response_model=PaytmStatusResponse,
    summary="Reconcile Pending Paytm Transaction",
    description="Performs an authoritative server-to-server inquiry against Paytm gateway and updates database state.",
)
def reconcile_transaction(
    order_id: str,
    db: Session = Depends(get_db),
) -> PaytmStatusResponse:
    txn, store_order = reconcile_paytm_transaction(db=db, order_id=order_id)
    return PaytmStatusResponse(
        order_id=order_id,
        transaction_id=txn.transaction_id,
        payment_reference=txn.payment_reference,
        status=txn.status,
        is_finalized=txn.is_finalized,
        amount=txn.amount,
        gateway_transaction_id=txn.gateway_transaction_id,
        gateway_response_code=txn.gateway_response_code,
        gateway_response_msg=txn.gateway_response_msg,
        store_order_status=store_order.status if store_order else None,
    )
