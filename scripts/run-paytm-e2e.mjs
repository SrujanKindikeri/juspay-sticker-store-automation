#!/usr/bin/env node
/**
 * ============================================================================
 * STICKORA STORE — PAYTM SANDBOX & E2E AUTOMATION TEST RUNNER
 * ============================================================================
 * 
 * Master test orchestrator for official Paytm Payment Gateway sandbox:
 * - Single-Run Headed mode:   `npm run test:paytm-e2e:headed` (Executes ONE customer journey)
 * - CI/Headless mode:         `npm run test:paytm-e2e:headless` (Full automated test pipeline)
 * 
 * Strict Single-Run Requirements:
 * - Playwright workers: 1
 * - Retries: 0 (No automatic reruns)
 * - Headed and headless never run together
 * - Checks execution state before creating orders or payments to prevent duplicates
 * - Outputs final formatted report and terminates without repeating
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';

const ROOT_DIR = process.cwd();
const PYTHON_PATH = resolve(ROOT_DIR, 'backend', 'venv', 'Scripts', 'python.exe');
const AUTOMATION_DIR = resolve(ROOT_DIR, 'automation', 'web');
const STATE_FILE = resolve(AUTOMATION_DIR, 'test-results', 'paytm-execution-state.json');

const isHeaded = process.argv.includes('--headed');
const executionId =
  process.env.PAYTM_EXECUTION_ID ||
  `EXEC-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

function banner(title) {
  const line = '═'.repeat(74);
  console.log(`\n${COLORS.cyan}${line}${COLORS.reset}`);
  console.log(`${COLORS.bold}${COLORS.cyan}  ${title}${COLORS.reset}`);
  console.log(`${COLORS.cyan}${line}${COLORS.reset}\n`);
}

function subheader(title) {
  console.log(`\n${COLORS.bold}${COLORS.yellow}▶ ${title}${COLORS.reset}`);
  console.log(`${COLORS.dim}${'─'.repeat(70)}${COLORS.reset}`);
}

function checkTcpPort(host, port, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeoutMs);

    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });

    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });

    socket.connect(port, host);
  });
}

function checkHttpEndpoint(url, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const isHttps = url.startsWith('https://');
    const client = isHttps ? https : http;

    const req = client.get(url, { timeout: timeoutMs }, (res) => {
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => {
      resolve(false);
    });
  });
}

function runCommand(command, args, cwd = ROOT_DIR, customEnv = {}) {
  return new Promise((resolve) => {
    const start = Date.now();
    const safeCommand = command.includes(' ') ? `"${command}"` : command;
    const safeArgs = args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ');
    const fullCmd = `${safeCommand} ${safeArgs}`.trim();

    const proc = spawn(fullCmd, [], {
      cwd,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        FORCE_COLOR: '1',
        ...customEnv,
      },
      shell: true,
      stdio: 'inherit',
    });

    proc.on('close', (code) => {
      const duration = ((Date.now() - start) / 1000).toFixed(2);
      resolve({ code, duration });
    });

    proc.on('error', (err) => {
      resolve({ code: 1, duration: 0, error: err });
    });
  });
}

function readExecutionState() {
  if (existsSync(STATE_FILE)) {
    try {
      return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    } catch {
      // Fallback
    }
  }
  return null;
}

function initializeStateFile(id) {
  const resultsDir = resolve(AUTOMATION_DIR, 'test-results');
  if (!existsSync(resultsDir)) {
    mkdirSync(resultsDir, { recursive: true });
  }
  const initialState = {
    executionId: id,
    startedAt: new Date().toISOString(),
    browserOpened: false,
    productAdded: false,
    checkoutCompleted: false,
    orderCreated: false,
    orderId: null,
    orderTotal: null,
    orderToken: null,
    paytmCheckoutOpened: false,
    transactionInitiated: false,
    transactionId: null,
    paymentReference: null,
    paymentVerified: false,
    paymentStatus: null,
    lastCompletedStep: null,
    failedStep: null,
    failureError: null,
    isCompleted: false,
  };
  writeFileSync(STATE_FILE, JSON.stringify(initialState, null, 2), 'utf8');
  return initialState;
}

async function main() {
  const overallStart = Date.now();
  const headerMode = isHeaded
    ? 'HEADED SINGLE-RUN (VISIBLE BROWSER · 800ms SLOW MOTION · 1 JOURNEY)'
    : 'HEADLESS CI PIPELINE (WORKERS: 1 · RETRIES: 0)';
  banner(`STICKORA STORE — PAYTM SANDBOX TEST RUNNER\n  [MODE: ${headerMode}]\n  [EXECUTION ID: ${executionId}]`);

  // Initialize fresh execution state
  initializeStateFile(executionId);

  // --------------------------------------------------------------------------
  // STEP 1: Environment & Credential Inspection
  // --------------------------------------------------------------------------
  subheader('Step 1: Inspecting Configuration & Security Environment');

  const envPath = join(ROOT_DIR, '.env');
  let paytmMid = '';
  let paytmKey = '';
  let paymentProvider = 'simulated';
  let isLiveConfigured = false;
  let missingGenuineRequirements = [];

  if (existsSync(envPath)) {
    console.log(`  ${COLORS.green}✓${COLORS.reset} Found root configuration file (.env)`);
    const envContent = readFileSync(envPath, 'utf8');
    const midMatch = envContent.match(/^PAYTM_MID=(.*)$/m);
    const keyMatch = envContent.match(/^PAYTM_MERCHANT_KEY=(.*)$/m);
    const provMatch = envContent.match(/^PAYMENT_PROVIDER=(.*)$/m);

    paytmMid = midMatch ? midMatch[1].trim() : '';
    paytmKey = keyMatch ? keyMatch[1].trim() : '';
    paymentProvider = provMatch ? provMatch[1].trim() : 'simulated';

    const isMidReal = paytmMid && !paytmMid.includes('YOUR_') && !paytmMid.includes('STAGE_MID_DEMO') && paytmMid.length >= 8;
    const isKeyReal = paytmKey && !paytmKey.includes('YOUR_') && !paytmKey.includes('STAGE_KEY_DEMO') && paytmKey.length >= 8;

    if (paymentProvider !== 'paytm') {
      missingGenuineRequirements.push(`PAYMENT_PROVIDER is '${paymentProvider}' (Requires: 'paytm')`);
    }
    if (!isMidReal) {
      missingGenuineRequirements.push(`PAYTM_MID is missing or empty in .env`);
    }
    if (!isKeyReal) {
      missingGenuineRequirements.push(`PAYTM_MERCHANT_KEY is missing or empty in .env`);
    }

    isLiveConfigured = Boolean(paymentProvider === 'paytm' && isMidReal && isKeyReal);

    console.log(`    • Active Provider       : ${COLORS.bold}${paymentProvider}${COLORS.reset}`);
    console.log(`    • Paytm Merchant MID    : ${paytmMid ? `${paytmMid.slice(0, 4)}...${paytmMid.slice(-3)}` : 'Not configured (mock fallback)'}`);
    console.log(`    • Browser Mode          : ${isHeaded ? `${COLORS.green}HEADED (Visible window, 800ms slowMo, workers: 1, retries: 0)${COLORS.reset}` : `${COLORS.cyan}HEADLESS${COLORS.reset}`}`);
    console.log(`    • Automated Mocked Tests: ${COLORS.green}ENABLED${COLORS.reset} (Deterministic Cryptographic Simulation)`);

    if (isLiveConfigured) {
      console.log(`    • Genuine Staging Tests : ${COLORS.green}READY${COLORS.reset} (Valid credentials detected)`);
    } else {
      console.log(`    • Genuine Staging Tests : ${COLORS.yellow}STOPPED / SKIPPED${COLORS.reset} (Missing staging credentials in .env)`);
    }
  } else {
    console.log(`  ${COLORS.yellow}⚠${COLORS.reset} .env not found at root. Using default test environment.`);
  }

  // --------------------------------------------------------------------------
  // STEP 2: Infrastructure Health Check
  // --------------------------------------------------------------------------
  subheader('Step 2: Checking Service Infrastructure Connectivity');

  const [postgresOk, backendOk, frontendOk, paytmGatewayOk] = await Promise.all([
    checkTcpPort('127.0.0.1', 5433),
    checkHttpEndpoint('http://127.0.0.1:8001/health'),
    checkHttpEndpoint('http://127.0.0.1:3001').then(ok => ok || checkHttpEndpoint('http://localhost:3001')),
    checkHttpEndpoint('https://securegw-stage.paytm.in'),
  ]);

  console.log(`  • PostgreSQL Database (port 5433)     : ${postgresOk ? `${COLORS.green}ONLINE (Connected)${COLORS.reset}` : `${COLORS.red}OFFLINE${COLORS.reset}`}`);
  console.log(`  • FastAPI Backend Server (port 8001)   : ${backendOk ? `${COLORS.green}ONLINE (Healthy)${COLORS.reset}` : `${COLORS.red}OFFLINE${COLORS.reset}`}`);
  console.log(`  • Next.js Storefront (port 3001)       : ${frontendOk ? `${COLORS.green}ONLINE (Ready)${COLORS.reset}` : `${COLORS.red}OFFLINE${COLORS.reset}`}`);
  console.log(`  • Paytm Staging Gateway (HTTPS reach) : ${paytmGatewayOk ? `${COLORS.green}REACHABLE (securegw-stage.paytm.in)${COLORS.reset}` : `${COLORS.yellow}LIMITED (Offline / Firewall)${COLORS.reset}`}`);

  if (!postgresOk) {
    console.error(`\n${COLORS.red}ERROR: PostgreSQL on port 5433 is unreachable. Ensure docker container 'juspay_postgres' is running.${COLORS.reset}`);
    process.exit(1);
  }
  if (!backendOk) {
    console.error(`\n${COLORS.red}ERROR: FastAPI backend is not responding on http://127.0.0.1:8001/health.${COLORS.reset}`);
    process.exit(1);
  }
  if (!frontendOk) {
    console.error(`\n${COLORS.red}ERROR: Next.js frontend is not responding on http://localhost:3001.${COLORS.reset}`);
    process.exit(1);
  }

  // --------------------------------------------------------------------------
  // STEP 3: Backend Suite (Skipped in Headed Single-Run Mode to avoid repetition)
  // --------------------------------------------------------------------------
  if (!isHeaded) {
    subheader('Step 3: Executing Pytest Backend Paytm Integration Suite');
    console.log(`  Target: backend/tests/test_paytm_provider.py\n`);

    const pytestResult = await runCommand(
      PYTHON_PATH,
      ['-m', 'pytest', 'backend/tests/test_paytm_provider.py', '-v', '--tb=short']
    );

    const pytestPassed = pytestResult.code === 0;
    console.log(`\n  Pytest Backend Execution: ${pytestPassed ? `${COLORS.green}PASSED${COLORS.reset}` : `${COLORS.red}FAILED${COLORS.reset}`} (${pytestResult.duration}s)`);

    if (!pytestPassed) {
      console.error(`\n${COLORS.red}Pytest test failures detected. Halting test pipeline.${COLORS.reset}`);
      process.exit(1);
    }
  } else {
    subheader('Step 3: Pytest Backend Integration Suite');
    console.log(`  ${COLORS.dim}Pytest backend suite skipped in headed single-run mode to execute exactly ONE visible customer journey.${COLORS.reset}`);
  }

  // --------------------------------------------------------------------------
  // STEP 4: Playwright Browser Execution (Exactly ONE Customer Journey)
  // --------------------------------------------------------------------------
  subheader(`Step 4: Executing Customer Journey Browser Workflow (${isHeaded ? 'HEADED VISIBLE' : 'HEADLESS'})`);
  console.log(`  Target: automation/web/tests/paytm-payment.spec.ts`);
  console.log(`  Workers: 1 | Retries: 0 | Execution ID: ${executionId}`);

  if (isHeaded) {
    console.log(`  ${COLORS.bold}${COLORS.magenta}🖥️  HEADED MODE ACTIVE:${COLORS.reset} A real Chromium browser window will open.`);
    console.log(`  ${COLORS.dim}Actions are paced with 800ms slow motion. The workflow executes exactly once.${COLORS.reset}\n`);
  } else {
    console.log(`  ${COLORS.dim}Running in background headless mode (workers: 1, retries: 0).${COLORS.reset}\n`);
  }

  const playwrightArgs = [
    'playwright',
    'test',
    'tests/paytm-payment.spec.ts',
    '--workers=1',
    '--retries=0',
    '--reporter=list',
  ];

  if (isHeaded) {
    playwrightArgs.push('-g', 'Full E2E Journey');
    playwrightArgs.push('--headed');
  }

  const playwrightEnv = {
    PAYTM_EXECUTION_ID: executionId,
    HEADED: isHeaded ? '1' : '0',
    SLOWMO: isHeaded ? '800' : '0',
  };

  const playwrightResult = await runCommand('npx', playwrightArgs, AUTOMATION_DIR, playwrightEnv);
  const playwrightPassed = playwrightResult.code === 0;

  // --------------------------------------------------------------------------
  // STEP 5: Read Execution State & Display Final Report
  // --------------------------------------------------------------------------
  const state = readExecutionState() || {
    browserOpened: false,
    productAdded: false,
    checkoutCompleted: false,
    orderId: null,
    transactionId: null,
    paytmCheckoutOpened: false,
    paymentVerified: false,
    paymentStatus: null,
    failedStep: 'Playwright process exited before recording state',
  };

  const totalDuration = ((Date.now() - overallStart) / 1000).toFixed(2);

  banner('STICKORA STORE + PAYTM — WORKFLOW EXECUTION REPORT');

  console.log(`- Browser opened: ${state.browserOpened ? 'PASS' : 'FAIL'}`);
  console.log(`- Product added: ${state.productAdded ? 'PASS' : 'FAIL'}`);
  console.log(`- Checkout completed: ${state.checkoutCompleted ? 'PASS' : 'FAIL'}`);
  console.log(`- Order ID: ${state.orderId || 'None'}`);
  console.log(`- Paytm transaction ID: ${state.transactionId || 'None'}`);
  console.log(`- Paytm checkout opened: ${state.paytmCheckoutOpened ? 'PASS' : 'FAIL'}`);
  console.log(`- Payment verification: ${state.paymentVerified ? 'PASS' : 'FAIL'}`);
  console.log(`- Final payment status: ${state.paymentStatus || (state.failedStep ? 'FAILED' : 'PENDING')}`);
  console.log(`- Failure step, if any: ${state.failedStep || 'None'}`);

  console.log(`\n  ${COLORS.cyan}══════════════════════════════════════════════════════════════════════════${COLORS.reset}`);
  console.log(`  ${COLORS.bold}SUMMARY:${COLORS.reset} Total Execution Time: ${totalDuration}s | Single-Run Workflow: ${playwrightPassed ? `${COLORS.green}SUCCESS${COLORS.reset}` : `${COLORS.red}FAILED${COLORS.reset}`}`);
  console.log(`  ${COLORS.dim}State File: ${STATE_FILE}${COLORS.reset}`);
  console.log(`  ${COLORS.cyan}══════════════════════════════════════════════════════════════════════════${COLORS.reset}\n`);

  if (!playwrightPassed || state.failedStep) {
    console.error(`Workflow terminated with failure at step: ${state.failedStep || 'Unknown'}`);
    process.exit(1);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Unexpected error in test runner:', err);
  process.exit(1);
});
