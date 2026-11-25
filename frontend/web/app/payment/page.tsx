'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Header } from '@/components/Header';
import { OrderSummary } from '@/components/OrderSummary';
import { SimulationNotice } from '@/components/SimulationNotice';
import { PaymentMethodSelector } from '@/components/PaymentMethodSelector';
import { CardPaymentPanel } from '@/components/CardPaymentPanel';
import { UpiPaymentPanel } from '@/components/UpiPaymentPanel';
import { NetBankingPaymentPanel } from '@/components/NetBankingPaymentPanel';
import { PaymentAction } from '@/components/PaymentAction';
import { OtpVerification } from '@/components/OtpVerification';
import {
  PaymentMethodId,
  OrderDetails,
  BackendHealth,
  CardFormData,
  UpiFormData,
  NetBankingFormData,
  PaymentInitiateResponse,
} from '@/types/checkout';

const demoOrder: OrderDetails = {
  merchantName: 'Demo Store',
  productName: 'Premium Demo Subscription',
  orderId: 'DEMO-ORD-89210',
  amount: 999.0,
  currency: 'INR',
  baseAmount: 846.61,
  tax: 152.39,
};

type CheckoutStep = 'checkout' | 'otp' | 'pending' | 'success' | 'failed' | 'declined';

export default function CheckoutPage() {
  const [step, setStep] = useState<CheckoutStep>('checkout');
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethodId>('card');
  const [orderInfo, setOrderInfo] = useState<OrderDetails>(demoOrder);
  const [health, setHealth] = useState<BackendHealth | null>(null);
  const [healthLoading, setHealthLoading] = useState<boolean>(true);
  const [processingLabel, setProcessingLabel] = useState<string>('');
  const submitPaymentLockRef = useRef<boolean>(false);

  // Form states
  const [cardData, setCardData] = useState<CardFormData>({
    cardNumber: '4111 2222 3333 4444',
    expiry: '12/28',
    cvv: '123',
    cardHolder: 'DEMO TESTER',
  });

  const [upiData, setUpiData] = useState<UpiFormData>({
    upiId: 'demo.tester@okaxis',
    appName: 'gpay',
  });

  const [netBankingData, setNetBankingData] = useState<NetBankingFormData>({
    selectedBank: 'HDFC',
  });

  // Submission & API states
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentResult, setPaymentResult] = useState<PaymentInitiateResponse | null>(null);
  const [initialOtp, setInitialOtp] = useState<string>('');
  const [completedPayment, setCompletedPayment] = useState<any>(null);
  const [failureReason, setFailureReason] = useState<string>('');
  const [storeOrder, setStoreOrder] = useState<any>(null);
  const [orderToken, setOrderToken] = useState<string>('');

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001';

  const checkHealth = async () => {
    try {
      const res = await fetch(`${apiUrl}/health`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setHealth(data);
      } else {
        setHealth(null);
      }
    } catch {
      setHealth(null);
    } finally {
      setHealthLoading(false);
    }
  };

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 20000);

    // Support test scenario parameter and authoritative transaction lookup on page refresh
    if (typeof window !== 'undefined') {
      const isProduction = process.env.NEXT_PUBLIC_APP_ENV === 'production';
      const params = new URLSearchParams(window.location.search);
      const scenario = params.get('scenario');
      const customOrderId = params.get('order_id');
      const txnId = params.get('transaction_id');
      const tokenParam = params.get('token');

      if (tokenParam) {
        setOrderToken(tokenParam);
      }

      if (!isProduction) {
        if (scenario === 'DECLINED') {
          setOrderInfo((prev) => ({ ...prev, orderId: 'DEMO-ORD-DECLINE-89210' }));
        } else if (scenario === 'FAILED') {
          setOrderInfo((prev) => ({ ...prev, orderId: 'DEMO-ORD-FAIL-89210' }));
        } else if (customOrderId) {
          setOrderInfo((prev) => ({ ...prev, orderId: customOrderId }));
        }
      } else if (customOrderId) {
        setOrderInfo((prev) => ({ ...prev, orderId: customOrderId }));
      }

      // If this is a physical sticker store order (STK-ORD-...), fetch authoritative order details
      if (customOrderId && customOrderId.startsWith('STK-ORD-')) {
        const fetchStoreOrder = async () => {
          try {
            const tokenQuery = tokenParam ? `?token=${encodeURIComponent(tokenParam)}` : '';
            const headers: Record<string, string> = {};
            if (tokenParam) {
              headers['X-Order-Token'] = tokenParam;
            }
            const res = await fetch(`${apiUrl}/api/v1/store/orders/${customOrderId}${tokenQuery}`, {
              headers,
              cache: 'no-store',
            });
            if (res.ok) {
              const storeData = await res.json();
              setStoreOrder(storeData);
              setOrderInfo({
                merchantName: 'Stickora',
                productName: `Premium Vinyl Stickers (${storeData.items?.length || 1} item${(storeData.items?.length || 1) > 1 ? 's' : ''})`,
                orderId: storeData.order_id,
                amount: storeData.total_amount,
                currency: storeData.currency || 'INR',
                baseAmount: storeData.subtotal,
                tax: storeData.delivery_fee,
              });

              if (storeData.status === 'PAID') {
                setCompletedPayment({
                  order_id: storeData.order_id,
                  status: 'SUCCESS',
                  amount: storeData.total_amount,
                  currency: storeData.currency || 'INR',
                  payment_reference: storeData.payment_reference || 'REF-STORE-PAID',
                  transaction_id: storeData.payment_transaction_id || 'TXN-STORE-PAID',
                  payment_method: 'PREVIOUSLY_AUTHENTICATED',
                });
                setStep('success');
              } else if (storeData.status === 'PAYMENT_FAILED') {
                setFailureReason('Previous payment attempt failed or was declined. You can safely retry payment below.');
              }
            } else {
              const errData = await res.json().catch(() => null);
              setPaymentError(
                typeof errData?.detail === 'string'
                  ? errData.detail
                  : `Unable to load order '${customOrderId}' (HTTP ${res.status}).`
              );
            }
          } catch (e) {
            console.error('Failed to load store order', e);
            setPaymentError('Unable to reach backend to verify order details. Please refresh or try again.');
          }
        };
        fetchStoreOrder();
      }

      // Authoritative backend recovery if refreshing a result page
      if (txnId) {
        const loadAuthoritativeStatus = async () => {
          setIsLoading(true);
          setProcessingLabel('Verifying transaction status with JUSPAY backend...');
          try {
            const res = await fetch(`${apiUrl}/api/v1/payments/${txnId}`, { cache: 'no-store' });
            if (res.ok) {
              const data = await res.json();
              setCompletedPayment(data);
              if (data.status === 'SUCCESS') {
                setStep('success');
              } else if (data.status === 'DECLINED') {
                setFailureReason('Your transaction was declined by the simulated card issuer / bank network.');
                setStep('declined');
              } else if (data.status === 'FAILED') {
                setFailureReason('The transaction could not be verified and has been marked as FAILED.');
                setStep('failed');
              } else if (
                data.status === 'PENDING' ||
                data.status === 'AUTHENTICATED' ||
                data.status === 'PROCESSING'
              ) {
                setPaymentResult(data);
                setStep('pending');
              }
            }
          } catch {
            // ignore fetch error on mount
          } finally {
            setIsLoading(false);
            setProcessingLabel('');
          }
        };
        loadAuthoritativeStatus();
      }
    }

    return () => clearInterval(interval);
  }, [apiUrl]);

  const handlePaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitPaymentLockRef.current || isLoading) {
      return;
    }
    setPaymentError(null);

    // 1. Client-side validation
    if (selectedMethod === 'card') {
      const cleanCard = cardData.cardNumber.replace(/[\s-]/g, '');
      if (!cleanCard || cleanCard.length < 13 || cleanCard.length > 19) {
        setPaymentError('Please enter a valid card number (13-19 digits).');
        return;
      }
      if (!/^(0[1-9]|1[0-2])\/[0-9]{2}$/.test(cardData.expiry.trim())) {
        setPaymentError('Please enter a valid expiry date in MM/YY format (e.g. 12/28).');
        return;
      }
      if (!/^[0-9]{3,4}$/.test(cardData.cvv.trim())) {
        setPaymentError('Please enter a valid 3 or 4 digit CVV.');
        return;
      }
      if (!cardData.cardHolder.trim()) {
        setPaymentError('Please enter the cardholder name.');
        return;
      }
    } else if (selectedMethod === 'upi') {
      if (!/^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/.test(upiData.upiId.trim())) {
        setPaymentError('Please enter a valid UPI ID (e.g. tester@okhdfcbank).');
        return;
      }
    } else if (selectedMethod === 'netbanking') {
      if (!netBankingData.selectedBank) {
        setPaymentError('Please select a bank.');
        return;
      }
    }

    // 2. Build payload
    const methodEnum =
      selectedMethod === 'card'
        ? 'CARD'
        : selectedMethod === 'upi'
        ? 'UPI'
        : 'NET_BANKING';

    const triggerDecline =
      (selectedMethod === 'card' && cardData.cardHolder.toLowerCase().includes('decline')) ||
      (selectedMethod === 'upi' && upiData.upiId.toLowerCase().includes('decline')) ||
      orderInfo.orderId.includes('DECLINE');

    const triggerFail =
      (selectedMethod === 'card' && cardData.cardHolder.toLowerCase().includes('fail')) ||
      (selectedMethod === 'upi' && upiData.upiId.toLowerCase().includes('fail')) ||
      orderInfo.orderId.includes('FAIL');

    let customerEmail = 'tester@juspay.demo';
    if (storeOrder?.delivery?.email) {
      customerEmail = storeOrder.delivery.email;
    }

    const isProduction = process.env.NEXT_PUBLIC_APP_ENV === 'production';
    if (!isProduction) {
      if (triggerDecline) customerEmail = 'decline@juspay.demo';
      if (triggerFail) customerEmail = 'fail@juspay.demo';
    }

    const payload: any = {
      order_id: orderInfo.orderId,
      amount: orderInfo.amount,
      currency: orderInfo.currency,
      payment_method: methodEnum,
      customer_email: customerEmail,
    };

    if (selectedMethod === 'card') {
      payload.card_details = {
        card_number: cardData.cardNumber,
        expiry: cardData.expiry,
        cvv: cardData.cvv,
        card_holder: cardData.cardHolder,
      };
    } else if (selectedMethod === 'upi') {
      payload.upi_details = {
        upi_id: upiData.upiId,
        app_name: upiData.appName,
      };
    } else if (selectedMethod === 'netbanking') {
      payload.netbanking_details = {
        bank_code: netBankingData.selectedBank,
      };
    }

    // 3. Initiate payment with FastAPI backend
    submitPaymentLockRef.current = true;
    setIsLoading(true);
    setProcessingLabel('Creating secure JUSPAY payment session...');
    try {
      const res = await fetch(`${apiUrl}/api/v1/payments/initiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const detailMsg =
          errorData.detail?.[0]?.msg ||
          errorData.detail ||
          `Payment initiation failed with HTTP ${res.status}`;
        throw new Error(detailMsg);
      }

      const result: PaymentInitiateResponse = await res.json();
      setPaymentResult(result);

      // 4. Request initial OTP for the transaction
      setProcessingLabel('Generating cryptographic 6-digit OTP...');
      const otpRes = await fetch(`${apiUrl}/api/v1/payments/${result.transaction_id}/send-otp`, {
        method: 'POST',
      });
      if (otpRes.ok) {
        const otpData = await otpRes.json();
        if (otpData.simulated_otp) {
          setInitialOtp(otpData.simulated_otp);
        }
      }

      // Transition to OTP step
      setStep('otp');
    } catch (err: any) {
      setPaymentError(err.message || 'Network error: Unable to connect to payment server.');
    } finally {
      submitPaymentLockRef.current = false;
      setIsLoading(false);
      setProcessingLabel('');
    }
  };

  const syncStoreOrderFromBackend = async () => {
    if (!orderInfo.orderId.startsWith('STK-ORD-')) return;
    try {
      const tokenQuery = orderToken ? `?token=${encodeURIComponent(orderToken)}` : '';
      const headers: Record<string, string> = orderToken ? { 'X-Order-Token': orderToken } : {};
      const res = await fetch(`${apiUrl}/api/v1/store/orders/${orderInfo.orderId}${tokenQuery}`, {
        headers,
        cache: 'no-store',
      });
      if (res.ok) {
        const freshOrder = await res.json();
        setStoreOrder(freshOrder);
      }
    } catch (e) {
      console.error('Failed to sync store order status', e);
    }
  };

  const handleOtpSuccess = async (verifiedData: any) => {
    let authoritativeData = verifiedData;

    // Never trust frontend state alone: verify finalized payment status directly with backend
    if (verifiedData?.transaction_id) {
      try {
        const statusRes = await fetch(
          `${apiUrl}/api/v1/payments/${verifiedData.transaction_id}`,
          { cache: 'no-store' }
        );
        if (statusRes.ok) {
          authoritativeData = await statusRes.json();
        }
      } catch (e) {
        console.error('Backend verification check warning:', e);
      }
    }

    if (typeof window !== 'undefined' && authoritativeData?.transaction_id) {
      const url = new URL(window.location.href);
      url.searchParams.set('transaction_id', authoritativeData.transaction_id);
      window.history.replaceState({}, '', url.toString());
    }

    if (authoritativeData?.status === 'SUCCESS') {
      setCompletedPayment(authoritativeData);
      setStep('success');
      setStoreOrder((prev: any) => (prev ? { ...prev, status: 'PAID' } : null));
      await syncStoreOrderFromBackend();
    } else if (authoritativeData?.status === 'DECLINED') {
      setCompletedPayment(authoritativeData);
      setFailureReason(
        authoritativeData.message || 'Payment was declined by card network / bank simulator.'
      );
      setStep('declined');
      await syncStoreOrderFromBackend();
    } else if (authoritativeData?.status === 'FAILED') {
      setCompletedPayment(authoritativeData);
      setFailureReason(
        authoritativeData.message || 'The transaction could not be verified and was marked FAILED.'
      );
      setStep('failed');
      await syncStoreOrderFromBackend();
    } else {
      setPaymentResult(authoritativeData);
      setCompletedPayment(authoritativeData);
      setStep('pending');
    }
  };

  const handleOtpDeclined = async (declinedData: any) => {
    setCompletedPayment(declinedData);
    setFailureReason(declinedData.message || 'Payment was declined by card network / bank simulator.');
    setStep('declined');
    setStoreOrder((prev: any) => (prev ? { ...prev, status: 'PAYMENT_FAILED' } : null));
    if (typeof window !== 'undefined' && declinedData.transaction_id) {
      const url = new URL(window.location.href);
      url.searchParams.set('transaction_id', declinedData.transaction_id);
      window.history.replaceState({}, '', url.toString());
    }
    await syncStoreOrderFromBackend();
  };

  const handleOtpFailure = async (reason: string) => {
    setFailureReason(reason);
    setStep('failed');
    setStoreOrder((prev: any) => (prev ? { ...prev, status: 'PAYMENT_FAILED' } : null));
    if (typeof window !== 'undefined' && paymentResult?.transaction_id) {
      const url = new URL(window.location.href);
      url.searchParams.set('transaction_id', paymentResult.transaction_id);
      window.history.replaceState({}, '', url.toString());
    }
    await syncStoreOrderFromBackend();
  };

  const handleRefreshPendingStatus = async () => {
    const txnId = completedPayment?.transaction_id || paymentResult?.transaction_id;
    if (!txnId) return;
    setIsLoading(true);
    setProcessingLabel('Checking latest payment status...');
    try {
      const res = await fetch(`${apiUrl}/api/v1/payments/${txnId}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setCompletedPayment(data);
        if (data.status === 'SUCCESS') {
          setStep('success');
          await syncStoreOrderFromBackend();
        } else if (data.status === 'DECLINED') {
          setFailureReason('Your transaction was declined by the simulated bank network.');
          setStep('declined');
          await syncStoreOrderFromBackend();
        } else if (data.status === 'FAILED') {
          setFailureReason('The transaction failed verification.');
          setStep('failed');
          await syncStoreOrderFromBackend();
        } else {
          setPaymentResult(data);
        }
      }
    } catch {
      setPaymentError('Unable to reach backend to check status.');
    } finally {
      setIsLoading(false);
      setProcessingLabel('');
    }
  };

  const handleDownloadReceipt = () => {
    const txnId = completedPayment?.transaction_id || paymentResult?.transaction_id || 'N/A';
    const refId = completedPayment?.payment_reference || paymentResult?.payment_reference || 'N/A';
    const ordId = completedPayment?.order_id || paymentResult?.order_id || orderInfo.orderId;
    const amt = (completedPayment?.amount || paymentResult?.amount || orderInfo.amount).toFixed(2);
    const curr = completedPayment?.currency || paymentResult?.currency || orderInfo.currency;
    const method = completedPayment?.payment_method || paymentResult?.payment_method || selectedMethod.toUpperCase();
    const timestamp = completedPayment?.finalized_at
      ? new Date(completedPayment.finalized_at).toLocaleString()
      : new Date().toLocaleString();

    const itemLines = storeOrder?.items?.length
      ? storeOrder.items
          .map(
            (it: any) =>
              `  - ${it.product_name} (Qty: ${it.quantity} x ₹${Number(it.unit_price).toFixed(2)}) = ₹${Number(
                it.total_price
              ).toFixed(2)}`
          )
          .join('\n')
      : `  - ${orderInfo.productName} = ₹${amt}`;

    const deliveryBlock = storeOrder?.delivery
      ? `\nDelivery Address:\n  ${storeOrder.delivery.full_name}\n  ${storeOrder.delivery.address_line}\n  ${storeOrder.delivery.city}, ${storeOrder.delivery.state} - ${storeOrder.delivery.pincode}\n  Phone: ${storeOrder.delivery.mobile_number} | Email: ${storeOrder.delivery.email}\n`
      : '';

    const receiptText = [
      '============================================================',
      '           STICKORA — PREMIUM VINYL STICKERS                ',
      '           Official Payment Receipt (JUSPAY Sandbox)        ',
      '============================================================',
      `Status          : PAYMENT SUCCESSFUL (ORDER ${storeOrder?.status || 'PAID'})`,
      `Transaction ID  : ${txnId}`,
      `Order ID        : ${ordId}`,
      `Payment Ref     : ${refId}`,
      `Amount Paid     : INR ${amt} (${curr})`,
      `Payment Method  : ${method}`,
      `Date & Time     : ${timestamp}`,
      '------------------------------------------------------------',
      'Purchased Products:',
      itemLines,
      deliveryBlock,
      '------------------------------------------------------------',
      'NOTE: Simulated Sandbox Receipt. No real financial debit.',
      '============================================================',
    ].join('\n');

    const blob = new Blob([receiptText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Stickora-Receipt-${ordId}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const resetToCheckout = () => {
    setStep('checkout');
    setPaymentResult(null);
    setPaymentError(null);
    setInitialOtp('');
    setCompletedPayment(null);
    setFailureReason('');
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('transaction_id');
      window.history.replaceState({}, '', url.pathname + (url.search ? url.search : ''));
    }
  };

  return (
    <div className="page-root" data-testid="checkout-page">
      {/* Header with Juspay branding, SSL indicator, and health badge */}
      <Header health={health} healthLoading={healthLoading} />

      <main className="checkout-wrapper">
        <div className="checkout-grid">
          {/* Left Column: Order Summary & Simulation Notices */}
          <div className="left-column">
            <OrderSummary order={orderInfo} storeItems={storeOrder?.items} />
            <SimulationNotice />
          </div>

          {/* Right Column: Contextual Journey Component */}
          <div className="right-column">
            {/* Transaction Processing Animation Banner */}
            {isLoading && (
              <div className="processing-banner-card" data-testid="transaction-processing-overlay" role="status" aria-live="polite">
                <div className="processing-ring" aria-hidden="true" />
                <div>
                  <strong className="processing-banner-title">Processing Transaction</strong>
                  <p className="processing-banner-sub">{processingLabel || 'Connecting to JUSPAY Payment Gateway...'}</p>
                </div>
              </div>
            )}

            {/* Step 1: Active Payment Form */}
            {step === 'checkout' && (
              <form
                noValidate
                className="checkout-main-card"
                data-testid="payment-form"
                onSubmit={handlePaymentSubmit}
              >
                {/* Payment Method Selector */}
                <PaymentMethodSelector
                  selectedMethod={selectedMethod}
                  onSelectMethod={setSelectedMethod}
                />

                {/* Contextual Payment Details Panel */}
                {selectedMethod === 'card' && (
                  <CardPaymentPanel data={cardData} onChange={setCardData} />
                )}
                {selectedMethod === 'upi' && (
                  <UpiPaymentPanel data={upiData} onChange={setUpiData} />
                )}
                {selectedMethod === 'netbanking' && (
                  <NetBankingPaymentPanel
                    data={netBankingData}
                    onChange={setNetBankingData}
                  />
                )}

                {/* Error Banner */}
                {paymentError && (
                  <div className="payment-error-box" data-testid="payment-error">
                    <span>⚠️</span>
                    <span>{paymentError}</span>
                  </div>
                )}

                {/* Continue to Payment Action */}
                <PaymentAction
                  amount={orderInfo.amount}
                  isLoading={isLoading}
                />
              </form>
            )}

            {/* Step 2: OTP Verification Interface */}
            {step === 'otp' && paymentResult && (
              <OtpVerification
                paymentResult={paymentResult}
                initialSimulatedOtp={initialOtp}
                apiUrl={apiUrl}
                onBackToCheckout={resetToCheckout}
                onPaymentCompleted={handleOtpSuccess}
                onPaymentDeclined={handleOtpDeclined}
                onPaymentFailed={handleOtpFailure}
              />
            )}

            {/* Step 2b: Dedicated Pending Payment Screen */}
            {step === 'pending' && (completedPayment || paymentResult) && (
              <section className="result-card pending" data-testid="payment-pending">
                <div className="result-icon-badge pending">⏳</div>
                <h3 className="result-title">Payment Pending Verification</h3>
                <p className="result-subtitle">
                  Your transaction is currently awaiting final confirmation from JUSPAY Gateway. No duplicate charge has been created.
                </p>

                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
                  <div className="result-status-pill pending" data-testid="payment-status-badge">
                    ● STATUS: {completedPayment?.status || paymentResult?.status || 'PENDING'}
                  </div>
                  {orderInfo.orderId.startsWith('STK-ORD-') && (
                    <div className="result-status-pill pending" data-testid="order-status-badge">
                      ● ORDER: {storeOrder?.status || 'PENDING_PAYMENT'}
                    </div>
                  )}
                </div>

                <table className="receipt-table">
                  <tbody>
                    <tr>
                      <td className="receipt-label">Transaction ID</td>
                      <td className="receipt-val">
                        <code data-testid="transaction-id">
                          {completedPayment?.transaction_id || paymentResult?.transaction_id}
                        </code>
                      </td>
                    </tr>
                    <tr>
                      <td className="receipt-label">Order ID</td>
                      <td className="receipt-val" data-testid="order-id">
                        {completedPayment?.order_id || paymentResult?.order_id || orderInfo.orderId}
                      </td>
                    </tr>
                    <tr>
                      <td className="receipt-label">Payment Reference</td>
                      <td className="receipt-val">
                        <code data-testid="transaction-reference">
                          {completedPayment?.payment_reference || paymentResult?.payment_reference}
                        </code>
                      </td>
                    </tr>
                    <tr>
                      <td className="receipt-label">Amount</td>
                      <td className="receipt-val" data-testid="amount-paid">
                        <strong>₹{(completedPayment?.amount || paymentResult?.amount || orderInfo.amount).toFixed(2)} {completedPayment?.currency || orderInfo.currency}</strong>
                      </td>
                    </tr>
                  </tbody>
                </table>

                <div className="receipt-actions-grid">
                  {(completedPayment?.status === 'PENDING' || paymentResult?.status === 'PENDING') && (
                    <button
                      type="button"
                      className="reset-button"
                      onClick={() => setStep('otp')}
                      data-testid="resume-otp-button"
                    >
                      Complete OTP Verification →
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-secondary-apple"
                    onClick={handleRefreshPendingStatus}
                    disabled={isLoading}
                    data-testid="refresh-status-button"
                  >
                    {isLoading ? 'Checking Status...' : '↻ Refresh Status from Backend'}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary-apple"
                    onClick={resetToCheckout}
                    data-testid="retry-payment-button"
                  >
                    ← Choose Another Method
                  </button>
                </div>
              </section>
            )}

            {/* Step 3: Payment Success Receipt */}
            {step === 'success' && completedPayment && (
              <section className="result-card success" data-testid="payment-success">
                <div className="result-icon-badge">✓</div>
                <div className="receipt-brand-chip">Stickora · JUSPAY Verified Receipt</div>
                <h3 className="result-title">Payment Successful</h3>
                <p className="result-subtitle">
                  Thank you! Your transaction has been verified by JUSPAY backend and confirmed in the simulated sandbox.
                </p>

                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
                  <div className="result-status-pill success" data-testid="payment-status-badge">
                    ● PAYMENT: {completedPayment.status}
                  </div>
                  <div className="result-status-pill success" data-testid="order-status-badge">
                    ● ORDER: {completedPayment.status === 'SUCCESS' ? 'PAID' : (storeOrder?.status || 'PAID')}
                  </div>
                </div>

                <table className="receipt-table">
                  <tbody>
                    <tr>
                      <td className="receipt-label">Payment Reference</td>
                      <td className="receipt-val">
                        <code data-testid="transaction-reference">
                          {completedPayment.payment_reference || paymentResult?.payment_reference}
                        </code>
                      </td>
                    </tr>
                    <tr>
                      <td className="receipt-label">Transaction ID</td>
                      <td className="receipt-val">
                        <code data-testid="transaction-id">
                          {completedPayment.transaction_id || paymentResult?.transaction_id}
                        </code>
                      </td>
                    </tr>
                    <tr>
                      <td className="receipt-label">Order ID</td>
                      <td className="receipt-val" data-testid="order-id">
                        <span data-testid="order-id-confirmation">
                          {completedPayment.order_id || paymentResult?.order_id || orderInfo.orderId}
                        </span>
                      </td>
                    </tr>
                    <tr>
                      <td className="receipt-label">Amount Paid</td>
                      <td className="receipt-val" data-testid="amount-paid">
                        <strong>₹{(completedPayment.amount || paymentResult?.amount || orderInfo.amount).toFixed(2)} {completedPayment.currency || paymentResult?.currency || orderInfo.currency}</strong>
                      </td>
                    </tr>
                    <tr>
                      <td className="receipt-label">Payment Method</td>
                      <td className="receipt-val" data-testid="payment-method">
                        {completedPayment.payment_method || paymentResult?.payment_method || selectedMethod.toUpperCase()}
                      </td>
                    </tr>
                    <tr>
                      <td className="receipt-label">Transaction Date &amp; Time</td>
                      <td className="receipt-val" data-testid="finalized-at">
                        {new Date(completedPayment.finalized_at || completedPayment.updated_at || Date.now()).toLocaleString()}
                      </td>
                    </tr>
                    <tr>
                      <td className="receipt-label">Authentication</td>
                      <td className="receipt-val">6-Digit Cryptographic OTP Verified</td>
                    </tr>
                  </tbody>
                </table>

                {storeOrder?.delivery && (
                  <div className="store-delivery-recap-box" data-testid="order-delivery-recap">
                    <h4>Delivery Address</h4>
                    <p><strong>{storeOrder.delivery.full_name}</strong></p>
                    <p>{storeOrder.delivery.address_line}</p>
                    <p>{storeOrder.delivery.city}, {storeOrder.delivery.state} – {storeOrder.delivery.pincode}</p>
                    <p className="recap-contact-line">📞 {storeOrder.delivery.mobile_number} · ✉️ {storeOrder.delivery.email}</p>
                  </div>
                )}

                {storeOrder?.items && storeOrder.items.length > 0 && (
                  <div className="receipt-products-card" data-testid="receipt-purchased-items">
                    <h4>Purchased Products</h4>
                    <div className="receipt-products-list">
                      {storeOrder.items.map((it: any) => (
                        <div key={it.product_id} className="receipt-product-row">
                          <div>
                            <span className="receipt-prod-name">{it.product_name}</span>
                            <span className="receipt-prod-qty">Qty: {it.quantity} × ₹{Number(it.unit_price).toFixed(2)}</span>
                          </div>
                          <strong>₹{Number(it.total_price).toFixed(2)}</strong>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="receipt-actions-grid">
                  <button
                    type="button"
                    className="btn-download-receipt"
                    onClick={handleDownloadReceipt}
                    data-testid="download-receipt-button"
                  >
                    ⬇ Download Receipt
                  </button>
                  <a
                    href="/products"
                    className="reset-button receipt-shop-link"
                    data-testid="continue-shopping-btn"
                  >
                    Continue Shopping →
                  </a>
                  <button
                    type="button"
                    className="btn-secondary-apple"
                    onClick={resetToCheckout}
                    data-testid="start-new-payment-button"
                  >
                    Initiate Another Simulated Payment
                  </button>
                </div>
              </section>
            )}

            {/* Step 4: Payment Failed State */}
            {step === 'failed' && (
              <section className="result-card failed" data-testid="payment-failed">
                <div className="result-icon-badge">✕</div>
                <h3 className="result-title">Payment Verification Failed</h3>
                <p className="result-subtitle" data-testid="failure-reason">
                  {failureReason || 'The transaction could not be verified and has been marked as FAILED.'}
                </p>

                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
                  <div className="result-status-pill failed" data-testid="payment-status-badge">
                    ● STATUS: FAILED
                  </div>
                  {orderInfo.orderId.startsWith('STK-ORD-') && (
                    <div className="result-status-pill failed" data-testid="order-status-badge">
                      ● ORDER: {storeOrder?.status || 'PAYMENT_FAILED'}
                    </div>
                  )}
                </div>

                {(completedPayment?.transaction_id || paymentResult?.transaction_id) && (
                  <table className="receipt-table" style={{ marginTop: '16px' }}>
                    <tbody>
                      <tr>
                        <td className="receipt-label">Transaction ID</td>
                        <td className="receipt-val">
                          <code data-testid="transaction-id">
                            {completedPayment?.transaction_id || paymentResult?.transaction_id}
                          </code>
                        </td>
                      </tr>
                      <tr>
                        <td className="receipt-label">Order ID</td>
                        <td className="receipt-val" data-testid="order-id">
                          {completedPayment?.order_id || paymentResult?.order_id || orderInfo.orderId}
                        </td>
                      </tr>
                      {(completedPayment?.payment_reference || paymentResult?.payment_reference) && (
                        <tr>
                          <td className="receipt-label">Payment Reference</td>
                          <td className="receipt-val">
                            <code data-testid="transaction-reference">
                              {completedPayment?.payment_reference || paymentResult?.payment_reference}
                            </code>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                )}

                <div style={{ marginTop: '1.25rem' }}>
                  <p style={{ fontSize: '0.88rem', color: '#64748b', marginBottom: '1rem' }}>
                    Your items and delivery information are preserved. You can safely retry payment.
                  </p>
                  <button
                    type="button"
                    className="reset-button"
                    onClick={resetToCheckout}
                    data-testid="retry-payment-button"
                  >
                    ← Retry Payment
                  </button>
                </div>
              </section>
            )}

            {/* Step 5: Payment Declined State */}
            {step === 'declined' && (
              <section className="result-card declined" data-testid="payment-declined">
                <div className="result-icon-badge declined">⛔</div>
                <h3 className="result-title">Payment Declined</h3>
                <p className="result-subtitle" data-testid="failure-reason">
                  {failureReason || 'Your transaction was declined by the simulated card issuer / bank network.'}
                </p>

                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
                  <div className="result-status-pill declined" data-testid="payment-status-badge">
                    ● STATUS: DECLINED
                  </div>
                  {orderInfo.orderId.startsWith('STK-ORD-') && (
                    <div className="result-status-pill declined" data-testid="order-status-badge">
                      ● ORDER: {storeOrder?.status || 'PAYMENT_FAILED'}
                    </div>
                  )}
                </div>

                <table className="receipt-table">
                  <tbody>
                    <tr>
                      <td className="receipt-label">Payment Reference</td>
                      <td className="receipt-val">
                        <code data-testid="transaction-reference">
                          {completedPayment?.payment_reference || paymentResult?.payment_reference}
                        </code>
                      </td>
                    </tr>
                    <tr>
                      <td className="receipt-label">Transaction ID</td>
                      <td className="receipt-val">
                        <code data-testid="transaction-id">
                          {completedPayment?.transaction_id || paymentResult?.transaction_id}
                        </code>
                      </td>
                    </tr>
                    <tr>
                      <td className="receipt-label">Order ID</td>
                      <td className="receipt-val" data-testid="order-id">
                        {completedPayment?.order_id || paymentResult?.order_id || orderInfo.orderId}
                      </td>
                    </tr>
                    <tr>
                      <td className="receipt-label">Amount</td>
                      <td className="receipt-val" data-testid="amount-paid">
                        ₹{(completedPayment?.amount || paymentResult?.amount || orderInfo.amount).toFixed(2)} {completedPayment?.currency || orderInfo.currency}
                      </td>
                    </tr>
                    <tr>
                      <td className="receipt-label">Payment Method</td>
                      <td className="receipt-val" data-testid="payment-method">
                        {completedPayment?.payment_method || paymentResult?.payment_method || selectedMethod.toUpperCase()}
                      </td>
                    </tr>
                    <tr>
                      <td className="receipt-label">Outcome</td>
                      <td className="receipt-val">DECLINED (Simulated)</td>
                    </tr>
                  </tbody>
                </table>

                <div style={{ marginTop: '1.25rem' }}>
                  <p style={{ fontSize: '0.88rem', color: '#64748b', marginBottom: '1rem' }}>
                    Your items and delivery information are preserved. You can safely retry payment using another method.
                  </p>
                  <button
                    type="button"
                    className="reset-button"
                    onClick={resetToCheckout}
                    data-testid="retry-payment-button"
                  >
                    ← Retry Payment
                  </button>
                </div>
              </section>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
