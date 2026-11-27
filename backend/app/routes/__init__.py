from fastapi import APIRouter
from app.routes.health import router as health_router
from app.routes.payment import router as payment_router
from app.routes.otp import router as otp_router
from app.routes.store import router as store_router
from app.routes.email_verification import router as email_verification_router
from app.routes.whatsapp_admin import router as whatsapp_admin_router
from app.routes.whatsapp_verification import router as whatsapp_verification_router
from app.routes.paytm import router as paytm_router

api_router = APIRouter()
api_router.include_router(health_router, prefix="")
api_router.include_router(payment_router, prefix="")
api_router.include_router(otp_router, prefix="")
api_router.include_router(store_router, prefix="")
api_router.include_router(email_verification_router, prefix="")
api_router.include_router(whatsapp_admin_router, prefix="")
api_router.include_router(whatsapp_verification_router, prefix="")
api_router.include_router(paytm_router, prefix="")

__all__ = ["api_router"]
