export type PaymentMethodId = 'card' | 'upi' | 'netbanking' | 'paytm';

export interface PaytmConfig {
  provider: 'simulated' | 'paytm';
  enabled: boolean;
  environment: string;
  mid_masked: string | null;
  checkout_js_url: string;
  is_paytm_configured?: boolean;
  is_live?: boolean;
}

export interface PaytmInitiateResponse {
  transaction_id: string;
  payment_reference: string;
  order_id: string;
  amount: number;
  currency: string;
  txn_token: string;
  mid: string;
  callback_url: string;
  checkout_js_url: string;
  status: string;
}

export interface PaymentMethodOption {
  id: PaymentMethodId;
  title: string;
  subtitle: string;
  badge?: string;
}

export interface OrderDetails {
  merchantName: string;
  productName: string;
  orderId: string;
  amount: number;
  currency: string;
  baseAmount: number;
  tax: number;
}

export interface BackendHealth {
  status: string;
  environment: string;
  database: string;
  version: string;
  timestamp?: string;
}

export interface CardFormData {
  cardNumber: string;
  expiry: string;
  cvv: string;
  cardHolder: string;
}

export interface UpiFormData {
  upiId: string;
  appName?: string;
}

export interface NetBankingFormData {
  selectedBank: string;
}

export interface PaymentInitiateResponse {
  transaction_id: string;
  payment_reference: string;
  order_id: string;
  amount: number;
  currency: string;
  payment_method: string;
  status: string;
  created_at: string;
}
