import fs from 'node:fs';
import path from 'node:path';
import BerryProtocol from 'berryprotocol';
import QRCode from 'qrcode';
import pino from 'pino';

export class WhatsAppServiceError extends Error {
  constructor(message, code = 'WHATSAPP_ERROR', statusCode = 500) {
    super(message);
    this.name = 'WhatsAppServiceError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function normalizePhoneNumber(rawPhone) {
  if (!rawPhone || typeof rawPhone !== 'string') {
    throw new WhatsAppServiceError('Phone number is required.', 'INVALID_PHONE', 400);
  }

  let cleaned = rawPhone.trim();
  if (cleaned.startsWith('00')) {
    cleaned = '+' + cleaned.slice(2);
  }

  // Strip spaces, dashes, parentheses, dots
  const stripped = cleaned.replace(/[\s\-().]/g, '');
  const hasPlus = stripped.startsWith('+');
  const digitsOnly = stripped.replace(/\D/g, '');

  if (!digitsOnly) {
    throw new WhatsAppServiceError('Phone number contains no digits.', 'INVALID_PHONE', 400);
  }

  let normalizedDigits = digitsOnly;
  // Support 10-digit Indian mobile numbers seamlessly if no country code given
  if (!hasPlus && digitsOnly.length === 10) {
    if (!/^[6-9]\d{9}$/.test(digitsOnly)) {
      throw new WhatsAppServiceError(
        'Enter a valid 10-digit Indian mobile number (starting with 6-9) or E.164 format (+91...).',
        'INVALID_PHONE',
        400
      );
    }
    normalizedDigits = `91${digitsOnly}`;
  } else if (!hasPlus && digitsOnly.length === 11 && digitsOnly.startsWith('0') && /^0[6-9]\d{9}$/.test(digitsOnly)) {
    normalizedDigits = `91${digitsOnly.slice(1)}`;
  } else if (digitsOnly.startsWith('91') && digitsOnly.length === 12 && !/^91[6-9]\d{9}$/.test(digitsOnly)) {
    throw new WhatsAppServiceError(
      'Enter a valid Indian mobile number (+91 followed by 10 digits starting with 6-9).',
      'INVALID_PHONE',
      400
    );
  }

  if (normalizedDigits.length < 10 || normalizedDigits.length > 15) {
    throw new WhatsAppServiceError(
      'Enter a valid WhatsApp phone number with country code (e.g. +919876543210).',
      'INVALID_PHONE',
      400
    );
  }

  return {
    e164: `+${normalizedDigits}`,
    digits: normalizedDigits,
    jid: `${normalizedDigits}@s.whatsapp.net`,
  };
}

export function maskPhoneNumber(rawPhoneOrJid) {
  if (!rawPhoneOrJid) return null;
  const base = String(rawPhoneOrJid).split('@')[0].split(':')[0];
  const digits = base.replace(/\D/g, '');
  if (digits.length < 6) return '******';
  const prefix = digits.length > 10 ? `+${digits.slice(0, digits.length - 10)} ` : '';
  return `${prefix}******${digits.slice(-4)}`;
}

function extractPhoneFromJid(jidOrId) {
  if (!jidOrId) return null;
  const userPart = String(jidOrId).split('@')[0].split(':')[0].replace(/\D/g, '');
  return userPart ? `+${userPart}` : null;
}

export class WhatsAppBerryService {
  constructor(config, options = {}) {
    this.config = config;
    this.clientFactory =
      options.clientFactory ||
      ((clientOpts) => new BerryProtocol(clientOpts));
    this.qrGenerator = options.qrGenerator || ((qr) => QRCode.toDataURL(qr, { width: 280, margin: 2 }));
    this.logger = options.logger || console;

    this.client = null;
    this.status = 'DISCONNECTED';
    this.lastQrRaw = null;
    this.lastQrDataUrl = null;
    this.qrGeneratedAt = null;
    this.connectedJid = null;
    this.connectedPhone = null;
    this.lastConnectedAt = null;
    this.lastDisconnectedAt = null;
    this.lastError = null;
    this.reconnectAttempts = 0;
    this.connectInFlight = null;
    this.pendingAcks = new Map();

    this.#loadPersistedMeta();
  }

  #ensureDataDirs() {
    fs.mkdirSync(this.config.sessionPath, { recursive: true });
    fs.mkdirSync(path.dirname(this.config.databasePath), { recursive: true });
    fs.mkdirSync(path.dirname(this.config.metaFile), { recursive: true });
  }

  #loadPersistedMeta() {
    try {
      if (!fs.existsSync(this.config.metaFile)) return;
      const raw = fs.readFileSync(this.config.metaFile, 'utf-8');
      const parsed = JSON.parse(raw);
      // Do not restore CONNECTED blindly until socket verifies on connect; keep historical metadata
      this.connectedJid = parsed.connectedJid || null;
      this.connectedPhone = parsed.connectedPhone || null;
      this.lastConnectedAt = parsed.lastConnectedAt || null;
      this.lastDisconnectedAt = parsed.lastDisconnectedAt || null;
    } catch {
      // Corrupt metadata must not block service boot
    }
  }

  #savePersistedMeta() {
    try {
      fs.mkdirSync(path.dirname(this.config.metaFile), { recursive: true });
      const payload = {
        provider: this.config.provider,
        experimental: Boolean(this.config.experimental),
        sessionId: this.config.sessionId,
        status: this.status,
        connectedJid: this.connectedJid,
        connectedPhone: this.connectedPhone,
        connectedPhoneMasked: maskPhoneNumber(this.connectedPhone),
        lastConnectedAt: this.lastConnectedAt,
        lastDisconnectedAt: this.lastDisconnectedAt,
        lastError: this.lastError,
        reconnectAttempts: this.reconnectAttempts,
        updatedAt: new Date().toISOString(),
      };
      fs.writeFileSync(this.config.metaFile, JSON.stringify(payload, null, 2), 'utf-8');
    } catch (err) {
      this.logger.warn('[WhatsAppBerryService] Unable to persist session metadata:', err?.message || 'write error');
    }
  }

  #resolveCredsFilePath() {
    const nested = path.join(this.config.sessionPath, this.config.sessionId, 'creds.json');
    if (fs.existsSync(nested)) return nested;
    const flat = path.join(this.config.sessionPath, 'creds.json');
    if (fs.existsSync(flat)) return flat;
    return nested;
  }

  #readConnectedInfoFromAuth() {
    try {
      const credsFile = this.#resolveCredsFilePath();
      if (!fs.existsSync(credsFile)) return null;
      const creds = JSON.parse(fs.readFileSync(credsFile, 'utf-8'));
      const jid = creds?.me?.id || null;
      const phone = extractPhoneFromJid(jid);
      return { jid, phone };
    } catch {
      return null;
    }
  }

  hasSavedAuthCredentials() {
    try {
      return fs.existsSync(this.#resolveCredsFilePath());
    } catch {
      return false;
    }
  }

  #clearQrCache() {
    this.lastQrRaw = null;
    this.lastQrDataUrl = null;
    this.qrGeneratedAt = null;
  }

  #isSessionDirWritable() {
    try {
      this.#ensureDataDirs();
      fs.accessSync(this.config.sessionPath, fs.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  #ensureClient(forceNew = false) {
    if (this.client && !forceNew) return this.client;

    this.#ensureDataDirs();
    const quietLogger = pino({ level: 'warn' });
    const client = this.clientFactory({
      sessionId: this.config.sessionId,
      databasePath: this.config.databasePath,
      authFolder: this.config.sessionPath,
      reconnectMaxAttempts: this.config.reconnectMaxAttempts,
      reconnectDelayMs: this.config.reconnectDelayMs,
      printQrInTerminal: false,
      logger: quietLogger,
    });

    this.#bindClientEvents(client);
    this.client = client;
    return client;
  }

  #refreshConnectedIdentity() {
    const authInfo = this.#readConnectedInfoFromAuth();
    if (authInfo?.phone) {
      this.connectedPhone = authInfo.phone;
      this.connectedJid = authInfo.jid || this.connectedJid;
      return;
    }
    const liveUserId = this.client?.socket?.sock?.user?.id;
    const livePhone = extractPhoneFromJid(liveUserId);
    if (livePhone) {
      this.connectedPhone = livePhone;
      this.connectedJid = `${livePhone.replace(/\D/g, '')}@s.whatsapp.net`;
    }
  }

  #bindClientEvents(client) {
    const handleQr = async (qrValue) => {
      if (this.client !== client) return;
      const raw = typeof qrValue === 'string' ? qrValue : qrValue?.value;
      if (!raw) return;
      this.lastQrRaw = raw;
      this.qrGeneratedAt = new Date().toISOString();
      this.status = 'QR_READY';
      this.lastError = null;
      try {
        this.lastQrDataUrl = await this.qrGenerator(raw);
      } catch {
        this.lastQrDataUrl = null;
      }
      this.#savePersistedMeta();
    };

    client.on('qr', handleQr);
    client.on('auth.qr', handleQr);

    client.on('auth.success', (authSnapshot) => {
      if (this.client !== client) return;
      if (authSnapshot?.clientId) {
        const phone = extractPhoneFromJid(authSnapshot.clientId);
        if (phone) {
          this.connectedPhone = phone;
          this.connectedJid = `${phone.replace(/\D/g, '')}@s.whatsapp.net`;
        }
      }
      this.#refreshConnectedIdentity();
      this.#savePersistedMeta();
    });

    client.on('connection.open', (state) => {
      if (this.client !== client) return;
      this.status = 'CONNECTED';
      this.lastError = null;
      this.reconnectAttempts = 0;
      this.lastConnectedAt = state?.connectedAt || new Date().toISOString();
      this.#clearQrCache();

      this.#refreshConnectedIdentity();
      this.#savePersistedMeta();
      // saveCreds() in BerrySocket writes creds.json asynchronously right around connection.open
      setTimeout(() => {
        if (this.status === 'CONNECTED' && !this.connectedPhone) {
          this.#refreshConnectedIdentity();
          this.#savePersistedMeta();
        }
      }, 400);
    });

    client.on('connection.reconnecting', (payload) => {
      if (this.client !== client) return;
      this.status = 'RECONNECTING';
      this.reconnectAttempts = payload?.attempt || this.reconnectAttempts + 1;
      this.#savePersistedMeta();
    });

    client.on('connection.close', (state) => {
      if (this.client !== client) return;
      const reason = state?.reason || 'closed';
      this.lastDisconnectedAt = state?.disconnectedAt || new Date().toISOString();
      if (reason === 'restart_required') {
        this.status = 'RECONNECTING';
        this.lastError = null;
      } else {
        this.#clearQrCache();
        this.status = 'DISCONNECTED';
        if (reason === 'logged_out') {
          this.connectedJid = null;
          this.connectedPhone = null;
          this.client = null;
          this.lastError = 'WhatsApp session logged out from device. Click Connect WhatsApp to link again.';
        } else if (reason === 'manual' || reason === 'reconnect') {
          this.lastError = null;
        } else {
          this.lastError = `WhatsApp connection closed (${reason}). Click Connect WhatsApp or Reconnect.`;
        }
      }
      this.#savePersistedMeta();
    });

    client.on('auth.error', (payload) => {
      if (this.client !== client) return;
      this.status = 'ERROR';
      this.lastError = payload?.error || 'WhatsApp authentication error.';
      this.#clearQrCache();
      this.client = null;
      this.#savePersistedMeta();
    });

    client.on('protocol.error', (payload) => {
      if (this.client !== client) return;
      this.lastError = payload?.error || 'WhatsApp protocol error.';
      this.#savePersistedMeta();
    });

    client.on('message.ack', (ack) => {
      if (!ack?.messageId) return;
      const waiter = this.pendingAcks.get(ack.messageId);
      if (waiter) {
        waiter.resolve(ack);
        this.pendingAcks.delete(ack.messageId);
      }
    });
  }

  getStatus() {
    const dirWritable = this.#isSessionDirWritable();
    return {
      provider: this.config.provider,
      enabled: Boolean(this.config.enabled),
      experimental: Boolean(this.config.experimental),
      senderName: this.config.senderName,
      sessionId: this.config.sessionId,
      status: this.status,
      connected: this.status === 'CONNECTED',
      hasQr: Boolean(this.lastQrDataUrl || this.lastQrRaw),
      hasSavedSession: this.hasSavedAuthCredentials(),
      sessionDirWritable: dirWritable,
      connectedPhone: this.status === 'CONNECTED' ? this.connectedPhone : null,
      connectedPhoneMasked: maskPhoneNumber(this.connectedPhone),
      lastConnectedAt: this.lastConnectedAt,
      lastDisconnectedAt: this.lastDisconnectedAt,
      reconnectAttempts: this.reconnectAttempts,
      lastError: this.lastError,
    };
  }

  getQrState() {
    if (!this.config.enabled) {
      throw new WhatsAppServiceError('WhatsApp integration is disabled in configuration.', 'WHATSAPP_DISABLED', 503);
    }

    if (this.status === 'CONNECTED') {
      return {
        status: this.status,
        connected: true,
        hasQr: false,
        qrDataUrl: null,
        qrGeneratedAt: null,
        message: 'WhatsApp session is already connected.',
      };
    }

    return {
      status: this.status,
      connected: false,
      hasQr: Boolean(this.lastQrDataUrl || this.lastQrRaw),
      qrDataUrl: this.lastQrDataUrl,
      qrGeneratedAt: this.qrGeneratedAt,
      message: this.lastQrDataUrl
        ? 'Scan this QR code from WhatsApp Linked Devices.'
        : this.lastError || 'QR code not generated yet. Trigger Connect WhatsApp first.',
    };
  }

  async #launchHandshake(client, useReconnect = false) {
    const startConnect = async () => {
      try {
        if (useReconnect && this.hasSavedAuthCredentials()) {
          await client.reconnect();
        } else if (this.hasSavedAuthCredentials()) {
          await client.connect();
        } else {
          await client.connectWithQr({ waitForConnection: false });
        }
      } catch (err) {
        if (this.client === client && this.status !== 'CONNECTED') {
          this.status = 'ERROR';
          this.lastError = err?.message || 'Failed to initiate WhatsApp connection.';
          this.#savePersistedMeta();
        }
      } finally {
        this.connectInFlight = null;
      }
    };

    this.connectInFlight = startConnect();
    await Promise.race([
      this.connectInFlight,
      new Promise((resolve) => setTimeout(resolve, 250)),
    ]);
    return this.getStatus();
  }

  async connect() {
    if (!this.config.enabled) {
      throw new WhatsAppServiceError('WhatsApp integration is disabled in configuration.', 'WHATSAPP_DISABLED', 503);
    }

    if (this.status === 'CONNECTED' || this.status === 'CONNECTING' || this.status === 'QR_READY') {
      return this.getStatus();
    }

    const forceNew = this.status === 'DISCONNECTED' || this.status === 'ERROR';
    const client = this.#ensureClient(forceNew);
    this.status = 'CONNECTING';
    this.lastError = null;
    this.#savePersistedMeta();

    return this.#launchHandshake(client, false);
  }

  async reconnect() {
    if (!this.config.enabled) {
      throw new WhatsAppServiceError('WhatsApp integration is disabled in configuration.', 'WHATSAPP_DISABLED', 503);
    }

    const hadClient = Boolean(this.client);
    const client = this.#ensureClient(!hadClient || this.status === 'ERROR');
    this.status = 'RECONNECTING';
    this.lastError = null;
    this.#clearQrCache();
    this.#savePersistedMeta();

    return this.#launchHandshake(client, hadClient);
  }

  async disconnect({ logout = false } = {}) {
    this.#clearQrCache();
    if (!this.client) {
      this.status = 'DISCONNECTED';
      this.lastDisconnectedAt = new Date().toISOString();
      if (logout) {
        this.connectedJid = null;
        this.connectedPhone = null;
      }
      this.#savePersistedMeta();
      return this.getStatus();
    }

    try {
      if (logout) {
        await this.client.logout();
        this.connectedJid = null;
        this.connectedPhone = null;
      } else {
        await this.client.disconnect();
      }
    } catch (err) {
      this.logger.warn('[WhatsAppBerryService] Error while disconnecting:', err?.message || 'disconnect error');
    } finally {
      this.status = 'DISCONNECTED';
      this.lastDisconnectedAt = new Date().toISOString();
      this.lastError = null;
      this.#savePersistedMeta();
    }

    return this.getStatus();
  }

  async #waitForAck(messageId, timeoutMs) {
    if (!messageId || timeoutMs <= 0) return null;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingAcks.delete(messageId);
        resolve(null);
      }, timeoutMs);

      this.pendingAcks.set(messageId, {
        resolve: (ack) => {
          clearTimeout(timer);
          resolve(ack);
        },
      });
    });
  }

  async sendText(phone, text) {
    if (!this.config.enabled) {
      throw new WhatsAppServiceError('WhatsApp integration is disabled.', 'WHATSAPP_DISABLED', 503);
    }
    if (this.status !== 'CONNECTED' || !this.client) {
      throw new WhatsAppServiceError(
        'Merchant WhatsApp session is not connected. Ask the store administrator to link WhatsApp.',
        'WHATSAPP_DISCONNECTED',
        503
      );
    }
    if (!text || typeof text !== 'string' || !text.trim()) {
      throw new WhatsAppServiceError('Message text must not be empty.', 'INVALID_MESSAGE', 400);
    }

    const normalized = normalizePhoneNumber(phone);
    let outgoing;
    try {
      outgoing = await this.client.sendText(normalized.jid, text.trim());
    } catch (err) {
      throw new WhatsAppServiceError(
        err?.message || 'Failed to dispatch WhatsApp message.',
        'WHATSAPP_SEND_FAILED',
        502
      );
    }

    const messageId = outgoing?.id || outgoing?.messageId || null;
    if (!messageId) {
      throw new WhatsAppServiceError(
        'WhatsApp provider did not acknowledge message submission.',
        'WHATSAPP_NO_ACK',
        502
      );
    }

    const ack = await this.#waitForAck(messageId, this.config.ackWaitMs);
    const ackStatus = ack?.ack || outgoing?.status || 'sent';
    if (ackStatus === 'failed') {
      throw new WhatsAppServiceError(
        'WhatsApp delivery failed according to provider acknowledgement.',
        'WHATSAPP_DELIVERY_FAILED',
        502
      );
    }

    // Strict logging rule: NEVER log message content, OTPs, or full personal phone numbers
    this.logger.info(
      `[WhatsAppBerryService] Dispatched messageId=${messageId} to=${maskPhoneNumber(normalized.e164)} ack=${ackStatus}`
    );

    return {
      accepted: true,
      provider: this.config.provider,
      messageId,
      ackStatus,
      recipientMasked: maskPhoneNumber(normalized.e164),
      timestamp: new Date().toISOString(),
    };
  }

  async sendOtpMessage(phone, otp, expiryMinutes = 5) {
    if (!otp || !/^\d{6}$/.test(String(otp))) {
      throw new WhatsAppServiceError('OTP must be a 6-digit code.', 'INVALID_OTP_FORMAT', 400);
    }

    const messageText = [
      `*${this.config.senderName}* Verification`,
      `Your verification code is: *${otp}*`,
      `This code expires in ${expiryMinutes} minutes. Never share it with anyone.`,
    ].join('\n');

    return this.sendText(phone, messageText);
  }
}
