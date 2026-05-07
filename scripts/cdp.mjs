#!/usr/bin/env node
/**
 * CDP helper for interacting with the Electron renderer.
 * Usage:
 *   node scripts/cdp.mjs eval 'document.body.innerText'
 *   node scripts/cdp.mjs snapshot
 *   node scripts/cdp.mjs capture /tmp/pigi.png
 *   node scripts/cdp.mjs console [seconds]
 *   node scripts/cdp.mjs type <text>
 */
import http from 'node:http';
import fs from 'node:fs';
// Node 22+ has built-in WebSocket (global)

const CDP_PORT = 9222;

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve(JSON.parse(data)));
      })
      .on('error', reject);
  });
}

/**
 * Creates a persistent CDP connection via browser endpoint with target attachment.
 * This works reliably in newer Electron/Chrome versions.
 */
async function createCdpSession() {
  const version = await httpGet(`http://127.0.0.1:${CDP_PORT}/json/version`);
  const browserWsUrl = version.webSocketDebuggerUrl;
  const targets = await httpGet(`http://127.0.0.1:${CDP_PORT}/json/list`);
  const page = targets.find((p) => p.type === 'page' && !p.url.startsWith('devtools://'));
  if (!page) throw new Error('No page target found');

  const ws = new WebSocket(browserWsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
    setTimeout(() => reject(new Error('ws connect timeout')), 5000);
  });

  let nextId = 1;
  const pending = new Map();
  const eventHandlers = [];

  ws.addEventListener('message', (evt) => {
    const msg = JSON.parse(evt.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    } else {
      for (const handler of eventHandlers) handler(msg);
    }
  });

  function send(method, params = {}, sessionId = undefined) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 30000);
      pending.set(id, {
        resolve: (r) => {
          clearTimeout(timer);
          resolve(r);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      const msg = { id, method, params };
      if (sessionId) msg.sessionId = sessionId;
      ws.send(JSON.stringify(msg));
    });
  }

  // Attach to page target with flattened session
  const { sessionId } = await send('Target.attachToTarget', {
    targetId: page.id,
    flatten: true,
  });

  // Enable Runtime domain
  await send('Runtime.enable', {}, sessionId);

  return {
    call: (method, params = {}) => send(method, params, sessionId),
    onEvent: (handler) => eventHandlers.push(handler),
    close: () => ws.close(),
  };
}

const [cmd, ...args] = process.argv.slice(2);

try {
  if (cmd === 'eval') {
    const session = await createCdpSession();
    const expr = args.join(' ');
    const result = await session.call('Runtime.evaluate', {
      expression: expr,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      console.error(
        'Error:',
        result.exceptionDetails.text || result.exceptionDetails.exception?.description,
      );
      process.exit(1);
    }
    const val = result.result.value;
    console.log(typeof val === 'string' ? val : JSON.stringify(val, null, 2));
    session.close();
  } else if (cmd === 'snapshot') {
    const session = await createCdpSession();
    const result = await session.call('Runtime.evaluate', {
      expression: 'document.body.innerText',
      returnByValue: true,
    });
    console.log(result.result.value);
    session.close();
  } else if (cmd === 'capture') {
    const session = await createCdpSession();
    const path = args[0] || '/tmp/pigi-capture.png';
    const result = await session.call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path, Buffer.from(result.data, 'base64'));
    console.log(`Saved to ${path}`);
    session.close();
  } else if (cmd === 'console') {
    const session = await createCdpSession();
    const messages = [];
    session.onEvent((msg) => {
      if (msg.method === 'Runtime.consoleAPICalled') {
        const text = msg.params.args
          .map((a) => a.value || a.description || JSON.stringify(a))
          .join(' ');
        messages.push(`[${msg.params.type}] ${text}`);
      }
    });
    const seconds = parseInt(args[0]) || 3;
    await new Promise((r) => setTimeout(r, seconds * 1000));
    session.close();
    console.log(messages.join('\n') || '(no console messages)');
  } else if (cmd === 'type') {
    const session = await createCdpSession();
    const text = args.join(' ');

    // Click textarea
    const loc = await session.call('Runtime.evaluate', {
      expression: `(() => {
        const el = document.querySelector('textarea');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      })()`,
      returnByValue: true,
    });
    if (!loc.result.value) {
      console.error('No textarea found');
      process.exit(1);
    }
    const { x, y } = loc.result.value;

    await session.call('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });
    await session.call('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });
    await new Promise((r) => setTimeout(r, 100));

    for (const ch of text) {
      await session.call('Input.dispatchKeyEvent', {
        type: 'keyDown',
        text: ch,
        key: ch,
        unmodifiedText: ch,
      });
      await session.call('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
    }
    await new Promise((r) => setTimeout(r, 100));

    await session.call('Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    });
    await session.call('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    });
    console.log(`Typed and sent: "${text}"`);
    session.close();
  } else {
    console.log(
      'Usage: cdp.mjs eval <expr> | snapshot | capture [path] | console [seconds] | type <text>',
    );
  }
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

process.exit(0);
