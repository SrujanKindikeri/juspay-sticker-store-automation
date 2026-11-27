'use client';

import React from 'react';
import { PaytmConfig } from '../types/checkout';

interface PaytmPaymentPanelProps {
  orderId: string;
  amount: number;
  currency: string;
  config: PaytmConfig | null;
  isLoading: boolean;
  onPayWithPaytm: (sandboxOutcome?: 'SUCCESS' | 'FAILED' | 'PENDING') => void;
  sandboxOutcome: 'SUCCESS' | 'FAILED' | 'PENDING';
  onOutcomeChange: (outcome: 'SUCCESS' | 'FAILED' | 'PENDING') => void;
}

export const PaytmPaymentPanel: React.FC<PaytmPaymentPanelProps> = ({
  orderId,
  amount,
  currency,
  config,
  isLoading,
  onPayWithPaytm,
  sandboxOutcome = 'SUCCESS',
  onOutcomeChange,
}) => {
  const [selectedOutcome, setSelectedOutcome] = React.useState<'SUCCESS' | 'FAILED' | 'PENDING'>(sandboxOutcome);
  const outcomeRef = React.useRef<'SUCCESS' | 'FAILED' | 'PENDING'>(sandboxOutcome);

  React.useEffect(() => {
    setSelectedOutcome(sandboxOutcome);
    outcomeRef.current = sandboxOutcome;
  }, [sandboxOutcome]);

  const handleSelectOutcome = (outcome: 'SUCCESS' | 'FAILED' | 'PENDING') => {
    setSelectedOutcome(outcome);
    outcomeRef.current = outcome;
    if (onOutcomeChange) {
      onOutcomeChange(outcome);
    }
  };

  return (
    <div className="payment-panel-body" data-testid="paytm-payment-panel">
      <div className="panel-header-row">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span
              style={{
                display: 'inline-block',
                background: '#002970',
                color: '#00baf2',
                fontWeight: 800,
                fontSize: '11px',
                padding: '2px 8px',
                borderRadius: '4px',
                letterSpacing: '0.5px',
              }}
            >
              PAYTM SANDBOX
            </span>
            <span
              style={{
                fontSize: '11px',
                color: '#666',
                background: '#f1f3f5',
                padding: '2px 6px',
                borderRadius: '4px',
              }}
            >
              STAGING
            </span>
          </div>
          <h4 className="panel-title" style={{ marginTop: '4px' }}>Paytm Payment Gateway (Sandbox)</h4>
          <p className="panel-desc">
            Official Paytm Checkout JS integration with cryptographic checksum validation.
          </p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <span style={{ fontSize: '12px', color: '#888', display: 'block' }}>Merchant MID</span>
          <code style={{ fontSize: '11px', background: '#f5f5f7', padding: '2px 6px', borderRadius: '4px' }}>
            {config?.mid_masked || 'STAGE_MID_DEMO'}
          </code>
        </div>
      </div>

      <div
        style={{
          background: '#f8fafd',
          border: '1px solid #d0e2ff',
          borderRadius: '12px',
          padding: '16px',
          margin: '16px 0',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#002970' }}>Order ID:</span>
          <span style={{ fontSize: '13px', fontFamily: 'monospace', fontWeight: 600 }}>{orderId}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#002970' }}>Amount to Pay:</span>
          <span style={{ fontSize: '16px', fontWeight: 700, color: '#111' }}>
            ₹{amount.toFixed(2)} {currency}
          </span>
        </div>
      </div>

      {/* Sandbox Test Scenario Selector for automated & interactive testing */}
      <div style={{ marginBottom: '16px' }}>
        <label className="form-label" style={{ fontSize: '12px', marginBottom: '6px', display: 'block' }}>
          Sandbox Test Scenario (Staging Simulator):
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
          <button
            type="button"
            className={`btn-subtle ${selectedOutcome === 'SUCCESS' ? 'selected' : ''}`}
            onClick={() => handleSelectOutcome('SUCCESS')}
            data-testid="paytm-scenario-success"
            style={{
              padding: '8px 10px',
              fontSize: '12px',
              borderRadius: '8px',
              border: selectedOutcome === 'SUCCESS' ? '2px solid #002970' : '1px solid #ddd',
              background: selectedOutcome === 'SUCCESS' ? '#e8f0fe' : '#fff',
              fontWeight: selectedOutcome === 'SUCCESS' ? 600 : 400,
              cursor: 'pointer',
            }}
          >
            ✅ Successful Payment
          </button>
          <button
            type="button"
            className={`btn-subtle ${selectedOutcome === 'FAILED' ? 'selected' : ''}`}
            onClick={() => handleSelectOutcome('FAILED')}
            data-testid="paytm-scenario-failed"
            style={{
              padding: '8px 10px',
              fontSize: '12px',
              borderRadius: '8px',
              border: selectedOutcome === 'FAILED' ? '2px solid #e02424' : '1px solid #ddd',
              background: selectedOutcome === 'FAILED' ? '#fde8e8' : '#fff',
              fontWeight: selectedOutcome === 'FAILED' ? 600 : 400,
              cursor: 'pointer',
            }}
          >
            ❌ Bank Decline / Fail
          </button>
          <button
            type="button"
            className={`btn-subtle ${selectedOutcome === 'PENDING' ? 'selected' : ''}`}
            onClick={() => handleSelectOutcome('PENDING')}
            data-testid="paytm-scenario-pending"
            style={{
              padding: '8px 10px',
              fontSize: '12px',
              borderRadius: '8px',
              border: selectedOutcome === 'PENDING' ? '2px solid #f59e0b' : '1px solid #ddd',
              background: selectedOutcome === 'PENDING' ? '#fef3c7' : '#fff',
              fontWeight: selectedOutcome === 'PENDING' ? 600 : 400,
              cursor: 'pointer',
            }}
          >
            ⏳ Pending / Timeout
          </button>
        </div>
      </div>

      <div style={{ marginTop: '20px' }}>
        <button
          type="button"
          className="btn-primary"
          onClick={() => onPayWithPaytm(outcomeRef.current)}
          disabled={isLoading}
          data-testid="pay-via-paytm-btn"
          style={{
            width: '100%',
            padding: '14px',
            fontSize: '15px',
            fontWeight: 600,
            background: '#002970',
            color: '#fff',
            borderRadius: '10px',
            border: 'none',
            cursor: isLoading ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
          }}
        >
          {isLoading ? (
            <span>Initiating Paytm Sandbox Session...</span>
          ) : (
            <>
              <span>Pay ₹{amount.toFixed(2)} via Paytm Sandbox</span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </>
          )}
        </button>
      </div>

      <p style={{ fontSize: '11px', color: '#888', marginTop: '12px', textAlign: 'center' }}>
        🔒 Protected by Paytm Checksum SHA-256 and Authoritative Server-to-Server Verification.
      </p>
    </div>
  );
};
