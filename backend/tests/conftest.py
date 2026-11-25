import os
import sys
from typing import Generator
import pytest
from fastapi.testclient import TestClient

# Ensure backend root is on sys.path
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.main import app
from app.core.config import settings

# Safeguard: never dispatch real WhatsApp messages during automated Pytest suites
# unless a specific mock/integration test explicitly toggles and restores this flag.
settings.whatsapp_dispatch_enabled = False


@pytest.fixture(scope="session")
def client() -> Generator[TestClient, None, None]:
    """Test client fixture using FastAPI's TestClient."""
    with TestClient(app) as test_client:
        yield test_client


def verify_test_email(client: TestClient, email: str) -> dict:
    """
    Helper to verify a customer email address via the real Email Verification OTP endpoints
    and return the proof fields required for POST /api/v1/store/orders.
    """
    send_res = client.post("/api/v1/email-verification/send-otp", json={"email": email})
    assert send_res.status_code == 200, f"Email OTP send failed: {send_res.text}"
    send_data = send_res.json()
    session_id = send_data["session_id"]
    otp = send_data["simulated_otp"]
    assert otp and len(otp) == 6

    verify_res = client.post(
        "/api/v1/email-verification/verify-otp",
        json={"session_id": session_id, "email": email, "otp": otp},
    )
    assert verify_res.status_code == 200, f"Email OTP verify failed: {verify_res.text}"
    verify_data = verify_res.json()
    assert verify_data["verified"] is True

    return {
        "email_verification_session_id": session_id,
        "email_verification_token": verify_data["verification_token"],
    }
