'use client';

import React from 'react';
import { CardFormData } from '../types/checkout';

interface CardPaymentPanelProps {
  data: CardFormData;
  onChange: (data: CardFormData) => void;
}

export const CardPaymentPanel: React.FC<CardPaymentPanelProps> = ({ data, onChange }) => {
  const updateField = (field: keyof CardFormData, value: string) => {
    onChange({ ...data, [field]: value });
  };

  const fillTestCard = () => {
    onChange({
      cardNumber: '4111 2222 3333 4444',
      expiry: '12/28',
      cvv: '123',
      cardHolder: 'DEMO TESTER',
    });
  };

  return (
    <div className="payment-panel-body" data-testid="payment-details">
      <div className="panel-header-row">
        <div>
          <h4 className="panel-title">Enter Card Information (Demo)</h4>
          <p className="panel-desc">All major credit and debit cards are supported for testing.</p>
        </div>
        <div className="card-brand-badges">
          <span className="brand-logo-pill">VISA</span>
          <span className="brand-logo-pill">MC</span>
          <span className="brand-logo-pill">RuPay</span>
        </div>
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="card-number-input">Card Number</label>
        <div className="input-with-icon">
          <input
            id="card-number-input"
            type="text"
            className="text-input"
            placeholder="4111 2222 3333 4444"
            value={data.cardNumber}
            onChange={(e) => updateField('cardNumber', e.target.value)}
            data-testid="input-card-number"
            autoComplete="off"
            required
          />
          <span className="input-end-icon">💳</span>
        </div>
      </div>

      <div className="form-row-duo">
        <div className="form-group">
          <label className="form-label" htmlFor="expiry-input">Expiry Date (MM/YY)</label>
          <input
            id="expiry-input"
            type="text"
            className="text-input"
            placeholder="MM/YY"
            value={data.expiry}
            onChange={(e) => updateField('expiry', e.target.value)}
            data-testid="input-card-expiry"
            autoComplete="off"
            required
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="cvv-input">CVV / CVC</label>
          <input
            id="cvv-input"
            type="password"
            maxLength={4}
            className="text-input"
            placeholder="•••"
            value={data.cvv}
            onChange={(e) => updateField('cvv', e.target.value)}
            data-testid="input-card-cvv"
            autoComplete="off"
            required
          />
        </div>
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="holder-input">Cardholder Name</label>
        <input
          id="holder-input"
          type="text"
          className="text-input"
          placeholder="Name as on card"
          value={data.cardHolder}
          onChange={(e) => updateField('cardHolder', e.target.value)}
          data-testid="input-card-holder"
          autoComplete="off"
          required
        />
      </div>

      <div className="helper-banner">
        <span>💡 Demo helper:</span>
        <button
          type="button"
          className="autofill-btn"
          onClick={fillTestCard}
          data-testid="autofill-card-btn"
        >
          Autofill Demo Card (4111-2222-3333-4444)
        </button>
      </div>
    </div>
  );
};
