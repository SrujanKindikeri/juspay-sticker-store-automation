import http from 'http';
import fs from 'fs';
import path from 'path';

const ARTIFACT_DIR = 'C:\\Users\\kindi\\.gemini\\antigravity\\brain\\87694b98-e97d-499e-a0fa-c843465b4bf9';

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

async function run() {
  const targets = await getJson('http://127.0.0.1:9224/json');
  const pageTarget = targets.find(t => t.type === 'page' && t.url.includes('3001'));
  if (!pageTarget) throw new Error('Target page not found: ' + JSON.stringify(targets));

  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  let id = 1;
  const pending = new Map();

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(msg.error);
      else resolve(msg.result);
    }
  };

  await new Promise(r => ws.onopen = r);

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const msgId = id++;
      pending.set(msgId, { resolve, reject });
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }

  async function evalCode(expression) {
    const res = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    return res.result ? res.result.value : null;
  }

  async function takeScreenshot(fileName) {
    const res = await send('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(res.data, 'base64');
    fs.writeFileSync(path.join(ARTIFACT_DIR, fileName), buffer);
    console.log(`Saved screenshot: ${fileName}`);
  }

  console.log('=== TEST 1: Verification of Validation Error Display ===');
  // Clear card number
  await evalCode(`
    (() => {
      const input = document.querySelector('[data-testid="input-card-number"]');
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeSetter.call(input, '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()
  `);
  await new Promise(r => setTimeout(r, 200));

  // Click Continue
  await evalCode(`document.querySelector('[data-testid="continue-payment-button"]')?.click()`);
  await new Promise(r => setTimeout(r, 400));

  const errorVisible = await evalCode(`Boolean(document.querySelector('[data-testid="payment-error"]'))`);
  const errorText = await evalCode(`document.querySelector('[data-testid="payment-error"]')?.innerText`);
  console.log('Payment error displayed:', errorVisible);
  console.log('Error text:', errorText);

  if (!errorVisible) {
    throw new Error('Validation error box did not appear!');
  }

  console.log('\n=== TEST 2: Successful Payment Initiation Submission ===');
  // Click autofill to populate valid card data
  await evalCode(`document.querySelector('[data-testid="autofill-card-btn"]')?.click()`);
  await new Promise(r => setTimeout(r, 300));

  // Submit form
  await evalCode(`document.querySelector('[data-testid="continue-payment-button"]')?.click()`);
  
  // Check loading indicator appears
  const loadingDuringRequest = await evalCode(`Boolean(document.querySelector('[data-testid="payment-loading-indicator"]'))`);
  console.log('Loading indicator active during request:', loadingDuringRequest);

  // Wait for API response and UI transition
  await new Promise(r => setTimeout(r, 1200));

  const pendingStatus = await evalCode(`document.querySelector('[data-testid="pending-payment-status"]')?.innerText`);
  const paymentRef = await evalCode(`document.querySelector('[data-testid="transaction-reference"]')?.innerText`);
  console.log('Pending status element text:', pendingStatus);
  console.log('Generated payment reference:', paymentRef);

  if (!pendingStatus || !paymentRef) {
    throw new Error('Pending status or payment reference not displayed!');
  }

  // Save screenshot of Phase 3 pending confirmation state
  await takeScreenshot('checkout_phase3_pending.png');

  ws.close();
  console.log('\n=== PHASE 3 FRONTEND E2E TEST PASSED ===');
  console.log(JSON.stringify({ paymentReference: paymentRef, status: pendingStatus }));
}

run().catch(err => {
  console.error('E2E Test Failed:', err);
  process.exit(1);
});
