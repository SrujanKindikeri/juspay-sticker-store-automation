import crypto from 'node:crypto';
import express from 'express';
import { loadConfig } from './config.js';
import {
  WhatsAppBerryService,
  WhatsAppServiceError,
} from './WhatsAppBerryService.js';

const config = loadConfig();
const service = new WhatsAppBerryService(config);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));

function requireInternalAuth(req, res, next) {
  if (!config.internalApiKey) {
    return res.status(503).json({
      error: 'WHATSAPP_INTERNAL_KEY_UNCONFIGURED',
      detail: 'WhatsApp sidecar internal API key is not configured.',
    });
  }

  const providedKey = req.header('X-WhatsApp-Internal-Key') || '';
  const expectedBuf = Buffer.from(config.internalApiKey, 'utf8');
  const providedBuf = Buffer.from(providedKey, 'utf8');

  if (
    expectedBuf.length !== providedBuf.length ||
    !crypto.timingSafeEqual(expectedBuf, providedBuf)
  ) {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      detail: 'Missing or invalid internal API credentials.',
    });
  }

  return next();
}

function handleError(res, err) {
  if (err instanceof WhatsAppServiceError) {
    return res.status(err.statusCode).json({
      error: err.code,
      detail: err.message,
    });
  }
  return res.status(500).json({
    error: 'INTERNAL_ERROR',
    detail: 'Unexpected WhatsApp service error.',
  });
}

// Public loopback health probe (exposes zero QR, phone, or session secrets)
app.get('/health', (_req, res) => {
  const status = service.getStatus();
  res.json({
    status: 'ok',
    provider: status.provider,
    enabled: status.enabled,
    experimental: status.experimental,
    sessionStatus: status.status,
    connected: status.connected,
  });
});

app.use('/internal', requireInternalAuth);

app.get('/internal/status', (_req, res) => {
  res.json(service.getStatus());
});

app.post('/internal/connect', async (_req, res) => {
  try {
    const result = await service.connect();
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

app.get('/internal/qr', (_req, res) => {
  try {
    res.json(service.getQrState());
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/internal/reconnect', async (_req, res) => {
  try {
    const result = await service.reconnect();
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/internal/disconnect', async (req, res) => {
  try {
    const logout = Boolean(req.body?.logout);
    const result = await service.disconnect({ logout });
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/internal/send-text', async (req, res) => {
  try {
    const { phone, message } = req.body || {};
    const result = await service.sendText(phone, message);
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/internal/send-otp', async (req, res) => {
  try {
    const { phone, otp, expiryMinutes } = req.body || {};
    const result = await service.sendOtpMessage(phone, otp, expiryMinutes || 5);
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

const server = app.listen(config.port, config.host, async () => {
  console.info(
    `[WhatsAppBerryService] Listening on http://${config.host}:${config.port} (provider=${config.provider}, experimental=${config.experimental})`
  );
  if (config.enabled && config.autoConnect && service.hasSavedAuthCredentials()) {
    try {
      await service.connect();
    } catch (err) {
      console.warn('[WhatsAppBerryService] Auto-reconnect skipped:', err?.message || 'error');
    }
  }
});

async function shutdown(signal) {
  console.info(`[WhatsAppBerryService] Received ${signal}, shutting down cleanly...`);
  try {
    await service.disconnect({ logout: false });
  } finally {
    server.close(() => process.exit(0));
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
