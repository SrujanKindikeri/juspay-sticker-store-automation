import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001';

export interface SendOtpApiResponse {
  transaction_id: string;
  message: string;
  masked_contact: string;
  expires_in_seconds: number;
  simulated_otp?: string;
}

export interface VerifyOtpApiResponse {
  status: string;
  message: string;
  transaction_id: string;
  payment_reference: string;
  amount: number;
  currency: string;
}

export interface PaymentProcessApiResponse {
  transaction_id: string;
  payment_reference: string;
  order_id: string;
  amount: number;
  currency: string;
  payment_method: string;
  status: string;
  message: string;
  updated_at: string;
}

export async function requestTransactionOtp(transactionId: string): Promise<SendOtpApiResponse> {
  const res = await fetch(`${API_BASE_URL}/api/v1/payments/${transactionId}/send-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(`API send-otp failed: ${res.status} ${JSON.stringify(error)}`);
  }
  return res.json();
}

export async function verifyTransactionOtpApi(
  transactionId: string,
  otp: string
): Promise<VerifyOtpApiResponse> {
  const res = await fetch(`${API_BASE_URL}/api/v1/payments/${transactionId}/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ otp }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(`API verify-otp failed: ${res.status} ${JSON.stringify(error)}`);
  }
  return res.json();
}

export async function processTransactionPaymentApi(
  transactionId: string,
  outcome?: string
): Promise<PaymentProcessApiResponse> {
  const res = await fetch(`${API_BASE_URL}/api/v1/payments/${transactionId}/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(outcome ? { outcome } : {}),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(`API process payment failed: ${res.status} ${JSON.stringify(error)}`);
  }
  return res.json();
}
