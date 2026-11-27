import * as fs from 'fs';
import * as path from 'path';

export interface ExecutionState {
  executionId: string;
  startedAt: string;
  browserOpened: boolean;
  productAdded: boolean;
  checkoutCompleted: boolean;
  orderCreated: boolean;
  orderId: string | null;
  orderTotal: string | null;
  orderToken: string | null;
  paytmCheckoutOpened: boolean;
  transactionInitiated: boolean;
  transactionId: string | null;
  paymentReference: string | null;
  paymentVerified: boolean;
  paymentStatus: string | null;
  lastCompletedStep: string | null;
  failedStep: string | null;
  failureError: string | null;
  isCompleted: boolean;
}

const STATE_FILE_DIR = path.resolve(__dirname, '../test-results');
const STATE_FILE = path.join(STATE_FILE_DIR, 'paytm-execution-state.json');

let currentState: ExecutionState | null = null;

export function initExecutionState(customId?: string): ExecutionState {
  const executionId =
    customId ||
    process.env.PAYTM_EXECUTION_ID ||
    `EXEC-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

  currentState = {
    executionId,
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

  saveExecutionState();
  return currentState;
}

export function getExecutionState(): ExecutionState {
  if (currentState) {
    return currentState;
  }
  if (fs.existsSync(STATE_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      currentState = data;
      return currentState!;
    } catch {
      // Fallback to init
    }
  }
  return initExecutionState();
}

export function updateExecutionState(partial: Partial<ExecutionState>): ExecutionState {
  const state = getExecutionState();
  currentState = { ...state, ...partial };
  saveExecutionState();
  return currentState;
}

export function recordStepSuccess(stepName: string, updates: Partial<ExecutionState> = {}): void {
  updateExecutionState({
    ...updates,
    lastCompletedStep: stepName,
  });
}

export function recordStepFailure(stepName: string, error: Error | string): void {
  updateExecutionState({
    failedStep: stepName,
    failureError: typeof error === 'string' ? error : error.message,
    isCompleted: false,
  });
}

export function saveExecutionState(): void {
  if (!currentState) return;
  if (!fs.existsSync(STATE_FILE_DIR)) {
    fs.mkdirSync(STATE_FILE_DIR, { recursive: true });
  }
  fs.writeFileSync(STATE_FILE, JSON.stringify(currentState, null, 2), 'utf8');
}

export function formatFinalReport(state: ExecutionState): string {
  const lines = [
    '========================================================================',
    '  STICKORA STORE + PAYTM — WORKFLOW EXECUTION REPORT',
    '========================================================================',
    `- Browser opened: ${state.browserOpened ? 'PASS' : 'FAIL'}`,
    `- Product added: ${state.productAdded ? 'PASS' : 'FAIL'}`,
    `- Checkout completed: ${state.checkoutCompleted ? 'PASS' : 'FAIL'}`,
    `- Order ID: ${state.orderId || 'None'}`,
    `- Paytm transaction ID: ${state.transactionId || 'None'}`,
    `- Paytm checkout opened: ${state.paytmCheckoutOpened ? 'PASS' : 'FAIL'}`,
    `- Payment verification: ${state.paymentVerified ? 'PASS' : 'FAIL'}`,
    `- Final payment status: ${state.paymentStatus || (state.failedStep ? 'FAILED' : 'PENDING')}`,
    `- Failure step, if any: ${state.failedStep || 'None'}`,
    '========================================================================',
  ];
  return lines.join('\n');
}
