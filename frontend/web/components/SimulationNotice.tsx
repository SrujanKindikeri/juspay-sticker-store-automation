'use client';

import React from 'react';

export const SimulationNotice: React.FC = () => {
  return (
    <aside className="simulation-disclaimer-card" data-testid="simulation-disclaimer">
      <div className="disclaimer-icon">🧪</div>
      <div className="disclaimer-content">
        <div className="sandbox-pill-tag">SANDBOX TEST MODE · NO REAL DEBIT</div>
        <h4 className="disclaimer-title">Simulated JUSPAY Payment Environment</h4>
        <p className="disclaimer-text">
          Transactions here run inside a simulated sandbox for testing and demonstration.
          No real bank network or financial account is charged. Do not enter real card or PIN details.
        </p>
      </div>
    </aside>
  );
};
