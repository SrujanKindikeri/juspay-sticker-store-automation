export type PaymentMethodId = 'card' | 'upi' | 'netbanking';

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
