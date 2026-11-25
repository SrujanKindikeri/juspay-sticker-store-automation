'use client';

import React from 'react';
import { NetBankingFormData } from '../types/checkout';

interface NetBankingPaymentPanelProps {
  data: NetBankingFormData;
  onChange: (data: NetBankingFormData) => void;
}

export const NetBankingPaymentPanel: React.FC<NetBankingPaymentPanelProps> = ({
  data,
  onChange,
}) => {
  const popularBanks = [
    { code: 'HDFC', name: 'HDFC Bank', badge: 'Popular' },
    { code: 'ICICI', name: 'ICICI Bank', badge: 'Popular' },
    { code: 'SBI', name: 'State Bank of India', badge: 'Popular' },
    { code: 'AXIS', name: 'Axis Bank', badge: '' },
    { code: 'KOTAK', name: 'Kotak Bank', badge: '' },
  ];

  return (
    <div className="payment-panel-body" data-testid="payment-details">
      <div className="panel-header-row">
        <div>
          <h4 className="panel-title">Net Banking Simulation</h4>
          <p className="panel-desc">Select your bank from popular institutions or browse all supported banks.</p>
        </div>
        <span className="live-demo-tag">MOCK NETBANKING</span>
      </div>

      <div className="popular-banks-section">
        <label className="form-label">Popular Banks</label>
        <div className="banks-grid" data-testid="popular-banks-grid">
          {popularBanks.map((bank) => (
            <button
              key={bank.code}
              type="button"
              className={`bank-card ${data.selectedBank === bank.code ? 'selected' : ''}`}
              onClick={() => onChange({ selectedBank: bank.code })}
              data-testid={`bank-option-${bank.code}`}
            >
              <div className="bank-card-icon">🏦</div>
              <span className="bank-card-name">{bank.name}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="form-group" style={{ marginTop: '1.25rem' }}>
        <label className="form-label" htmlFor="all-banks-select">Or choose from other banks</label>
        <select
          id="all-banks-select"
          className="text-select"
          value={data.selectedBank}
          onChange={(e) => onChange({ selectedBank: e.target.value })}
          data-testid="select-bank-dropdown"
        >
          <option value="HDFC">HDFC Bank</option>
          <option value="ICICI">ICICI Bank</option>
          <option value="SBI">State Bank of India</option>
          <option value="AXIS">Axis Bank</option>
          <option value="KOTAK">Kotak Mahindra Bank</option>
          <option value="PNB">Punjab National Bank</option>
          <option value="BOB">Bank of Baroda</option>
          <option value="CANARA">Canara Bank</option>
          <option value="INDUSIND">IndusInd Bank</option>
          <option value="YES">Yes Bank</option>
        </select>
      </div>

      <div className="helper-banner">
        <span>🏛️ Selected Bank:</span>
        <strong>{data.selectedBank} Bank (Simulated Gateway)</strong>
      </div>
    </div>
  );
};
