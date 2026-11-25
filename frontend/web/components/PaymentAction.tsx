'use client';

import React from 'react';

interface PaymentActionProps {
  amount: number;
  isLoading: boolean;
}

export const PaymentAction: React.FC<PaymentActionProps> = ({ amount, isLoading }) => {
  return (
    <div className="payment-action-section">
      <button
        type="submit"
        className="primary-pay-button"
        disabled={isLoading}
        data-testid="continue-payment-button"
      >
        {isLoading ? (
          <div className="loading-state" data-testid="payment-loading-indicator">
            <span className="spinner-glyph">⏳</span>
            <span>Initiating Payment...</span>
          </div>
        ) : (
          <>
            <span className="lock-glyph">🔒</span>
            <span>Continue to Payment • ₹{amount.toFixed(2)}</span>
          </>
        )}
      </button>

      <p className="payment-security-subtext">
        Guaranteed safe & simulated. No actual financial debit occurs.
      </p>
    </div>
  );
};
