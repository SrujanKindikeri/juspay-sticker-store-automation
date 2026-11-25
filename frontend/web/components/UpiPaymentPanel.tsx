'use client';

import React from 'react';
import { UpiFormData } from '../types/checkout';

interface UpiPaymentPanelProps {
  data: UpiFormData;
  onChange: (data: UpiFormData) => void;
}

export const UpiPaymentPanel: React.FC<UpiPaymentPanelProps> = ({ data, onChange }) => {
  const apps = [
    { id: 'gpay', name: 'Google Pay', icon: '🟢', handle: 'okaxis' },
    { id: 'phonepe', name: 'PhonePe', icon: '🟣', handle: 'ybl' },
    { id: 'paytm', name: 'Paytm', icon: '🔵', handle: 'paytm' },
    { id: 'bhim', name: 'BHIM UPI', icon: '🟠', handle: 'upi' },
  ];

  const handleSelectApp = (appId: string, handle: string) => {
    onChange({
      upiId: `demo.tester@${handle}`,
      appName: appId,
    });
  };

  return (
    <div className="payment-panel-body" data-testid="payment-details">
      <div className="panel-header-row">
        <div>
          <h4 className="panel-title">Pay via UPI (Unified Payments Interface)</h4>
          <p className="panel-desc">Enter your Virtual Payment Address (VPA) or select a popular UPI app.</p>
        </div>
        <span className="live-demo-tag">SIMULATED VPA</span>
      </div>

      <div className="upi-app-selector">
        <span className="app-select-label">Select UPI App:</span>
        <div className="upi-apps-grid" data-testid="upi-apps-grid">
          {apps.map((app) => (
            <button
              key={app.id}
              type="button"
              className={`upi-app-card ${data.appName === app.id ? 'active' : ''}`}
              onClick={() => handleSelectApp(app.id, app.handle)}
              data-testid={`upi-app-${app.id}`}
            >
              <span className="app-icon">{app.icon}</span>
              <span className="app-name">{app.name}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="form-group" style={{ marginTop: '1.25rem' }}>
        <label className="form-label" htmlFor="upi-vpa-input">Virtual Payment Address (UPI ID)</label>
        <div className="input-with-icon">
          <input
            id="upi-vpa-input"
            type="text"
            className="text-input"
            placeholder="username@bank"
            value={data.upiId}
            onChange={(e) => onChange({ ...data, upiId: e.target.value })}
            data-testid="input-upi-vpa"
            autoComplete="off"
            required
          />
          <span className="input-end-icon">⚡</span>
        </div>
        <span className="form-hint">E.g., mobile@upi, name@okhdfcbank, username@paytm</span>
      </div>

      <div className="helper-banner">
        <span>🛡️ Simulated Flow:</span>
        <span>No push notifications or collect requests will be dispatched.</span>
      </div>
    </div>
  );
};
