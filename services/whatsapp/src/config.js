import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const SERVICE_ROOT = path.resolve(__dirname, '..');
export const PROJECT_ROOT = path.resolve(SERVICE_ROOT, '..', '..');

// Load project root .env first, then local service .env if present (do not overwrite explicit process env)
const rootEnvPath = path.join(PROJECT_ROOT, '.env');
if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath, override: false });
}
const serviceEnvPath = path.join(SERVICE_ROOT, '.env');
if (fs.existsSync(serviceEnvPath)) {
  dotenv.config({ path: serviceEnvPath, override: false });
}

function toBool(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function resolveProjectPath(rawPath, fallbackRelativePath) {
  const chosen = (rawPath && String(rawPath).trim()) || fallbackRelativePath;
  if (path.isAbsolute(chosen)) {
    return path.normalize(chosen);
  }
  return path.resolve(PROJECT_ROOT, chosen);
}

export function loadConfig() {
  return {
    provider: process.env.WHATSAPP_PROVIDER || 'berryprotocol',
    enabled: toBool(process.env.WHATSAPP_ENABLED, true),
    experimental: toBool(process.env.WHATSAPP_EXPERIMENTAL, true),
    senderName: process.env.WHATSAPP_SENDER_NAME || 'Stickora Store',
    sessionId: process.env.WHATSAPP_SESSION_ID || 'stickora_berry_session',
    sessionPath: resolveProjectPath(process.env.WHATSAPP_SESSION_PATH, './data/berry_auth'),
    databasePath: resolveProjectPath(process.env.WHATSAPP_DATABASE_PATH, './data/berry_store.db'),
    metaFile: resolveProjectPath(process.env.WHATSAPP_META_FILE, './data/whatsapp_session.json'),
    host: process.env.WHATSAPP_SERVICE_HOST || '127.0.0.1',
    port: Number.parseInt(process.env.WHATSAPP_SERVICE_PORT || '8002', 10) || 8002,
    internalApiKey: process.env.WHATSAPP_INTERNAL_API_KEY || '',
    autoConnect: toBool(process.env.WHATSAPP_AUTO_CONNECT, false),
    reconnectMaxAttempts: Number.parseInt(process.env.WHATSAPP_RECONNECT_MAX_ATTEMPTS || '5', 10) || 5,
    reconnectDelayMs: Number.parseInt(process.env.WHATSAPP_RECONNECT_DELAY_MS || '3000', 10) || 3000,
    ackWaitMs: Number.parseInt(process.env.WHATSAPP_ACK_WAIT_MS || '1500', 10) || 1500,
  };
}
