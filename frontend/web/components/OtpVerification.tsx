'use client';

import React, { useState, useEffect } from 'react';
import { PaymentInitiateResponse } from '../types/checkout';

interface OtpVerificationProps {
  paymentResult: PaymentInitiateResponse;
  onBackToCheckout: () => void;
  onPaymentCompleted: (result: any) => void;
  onPaymentDeclined?: (result: any) => void;
  onPaymentFailed: (errorMsg: string) => void;
  initialSimulatedOtp?: string;
  apiUrl?: string;
}

export const OtpVerification: React.FC<OtpVerificationProps> = ({
  paymentResult,
  onBackToCheckout,
  onPaymentCompleted,
  onPaymentDeclined,
  onPaymentFailed,
  initialSimulatedOtp,
  apiUrl = 'http://localhost:8001',
}) => {
  const [otp, setOtp] = useState<string>('');
  const [simulatedOtp, setSimulatedOtp] = useState<string>(initialSimulatedOtp || '');
  const [maskedContact, setMaskedContact] = useState<string>('+91 ******8812 / te****@juspay.demo');
  const [isVerifying, setIsVerifying] = useState<boolean>(false);
  const [isResending, setIsResending] = useState<boolean>(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [attemptsRemaining, setAttemptsRemaining] = useState<number>(3);
  const [countdown, setCountdown] = useState<number>(300);
  const [resendCooldown, setResendCooldown] = useState<number>(30);

  // Send initial OTP if not already provided
  useEffect(() => {
    if (!initialSimulatedOtp) {
      const sendInitialOtp = async () => {
        try {
          const res = await fetch(`${apiUrl}/api/v1/payments/${paymentResult.transaction_id}/send-otp`, {
            method: 'POST',
          });
          if (res.ok) {
            const data = await res.json();
            if (data.simulated_otp) setSimulatedOtp(data.simulated_otp);
            if (data.masked_contact) setMaskedContact(data.masked_contact);
            setResendCooldown(30);
          }
        } catch {
          // ignore background initial fetch error
        }
      };
      sendInitialOtp();
    }
  }, [paymentResult.transaction_id, initialSimulatedOtp, apiUrl]);

  // Expiry countdown timer
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const cdTimer = setInterval(() => {
      setResendCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(cdTimer);
  }, [resendCooldown]);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setOtpError(null);
    setResendMessage(null);

    const cleanOtp = otp.trim();
    if (cleanOtp.length !== 6 || !/^\d{6}$/.test(cleanOtp)) {
      setOtpError('Please enter a valid 6-digit numeric OTP.');
      return;
    }

    setIsVerifying(true);
    try {
      // 1. Verify OTP with Backend (transitions status to AUTHENTICATED)
      const res = await fetch(`${apiUrl}/api/v1/payments/${paymentResult.transaction_id}/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ otp: cleanOtp }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const errorDetail = data.detail || 'OTP verification failed';
        setOtpError(errorDetail);

        if (errorDetail.includes('Maximum') || errorDetail.includes('FAILED')) {
          onPaymentFailed(errorDetail);
        } else {
          setAttemptsRemaining((prev) => Math.max(0, prev - 1));
        }
        return;
      }

      // 2. Lifecycle Progression: Execute Payment Processing (AUTHENTICATED -> PROCESSING -> SUCCESS/DECLINED/FAILED)
      const processRes = await fetch(`${apiUrl}/api/v1/payments/${paymentResult.transaction_id}/process`, {
        method: 'POST',
      });
      const processData = await processRes.json().catch(() => ({}));

      if (!processRes.ok) {
        const procError = processData.detail || processData.message || 'Payment processing failed';
        onPaymentFailed(procError);
        return;
      }

      if (processData.status === 'SUCCESS') {
        onPaymentCompleted(processData);
      } else if (processData.status === 'DECLINED') {
        if (onPaymentDeclined) {
          onPaymentDeclined(processData);
        } else {
          onPaymentFailed(processData.message || 'Payment was declined by card network / bank simulator.');
        }
      } else {
        onPaymentFailed(processData.message || 'Payment processing failed in simulation sandbox.');
      }
    } catch (err: any) {
      setOtpError(err.message || 'Network error during verification');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleResend = async () => {
    setIsResending(true);
    setOtpError(null);
    setResendMessage(null);

    try {
      const res = await fetch(`${apiUrl}/api/v1/payments/${paymentResult.transaction_id}/resend-otp`, {
        method: 'POST',
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.detail || 'Unable to resend OTP.');
      }

      if (data.simulated_otp) {
        setSimulatedOtp(data.simulated_otp);
      }
      setCountdown(300);
      setAttemptsRemaining(3);
      setResendCooldown(30);
      setResendMessage(`New OTP sent! (Resend ${data.resend_count}/3)`);
    } catch (err: any) {
      setOtpError(err.message || 'Failed to resend OTP');
    } finally {
      setIsResending(false);
    }
  };

  const autofillSimulatedOtp = () => {
    if (simulatedOtp) {
      setOtp(simulatedOtp);
    }
  };

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  return (
    <section className="otp-card-container" data-testid="otp-page">
      {/* Brand & Security Header */}
      <div className="otp-header">
        <div className="brand-group">
          <div className="brand-badge">
            <span className="brand-letter">J</span>
          </div>
          <div className="brand-text">
            <span className="brand-name">JUSPAY</span>
            <span className="brand-tag">SECURE OTP VERIFICATION</span>
          </div>
        </div>
        <div className="security-badge" data-testid="secure-payment-indicator">
          <span>🔒 256-Bit SSL</span>
        </div>
      </div>

      <div className="otp-body">
        <h2 className="otp-heading" data-testid="otp-heading">Verify Your Payment</h2>
        <p className="otp-subheading">
          An OTP has been sent to your simulated contact info:
          <br />
          <strong className="masked-contact">{maskedContact}</strong>
        </p>

        {/* Transaction Summary Chips */}
        <div className="otp-meta-grid">
          <div className="otp-meta-chip">
            <span className="chip-label">Amount:</span>
            <strong className="chip-val">₹{paymentResult.amount.toFixed(2)} {paymentResult.currency}</strong>
          </div>
          <div className="otp-meta-chip">
            <span className="chip-label">Transaction ID:</span>
            <code className="chip-val">{paymentResult.transaction_id}</code>
          </div>
          <div className="otp-meta-chip">
            <span className="chip-label">Payment Ref:</span>
            <code className="chip-val" data-testid="transaction-reference">{paymentResult.payment_reference}</code>
          </div>
        </div>

        {/* Demo Helper Banner with Simulated OTP */}
        {simulatedOtp && (
          <div className="otp-simulated-helper" data-testid="simulated-otp-box">
            <div className="helper-left">
              <span className="helper-badge">🧪 SIMULATION OTP:</span>
              <strong className="otp-code-display">{simulatedOtp}</strong>
            </div>
            <button
              type="button"
              className="autofill-otp-btn"
              onClick={autofillSimulatedOtp}
              data-testid="autofill-otp-button"
            >
              Autofill OTP
            </button>
          </div>
        )}

        {/* OTP Input Form */}
        <form onSubmit={handleVerify} className="otp-form" data-testid="otp-form">
          <div className="otp-input-wrap">
            <label htmlFor="otp-main-input" className="otp-input-label">
              Enter 6-Digit OTP:
            </label>
            <input
              id="otp-main-input"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              className="otp-input-box"
              placeholder="••••••"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              data-testid="otp-input"
              autoFocus
              autoComplete="one-time-code"
            />
            <div className="otp-timer-row">
              <span className="timer-text">
                Expires in: <strong>{formatTimer(countdown)}</strong>
              </span>
              <span className="attempts-text">
                Attempts remaining: <strong>{attemptsRemaining}/3</strong>
              </span>
            </div>
          </div>

          {/* Error & Feedback Messages */}
          {otpError && (
            <div className="payment-error-box" data-testid="otp-error">
              <span>⚠️</span>
              <span>{otpError}</span>
            </div>
          )}

          {resendMessage && (
            <div className="otp-info-box">
              <span>ℹ️</span>
              <span>{resendMessage}</span>
            </div>
          )}

          {/* Action Buttons */}
          {isVerifying && (
            <div className="processing-banner-card" style={{ marginBottom: '1rem' }} data-testid="otp-processing-indicator" role="status">
              <div className="processing-ring" aria-hidden="true" />
              <div>
                <strong className="processing-banner-title">Verifying &amp; Settling Payment</strong>
                <p className="processing-banner-sub">Authenticating OTP and confirming final status with JUSPAY backend...</p>
              </div>
            </div>
          )}

          <div className="otp-actions-col">
            <button
              type="submit"
              className="primary-pay-button"
              disabled={isVerifying || countdown <= 0}
              data-testid="verify-otp-button"
            >
              {isVerifying ? (
                <div className="loading-state">
                  <span className="spinner-glyph">⏳</span>
                  <span>Verifying Code...</span>
                </div>
              ) : (
                <span>Verify & Complete Payment</span>
              )}
            </button>

            <div className="otp-sub-actions">
              <button
                type="button"
                className="resend-btn"
                onClick={handleResend}
                disabled={isResending || resendCooldown > 0}
                data-testid="resend-otp-button"
              >
                {isResending
                  ? 'Resending...'
                  : resendCooldown > 0
                  ? `Resend OTP (${resendCooldown}s)`
                  : 'Resend OTP'}
              </button>

              <button
                type="button"
                className="back-btn"
                onClick={onBackToCheckout}
                data-testid="back-to-checkout-button"
              >
                ← Back to Checkout
              </button>
            </div>
          </div>
        </form>
      </div>
    </section>
  );
};
