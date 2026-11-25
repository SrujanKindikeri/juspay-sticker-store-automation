'use client';

import React from 'react';
import { BackendHealth } from '../types/checkout';

interface HeaderProps {
  health: BackendHealth | null;
  healthLoading: boolean;
}

export const Header: React.FC<HeaderProps> = ({ health, healthLoading }) => {
  return (
    <header className="site-header">
      <div className="header-inner">
        {/* Brand Logo & Name */}
        <div className="brand-group" data-testid="brand-logo-group">
          <div className="brand-badge">
            <span className="brand-letter">J</span>
          </div>
          <div className="brand-text">
            <span className="brand-name">JUSPAY</span>
            <span className="brand-tag">PAYMENT GATEWAY</span>
          </div>
        </div>

        {/* Security & Health Indicators */}
        <div className="header-badges">
          <div className="sandbox-env-badge" data-testid="sandbox-mode-badge">
            <span>🧪 Simulated Sandbox</span>
          </div>

          {/* Secure Payment Indicator */}
          <div className="security-badge" data-testid="secure-payment-indicator">
            <svg
              className="badge-icon"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              width="16"
              height="16"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
            <span className="badge-text">256-Bit SSL Secure</span>
          </div>

          {/* Backend Status Indicator */}
          <div className="health-badge" data-testid="health-badge">
            <span
              className={`health-dot ${
                healthLoading ? 'loading' : health?.status === 'ok' ? 'online' : 'offline'
              }`}
            />
            <span className="health-text">
              {healthLoading
                ? 'Syncing...'
                : health?.status === 'ok'
                ? `Simulator API: Online`
                : 'API Offline'}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
};
