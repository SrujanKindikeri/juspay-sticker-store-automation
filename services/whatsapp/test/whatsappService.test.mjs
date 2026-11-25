import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  WhatsAppBerryService,
  WhatsAppServiceError,
  maskPhoneNumber,
  normalizePhoneNumber,
} from '../src/WhatsAppBerryService.js';

class MockBerryClient extends EventEmitter {
  constructor() {
    super();
    this.sentMessages = [];
    this.disconnectedCalls = 0;
    this.logoutCalls = 0;
    this.reconnectCalls = 0;
  }

  async connect() {
    this.emit('connection.open', {
      sessionId: 'test_session',
      connectedAt: new Date().toISOString(),
    });
  }

  async connectWithQr() {
    this.emit('qr', 'mock-qr-payload-12345');
  }

  async reconnect() {
    this.reconnectCalls += 1;
    this.emit('connection.reconnecting', { sessionId: 'test_session', attempt: 1, delayMs: 100 });
    this.emit('connection.open', { sessionId: 'test_session', connectedAt: new Date().toISOString() });
  }

  async disconnect() {
    this.disconnectedCalls += 1;
    this.emit('connection.close', { sessionId: 'test_session', reason: 'manual' });
  }

  async logout() {
    this.logoutCalls += 1;
    this.emit('connection.close', { sessionId: 'test_session', reason: 'logout' });
  }

  async sendText(to, text) {
    this.sentMessages.push({ to, text });
    const messageId = `MSG_${this.sentMessages.length}`;
    setTimeout(() => {
      this.emit('message.ack', {
        messageId,
        remoteJid: to,
        ack: 'sent',
        updatedAt: new Date().toISOString(),
      });
    }, 5);
    return { id: messageId, to, type: 'text', text };
  }
}

function makeTempConfig(tmpDir) {
  return {
    provider: 'berryprotocol',
    enabled: true,
    experimental: true,
    senderName: 'Stickora Store',
    sessionId: 'stickora_test_session',
    sessionPath: path.join(tmpDir, 'berry_auth'),
    databasePath: path.join(tmpDir, 'berry_store.db'),
    metaFile: path.join(tmpDir, 'whatsapp_session.json'),
    reconnectMaxAttempts: 3,
    reconnectDelayMs: 100,
    ackWaitMs: 250,
  };
}

test('normalizePhoneNumber supports Indian 10-digit and E.164 numbers and rejects invalid ones', () => {
  const indian = normalizePhoneNumber('9876543210');
  assert.equal(indian.e164, '+919876543210');
  assert.equal(indian.jid, '919876543210@s.whatsapp.net');

  const e164 = normalizePhoneNumber('+91 98765-43210');
  assert.equal(e164.e164, '+919876543210');
  assert.equal(maskPhoneNumber(e164.e164), '+91 ******3210');

  assert.throws(() => normalizePhoneNumber('12345'), WhatsAppServiceError);
  assert.throws(() => normalizePhoneNumber('not-a-phone'), WhatsAppServiceError);
});

test('WhatsAppBerryService handles QR generation, open connection, OTP send without logging OTP, reconnect and disconnect', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'berry-test-'));
  const mockClient = new MockBerryClient();
  const loggedLines = [];

  const service = new WhatsAppBerryService(makeTempConfig(tmpDir), {
    clientFactory: () => mockClient,
    qrGenerator: async (raw) => `data:image/png;base64,${Buffer.from(raw).toString('base64')}`,
    logger: {
      info: (...args) => loggedLines.push(args.join(' ')),
      warn: (...args) => loggedLines.push(args.join(' ')),
    },
  });

  // Cannot send before connected
  await assert.rejects(() => service.sendOtpMessage('+919876543210', '482910'), {
    code: 'WHATSAPP_DISCONNECTED',
  });

  // Connect produces QR
  await service.connect();
  const qrState = service.getQrState();
  assert.equal(qrState.hasQr, true);
  assert.equal(qrState.status, 'QR_READY');
  assert.ok(qrState.qrDataUrl.startsWith('data:image/png;base64,'));

  // Simulate WhatsApp phone scan completing connection
  mockClient.emit('auth.success', { registered: true, clientId: '919999888877:1@s.whatsapp.net' });
  mockClient.emit('connection.open', { sessionId: 'stickora_test_session', connectedAt: new Date().toISOString() });

  const status = service.getStatus();
  assert.equal(status.connected, true);
  assert.equal(status.hasQr, false);
  assert.equal(status.connectedPhoneMasked, '+91 ******8877');

  // Persisted meta file must NOT store QR raw string
  const savedMeta = JSON.parse(fs.readFileSync(path.join(tmpDir, 'whatsapp_session.json'), 'utf-8'));
  assert.equal(savedMeta.status, 'CONNECTED');
  assert.equal('qr' in savedMeta, false);

  // Send OTP message
  const otpResult = await service.sendOtpMessage('9876543210', '482910', 5);
  assert.equal(otpResult.accepted, true);
  assert.equal(otpResult.ackStatus, 'sent');
  assert.equal(mockClient.sentMessages.length, 1);
  assert.equal(mockClient.sentMessages[0].to, '919876543210@s.whatsapp.net');
  assert.ok(mockClient.sentMessages[0].text.includes('482910'));
  assert.ok(mockClient.sentMessages[0].text.includes('Stickora Store'));

  // Ensure OTP never appears in logs
  assert.equal(loggedLines.some((line) => line.includes('482910')), false);

  // Disconnect gracefully
  const disconnected = await service.disconnect({ logout: false });
  assert.equal(disconnected.connected, false);
  assert.equal(mockClient.disconnectedCalls, 1);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('WhatsAppBerryService handles restart_required, connection.close, auth.error, and reconnect cleanly', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'berry-lifecycle-'));
  const clients = [];

  const service = new WhatsAppBerryService(makeTempConfig(tmpDir), {
    clientFactory: () => {
      const c = new MockBerryClient();
      clients.push(c);
      return c;
    },
    qrGenerator: async (raw) => `data:image/png;base64,${Buffer.from(raw).toString('base64')}`,
    logger: { info: () => {}, warn: () => {} },
  });

  await service.connect();
  assert.equal(service.getStatus().status, 'QR_READY');
  assert.equal(service.getStatus().sessionDirWritable, true);

  // Post-QR restart_required moves to RECONNECTING, not permanent ERROR/DISCONNECTED
  clients[0].emit('connection.close', { reason: 'restart_required' });
  assert.equal(service.getStatus().status, 'RECONNECTING');
  assert.equal(service.getStatus().connected, false);

  // Unexpected close clears QR and records useful lastError
  clients[0].emit('connection.close', { reason: 'connection_closed' });
  assert.equal(service.getStatus().status, 'DISCONNECTED');
  assert.equal(service.getStatus().hasQr, false);
  assert.ok(service.getStatus().lastError?.includes('connection_closed'));

  // Reconnect without saved creds starts fresh QR pairing flow (never fakes CONNECTED)
  await service.reconnect();
  assert.equal(service.getStatus().status, 'QR_READY');
  assert.equal(service.getStatus().connected, false);

  // Reconnect with saved creds transitions cleanly to CONNECTED
  const savedCredsDir = path.join(tmpDir, 'berry_auth', 'stickora_test_session');
  fs.mkdirSync(savedCredsDir, { recursive: true });
  fs.writeFileSync(path.join(savedCredsDir, 'creds.json'), JSON.stringify({ me: { id: '919876543210:1@s.whatsapp.net' } }));
  await service.reconnect();
  assert.equal(service.getStatus().connected, true);
  assert.equal(service.getStatus().status, 'CONNECTED');
  assert.equal(service.getStatus().connectedPhoneMasked, '+91 ******3210');

  // auth.error sets ERROR and clears client/QR without faking CONNECTED
  clients[clients.length - 1].emit('auth.error', { error: '401 Unauthorized session' });
  assert.equal(service.getStatus().status, 'ERROR');
  assert.equal(service.getStatus().connected, false);
  assert.equal(service.getStatus().lastError, '401 Unauthorized session');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
