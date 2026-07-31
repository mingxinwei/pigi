#!/usr/bin/env node
/** Rapidly capture composited frames via Page.captureScreenshot for N seconds. */
import http from 'node:http';
import fs from 'node:fs';

const CDP_PORT = 9222;
const seconds = parseInt(process.argv[2] || '15', 10);
const outDir = process.argv[3] || '/tmp/pigi-shots';

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

const version = await httpGet(`http://127.0.0.1:${CDP_PORT}/json/version`);
const targets = await httpGet(`http://127.0.0.1:${CDP_PORT}/json/list`);
const page = targets.find((p) => p.type === 'page' && !p.url.startsWith('devtools://'));
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve);
  ws.addEventListener('error', reject);
});

let nextId = 1;
const pending = new Map();
let sid;
ws.addEventListener('message', (evt) => {
  const msg = JSON.parse(evt.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg.result ?? msg.error);
    pending.delete(msg.id);
  }
});
function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params, sessionId: sid }));
  });
}

sid = (await send('Target.attachToTarget', { targetId: page.id, flatten: true })).sessionId;
if (!sid) throw new Error('attach failed: ' + JSON.stringify(sid));
await send('Page.enable');

fs.mkdirSync(outDir, { recursive: true });
const end = Date.now() + seconds * 1000;
let count = 0;
while (Date.now() < end) {
  const result = await send('Page.captureScreenshot', { format: 'jpeg', quality: 60 });
  if (result?.data) {
    fs.writeFileSync(
      `${outDir}/shot-${String(count).padStart(4, '0')}.jpg`,
      Buffer.from(result.data, 'base64'),
    );
    count++;
  }
}
console.log(`captured ${count} shots to ${outDir}`);
ws.close();
process.exit(0);
