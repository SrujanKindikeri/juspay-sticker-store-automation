'use client';

import React from 'react';
import { PaymentMethodId, PaymentMethodOption } from '../types/checkout';

interface PaymentMethodSelectorProps {
  selectedMethod: PaymentMethodId;
  onSelectMethod: (method: PaymentMethodId) => void;
}

const paymentOptions: PaymentMethodOption[] = [
  {
    id: 'card',
    title: 'Credit / Debit Card',
    subtitle: 'Visa, Mastercard, RuPay & more',
    badge: 'Popular',
  },
  {
    id: 'upi',
    title: 'UPI',
    subtitle: 'Google Pay, PhonePe, Paytm, BHIM',
    badge: 'Instant',
  },
  {
    id: 'netbanking',
    title: 'Net Banking',
    subtitle: 'All major Indian banks supported',
  },
];

export const PaymentMethodSelector: React.FC<PaymentMethodSelectorProps> = ({
  selectedMethod,
  onSelectMethod,
}) => {
  return (
    <div className="payment-methods-wrapper" data-testid="payment-methods">
      <div className="section-title-row">
        <h3 className="section-title">Select Payment Method</h3>
        <span
          className="active-indicator"
          data-testid="selected-payment-method"
          data-selected={selectedMethod}
        >
          Active: {selectedMethod === 'card' ? 'Credit / Debit Card' : selectedMethod === 'upi' ? 'UPI' : 'Net Banking'}
        </span>
      </div>

      <div className="methods-list" role="radiogroup" aria-label="Payment Methods">
        {paymentOptions.map((opt) => {
          const isSelected = selectedMethod === opt.id;
          const testId = `${opt.id}-method`;

          return (
            <button
              key={opt.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              className={`method-option-card ${isSelected ? 'selected' : ''}`}
              onClick={() => onSelectMethod(opt.id)}
              data-testid={testId}
            >
              <div className="method-radio">
                <span className={`radio-circle ${isSelected ? 'checked' : ''}`} />
              </div>

              <div className="method-icon-container">
                {opt.id === 'card' && (
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
                    <line x1="1" y1="10" x2="23" y2="10" />
                  </svg>
                )}
                {opt.id === 'upi' && (
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                )}
                {opt.id === 'netbanking' && (
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="3" y1="21" x2="21" y2="21" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                    <polyline points="5 6 12 3 19 6" />
                    <line x1="4" y1="10" x2="4" y2="21" />
                    <line x1="20" y1="10" x2="20" y2="21" />
                    <line x1="8" y1="14" x2="8" y2="17" />
                    <line x1="12" y1="14" x2="12" y2="17" />
                    <line x1="16" y1="14" x2="16" y2="17" />
                  </svg>
                )}
              </div>

              <div className="method-text">
                <div className="method-title-row">
                  <span className="method-title">{opt.title}</span>
                  {opt.badge && <span className="method-pill">{opt.badge}</span>}
                </div>
                <span className="method-subtitle">{opt.subtitle}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
