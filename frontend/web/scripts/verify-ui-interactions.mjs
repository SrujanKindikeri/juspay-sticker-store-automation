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
  const targets = await getJson('http://127.0.0.1:9223/json');
  const pageTarget = targets.find(t => t.type === 'page' && t.url.includes('3001'));
  if (!pageTarget) throw new Error('Target page not found');

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

  // 1. Card Active
  await new Promise(r => setTimeout(r, 600));
  await takeScreenshot('checkout_card_active.png');

  // 2. UPI Active
  await evalCode(`document.querySelector('[data-testid="upi-method"]')?.click()`);
  await new Promise(r => setTimeout(r, 400));
  await takeScreenshot('checkout_upi_active.png');

  // 3. Net Banking Active
  await evalCode(`document.querySelector('[data-testid="netbanking-method"]')?.click()`);
  await new Promise(r => setTimeout(r, 400));
  await takeScreenshot('checkout_netbanking_active.png');

  // 4. Modal Open
  await evalCode(`document.querySelector('[data-testid="continue-payment-button"]')?.click()`);
  await new Promise(r => setTimeout(r, 400));
  await takeScreenshot('checkout_modal_active.png');

  ws.close();
}

run().catch(console.error);
