'use client';

import React, { useState, useEffect, useCallback } from 'react';

interface AdminStatus {
  provider: string;
  enabled: boolean;
  experimental: boolean;
  sender_name: string;
  session_id: string;
  status: string;
  connected: boolean;
  has_qr: boolean;
  has_saved_session: boolean;
  connected_phone_masked?: string | null;
  last_connected_at?: string | null;
  last_disconnected_at?: string | null;
  reconnect_attempts: number;
  last_error?: string | null;
}

interface AdminQrState {
  status: string;
  connected: boolean;
  has_qr: boolean;
  qr_data_url?: string | null;
  qr_generated_at?: string | null;
  message: string;
}

export default function MerchantWhatsAppAdminPage() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001';

  const [adminKeyInput, setAdminKeyInput] = useState('');
  const [adminKey, setAdminKey] = useState('');
  const [authError, setAuthError] = useState('');
  const [authenticating, setAuthenticating] = useState(false);

  const [statusData, setStatusData] = useState<AdminStatus | null>(null);
  const [qrState, setQrState] = useState<AdminQrState | null>(null);
  const [actionBusy, setActionBusy] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const [clearSessionOnDisconnect, setClearSessionOnDisconnect] = useState(false);

  const [testPhone, setTestPhone] = useState('');
  const [testText, setTestText] = useState(
    'Stickora Store experimental WhatsApp test message. No action required.'
  );
  const [sendingTest, setSendingTest] = useState(false);
  const [testReceipt, setTestReceipt] = useState('');

  const callAdminApi = useCallback(
    async <T,>(path: string, keyOverride?: string, options?: RequestInit): Promise<T> => {
      const effectiveKey = keyOverride ?? adminKey;
      const res = await fetch(`${apiUrl}${path}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Key': effectiveKey,
          ...(options?.headers || {}),
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = typeof data?.detail === 'string' ? data.detail : `HTTP ${res.status}`;
        throw new Error(msg);
      }
      return data as T;
    },
    [adminKey, apiUrl]
  );

  const refreshStatusAndQr = useCallback(
    async (keyOverride?: string) => {
      const currentStatus = await callAdminApi<AdminStatus>('/api/v1/admin/whatsapp/status', keyOverride);
      setStatusData(currentStatus);

      if (!currentStatus.connected) {
        const qr = await callAdminApi<AdminQrState>('/api/v1/admin/whatsapp/qr', keyOverride);
        setQrState(qr);
      } else {
        setQrState(null);
      }
      return currentStatus;
    },
    [callAdminApi]
  );

  // Restore merchant session key from current browser tab sessionStorage only
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('stickora_wa_admin_key');
      if (saved) {
        setAdminKey(saved);
        void refreshStatusAndQr(saved).catch(() => {
          sessionStorage.removeItem('stickora_wa_admin_key');
          setAdminKey('');
        });
      }
    } catch {
      // Ignore storage access failures
    }
  }, [refreshStatusAndQr]);

  // Poll status & QR automatically while connecting or awaiting QR scan
  useEffect(() => {
    if (!adminKey || !statusData) return;
    if (statusData.connected) return;
    if (statusData.status !== 'CONNECTING' && statusData.status !== 'QR_READY' && statusData.status !== 'RECONNECTING') {
      return;
    }

    const timer = setInterval(() => {
      void refreshStatusAndQr().catch(() => undefined);
    }, 3000);
    return () => clearInterval(timer);
  }, [adminKey, statusData, refreshStatusAndQr]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = adminKeyInput.trim();
    if (!trimmed) {
      setAuthError('Please enter the merchant administrator API key.');
      return;
    }
    setAuthenticating(true);
    setAuthError('');
    try {
      await refreshStatusAndQr(trimmed);
      setAdminKey(trimmed);
      setAdminKeyInput('');
      try {
        sessionStorage.setItem('stickora_wa_admin_key', trimmed);
      } catch {
        // ignore
      }
    } catch (err: any) {
      setAuthError(err?.message || 'Administrator authentication failed.');
    } finally {
      setAuthenticating(false);
    }
  };

  const handleSignOut = () => {
    setAdminKey('');
    setStatusData(null);
    setQrState(null);
    setActionMessage('');
    setActionError('');
    try {
      sessionStorage.removeItem('stickora_wa_admin_key');
    } catch {
      // ignore
    }
  };

  const runAction = async (label: string, path: string, body?: object) => {
    setActionBusy(label);
    setActionMessage('');
    setActionError('');
    try {
      const updated = await callAdminApi<AdminStatus>(path, undefined, {
        method: 'POST',
        body: body ? JSON.stringify(body) : undefined,
      });
      setStatusData(updated);
      if (!updated.connected) {
        const qr = await callAdminApi<AdminQrState>('/api/v1/admin/whatsapp/qr');
        setQrState(qr);
      } else {
        setQrState(null);
      }
      setActionMessage(`${label} completed (status: ${updated.status}).`);
    } catch (err: any) {
      setActionError(err?.message || `${label} failed.`);
    } finally {
      setActionBusy('');
    }
  };

  const handleSendTest = async (e: React.FormEvent) => {
    e.preventDefault();
    setSendingTest(true);
    setActionError('');
    setTestReceipt('');
    try {
      const res = await callAdminApi<{
        accepted: boolean;
        message_id: string;
        ack_status: string;
        recipient_masked: string;
      }>('/api/v1/admin/whatsapp/send-test', undefined, {
        method: 'POST',
        body: JSON.stringify({
          phone: testPhone.trim(),
          message: testText.trim(),
        }),
      });
      setTestReceipt(
        `Submitted to ${res.recipient_masked} — Provider ID: ${res.message_id}, Ack: ${res.ack_status}`
      );
    } catch (err: any) {
      setActionError(err?.message || 'Unable to send test WhatsApp message.');
    } finally {
      setSendingTest(false);
    }
  };

  return (
    <main className="admin-wa-shell" data-testid="merchant-whatsapp-admin-page">
      <div className="admin-wa-container">
        <header className="admin-wa-header">
          <div>
            <span className="checkout-eyebrow">Stickora · Store Administration</span>
            <h1 className="admin-page-title">Merchant WhatsApp Connection</h1>
            <p className="admin-wa-subtitle">
              Protected administrative console for experimental BerryProtocol WhatsApp Web OTP pairing.
            </p>
          </div>
          {adminKey && (
            <button
              type="button"
              className="btn-resend-email-otp"
              onClick={handleSignOut}
              data-testid="admin-wa-signout-btn"
            >
              Lock Console
            </button>
          )}
        </header>

        <div className="admin-wa-warning" role="note">
          <strong>Experimental Integration Notice:</strong> BerryProtocol uses an unofficial WhatsApp Web session bridge.
          Never expose administrator credentials or QR pairing codes to customers.
        </div>

        {!adminKey ? (
          <section className="admin-wa-card" data-testid="admin-wa-login-card">
            <h2 className="admin-section-title">Administrator Sign In</h2>
            <p className="form-subtext">
              Enter the server <code>WHATSAPP_ADMIN_KEY</code> to manage merchant device linking.
            </p>
            {authError && (
              <div className="alert-error" role="alert" data-testid="admin-wa-auth-error">
                <span className="alert-icon">⚠️</span>
                <span>{authError}</span>
              </div>
            )}
            <form onSubmit={handleLogin} className="admin-wa-login-form">
              <div className="form-group">
                <label htmlFor="adminKey" className="input-label">
                  Merchant Admin Key
                </label>
                <input
                  id="adminKey"
                  type="password"
                  className="input-field"
                  placeholder="Enter WHATSAPP_ADMIN_KEY"
                  value={adminKeyInput}
                  onChange={(e) => setAdminKeyInput(e.target.value)}
                  data-testid="admin-wa-key-input"
                />
              </div>
              <button
                type="submit"
                className="btn-confirm-email-otp"
                disabled={authenticating}
                data-testid="admin-wa-login-btn"
              >
                {authenticating ? 'Verifying...' : 'Unlock WhatsApp Console'}
              </button>
            </form>
          </section>
        ) : (
          <div className="admin-wa-grid">
            {/* Session Status & Controls */}
            <section className="admin-wa-card" data-testid="admin-wa-status-card">
              <div className="admin-wa-card-top">
                <h2 className="admin-section-title">Session Status</h2>
                <span
                  className={`admin-wa-badge ${statusData?.connected ? 'connected' : 'disconnected'}`}
                  data-testid="admin-wa-status-badge"
                >
                  {statusData?.status || 'UNKNOWN'}
                </span>
              </div>

              <dl className="admin-wa-meta">
                <div>
                  <dt>Provider</dt>
                  <dd>{statusData?.provider || 'berryprotocol'}</dd>
                </div>
                <div>
                  <dt>Session ID</dt>
                  <dd><code>{statusData?.session_id}</code></dd>
                </div>
                <div>
                  <dt>Connected Phone</dt>
                  <dd data-testid="admin-wa-connected-phone">
                    {statusData?.connected_phone_masked || 'Not linked'}
                  </dd>
                </div>
                <div>
                  <dt>Saved Session</dt>
                  <dd>{statusData?.has_saved_session ? 'Present on disk' : 'None yet'}</dd>
                </div>
                <div>
                  <dt>Last Connected</dt>
                  <dd>{statusData?.last_connected_at || '—'}</dd>
                </div>
                <div>
                  <dt>Last Error</dt>
                  <dd>{statusData?.last_error || 'None'}</dd>
                </div>
              </dl>

              {statusData?.last_error && (
                <div className="alert-error" role="alert" data-testid="admin-wa-status-error">
                  <span className="alert-icon">⚠️</span>
                  <span>{statusData.last_error}</span>
                </div>
              )}

              {actionMessage && (
                <p className="email-otp-info" data-testid="admin-wa-action-message">{actionMessage}</p>
              )}
              {actionError && (
                <p className="error-text" data-testid="admin-wa-action-error">{actionError}</p>
              )}

              <div className="admin-wa-actions">
                <button
                  type="button"
                  className="btn-confirm-email-otp"
                  disabled={Boolean(actionBusy) || Boolean(statusData?.connected)}
                  onClick={() => void runAction('Connect WhatsApp', '/api/v1/admin/whatsapp/connect')}
                  data-testid="admin-wa-connect-btn"
                >
                  {actionBusy === 'Connect WhatsApp' ? 'Connecting...' : 'Connect WhatsApp'}
                </button>
                <button
                  type="button"
                  className="btn-resend-email-otp"
                  disabled={Boolean(actionBusy)}
                  onClick={() => void runAction('Reconnect', '/api/v1/admin/whatsapp/reconnect')}
                  data-testid="admin-wa-reconnect-btn"
                >
                  Reconnect
                </button>
                <button
                  type="button"
                  className="btn-resend-email-otp"
                  disabled={Boolean(actionBusy)}
                  onClick={() =>
                    void runAction('Disconnect', '/api/v1/admin/whatsapp/disconnect', {
                      logout: clearSessionOnDisconnect,
                    })
                  }
                  data-testid="admin-wa-disconnect-btn"
                >
                  Disconnect
                </button>
                <button
                  type="button"
                  className="btn-resend-email-otp"
                  disabled={Boolean(actionBusy)}
                  onClick={() => void refreshStatusAndQr()}
                  data-testid="admin-wa-refresh-btn"
                >
                  Refresh
                </button>
              </div>

              <label className="admin-wa-checkbox">
                <input
                  type="checkbox"
                  checked={clearSessionOnDisconnect}
                  onChange={(e) => setClearSessionOnDisconnect(e.target.checked)}
                />
                <span>Also log out &amp; clear saved session on Disconnect</span>
              </label>
            </section>

            {/* QR Pairing Panel */}
            <section className="admin-wa-card" data-testid="admin-wa-qr-card">
              <h2>QR Device Linking</h2>
              {statusData?.connected ? (
                <div className="admin-wa-connected-box">
                  <div className="order-icon-badge" style={{ margin: '0 auto 0.75rem' }}>✓</div>
                  <strong>WhatsApp Session Linked</strong>
                  <p>Connected number: {statusData.connected_phone_masked || 'Active'}</p>
                </div>
              ) : qrState?.has_qr && qrState.qr_data_url ? (
                <div className="admin-wa-qr-wrap">
                  <img
                    src={qrState.qr_data_url}
                    alt="WhatsApp Pairing QR Code"
                    className="admin-wa-qr-img"
                    data-testid="admin-wa-qr-image"
                  />
                  <p className="form-subtext">
                    Open WhatsApp on your merchant device → Settings → Linked Devices → Link a Device.
                  </p>
                </div>
              ) : (
                <p className="form-subtext" data-testid="admin-wa-qr-empty">
                  {qrState?.message || 'Click "Connect WhatsApp" to generate a pairing QR code.'}
                </p>
              )}
            </section>

            {/* Authorized Test Dispatch */}
            <section className="admin-wa-card admin-wa-card-full" data-testid="admin-wa-test-card">
              <h2>Send Authorized Test Message</h2>
              <p className="form-subtext">
                Verify live delivery only with an authorized test phone number after QR linking completes.
              </p>
              <form onSubmit={handleSendTest} className="admin-wa-test-form">
                <div className="form-grid-2">
                  <div className="form-group">
                    <label htmlFor="testPhone" className="input-label">
                      Recipient Mobile Number (E.164 or 10-digit IN)
                    </label>
                    <input
                      id="testPhone"
                      type="tel"
                      className="input-field"
                      placeholder="e.g. +919876543210"
                      value={testPhone}
                      onChange={(e) => setTestPhone(e.target.value)}
                      data-testid="admin-wa-test-phone"
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="testText" className="input-label">
                      Message Body
                    </label>
                    <input
                      id="testText"
                      type="text"
                      className="input-field"
                      value={testText}
                      onChange={(e) => setTestText(e.target.value)}
                      data-testid="admin-wa-test-message"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  className="btn-confirm-email-otp"
                  disabled={sendingTest || !statusData?.connected}
                  data-testid="admin-wa-send-test-btn"
                >
                  {sendingTest ? 'Sending...' : 'Send Test Message'}
                </button>
              </form>
              {testReceipt && (
                <p className="email-otp-info" data-testid="admin-wa-test-receipt">{testReceipt}</p>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
