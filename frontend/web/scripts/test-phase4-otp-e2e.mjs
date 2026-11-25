import http from 'http';
import fs from 'fs';
import path from 'path';

// Artifact directory
const ARTIFACT_DIR = 'C:/Users/kindi/.gemini/antigravity/brain/87694b98-e97d-499e-a0fa-c843465b4bf9';

// Helper to make CDP HTTP requests
function sendJson(url, postData = null) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: postData ? 'POST' : 'GET',
      headers: postData ? { 'Content-Type': 'application/json' } : {},
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    });
    req.on('error', reject);
    if (postData) req.write(JSON.stringify(postData));
    req.end();
  });
}

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 1;
    this.callbacks = new Map();
  }

  async connect() {
    const { WebSocket } = await import('ws').catch(async () => {
      // In case ws is not installed globally or locally, we check node modules
      return import('puppeteer/node_modules/ws/index.js');
    }).catch(() => {
      // fallback to global or native if available
      return { default: globalThis.WebSocket };
    });

    const WS = globalThis.WebSocket;
    if (!WS) throw new Error("WebSocket client unavailable");

    return new Promise((resolve, reject) => {
      this.ws = new WS(this.wsUrl);
      this.ws.addEventListener('open', () => resolve());
      this.ws.addEventListener('error', (err) => reject(err));
      this.ws.addEventListener('message', (event) => {
        const raw = typeof event.data === 'string' ? event.data : event.data.toString();
        const parsed = JSON.parse(raw);
        if (parsed.id && this.callbacks.has(parsed.id)) {
          const { res, rej } = this.callbacks.get(parsed.id);
          this.callbacks.delete(parsed.id);
          if (parsed.error) rej(parsed.error);
          else res(parsed.result);
        }
      });
    });
  }

  send(method, params = {}) {
    return new Promise((res, rej) => {
      const id = this.id++;
      this.callbacks.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(`Eval error: ${JSON.stringify(result.exceptionDetails)}`);
    }
    return result.result?.value;
  }

  async captureScreenshot(filePath) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(filePath, Buffer.from(data, 'base64'));
    console.log(`Saved screenshot to ${filePath}`);
  }
}

async function run() {
  console.log("Starting Phase 4 E2E Test...");
  // Connect to Chrome on 9225
  const targets = await sendJson('http://127.0.0.1:9225/json');
  console.log(`Found ${targets.length} targets`);
  let pageTarget = targets.find(t => t.type === 'page' && !t.url.startsWith('devtools://'));
  if (!pageTarget) {
    const newTab = await sendJson('http://127.0.0.1:9225/json/new?http://localhost:3001');
    pageTarget = newTab;
  }

  const client = new CDPClient(pageTarget.webSocketDebuggerUrl);
  await client.connect();
  console.log("Connected to Chrome via CDP");

  await client.send('Page.enable');
  await client.send('DOM.enable');

  // Navigate to localhost:3001
  console.log("Navigating to http://localhost:3001...");
  await client.send('Page.navigate', { url: 'http://localhost:3001' });
  await new Promise(r => setTimeout(r, 2000));

  // Check title
  const pageTitle = await client.eval('document.title');
  console.log("Page title:", pageTitle);

  // 1. Fill card details and initiate payment
  console.log("Submitting payment initiation form...");
  await client.eval(`
    (() => {
      const setVal = (el, val) => {
        if (!el) return;
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (nativeSetter) {
          nativeSetter.call(el, val);
        } else {
          el.value = val;
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };

      const cardNum = document.querySelector('[data-testid="input-card-number"]');
      const cardExp = document.querySelector('[data-testid="input-card-expiry"]');
      const cardCvv = document.querySelector('[data-testid="input-card-cvv"]');
      const cardHolder = document.querySelector('[data-testid="input-card-holder"]');
      
      setVal(cardNum, '4111 2222 3333 4444');
      setVal(cardExp, '12/28');
      setVal(cardCvv, '123');
      setVal(cardHolder, 'DEMO CUSTOMER');
      
      const btn = document.querySelector('[data-testid="continue-payment-button"]');
      if (btn) btn.click();
    })()
  `);

  console.log("Waiting for transition to OTP verification page...");
  let otpPageFound = false;
  for (let i = 0; i < 20; i++) {
    const hasOtpPage = await client.eval(`Boolean(document.querySelector('[data-testid="otp-page"]'))`);
    if (hasOtpPage) {
      otpPageFound = true;
      break;
    }
    await new Promise(r => setTimeout(r, 500));
  }

  if (!otpPageFound) {
    throw new Error("Failed to transition to OTP verification screen!");
  }
  console.log("OTP Verification Page loaded successfully!");

  // Capture OTP Screen Screenshot
  const otpScreenShotPath = path.join(ARTIFACT_DIR, 'checkout_otp_screen.png');
  await client.captureScreenshot(otpScreenShotPath);

  // 2. Test Invalid OTP attempt
  console.log("Testing invalid OTP submission ('000000')...");
  await client.eval(`
    (() => {
      const setVal = (el, val) => {
        if (!el) return;
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (nativeSetter) {
          nativeSetter.call(el, val);
        } else {
          el.value = val;
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };

      const otpInput = document.querySelector('[data-testid="otp-input"]');
      setVal(otpInput, '000000');
      
      const verifyBtn = document.querySelector('[data-testid="verify-otp-button"]');
      if (verifyBtn) verifyBtn.click();
    })()
  `);

  await new Promise(r => setTimeout(r, 1000));
  const errorMessage = await client.eval(`
    document.querySelector('[data-testid="otp-error"]')?.textContent || ''
  `);
  console.log("Invalid OTP error displayed:", errorMessage);

  // 3. Test Valid OTP verification using simulated OTP autofill
  console.log("Autofilling valid simulated OTP...");
  const autofillSuccess = await client.eval(`
    (() => {
      const autofillBtn = document.querySelector('[data-testid="autofill-otp-button"]');
      if (autofillBtn) {
        autofillBtn.click();
        return true;
      }
      return false;
    })()
  `);
  console.log("Autofill button clicked:", autofillSuccess);

  await new Promise(r => setTimeout(r, 500));
  const enteredOtp = await client.eval(`document.querySelector('[data-testid="otp-input"]')?.value`);
  console.log("Autofilled OTP value:", enteredOtp);

  console.log("Submitting valid OTP for verification...");
  await client.eval(`
    (() => {
      const verifyBtn = document.querySelector('[data-testid="verify-otp-button"]');
      verifyBtn.click();
    })()
  `);

  console.log("Waiting for payment success result screen...");
  let successFound = false;
  for (let i = 0; i < 20; i++) {
    const hasSuccess = await client.eval(`Boolean(document.querySelector('[data-testid="payment-success"]'))`);
    if (hasSuccess) {
      successFound = true;
      break;
    }
    await new Promise(r => setTimeout(r, 500));
  }

  if (!successFound) {
    const currentError = await client.eval(`document.querySelector('[data-testid="otp-error"]')?.textContent || ''`);
    throw new Error(`Payment success screen did not appear. Error on page: ${currentError}`);
  }
  console.log("Payment SUCCESS screen rendered!");

  const txRef = await client.eval(`document.querySelector('[data-testid="transaction-reference"]')?.textContent || ''`);
  console.log("Payment Reference in UI:", txRef);

  // Capture Payment Success Screenshot
  const successScreenshotPath = path.join(ARTIFACT_DIR, 'checkout_payment_success.png');
  await client.captureScreenshot(successScreenshotPath);

  console.log("Phase 4 E2E Test completed successfully!");
  process.exit(0);
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
