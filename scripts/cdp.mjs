#!/usr/bin/env node
/**
 * CDP helper for interacting with the Electron renderer.
 * Usage:
 *   node scripts/cdp.mjs eval 'document.body.innerText'
 *   node scripts/cdp.mjs eval 'window.api.prompt("hello")'
 *   node scripts/cdp.mjs snapshot
 *   node scripts/cdp.mjs capture /tmp/pigi.png
 */
import http from 'node:http'
// Node 22+ has built-in WebSocket

const CDP_PORT = 9222

async function getWsUrl() {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${CDP_PORT}/json`, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => {
        const pages = JSON.parse(data)
        const page = pages.find((p) => p.type === 'page')
        if (!page) reject(new Error('No page found'))
        else resolve(page.webSocketDebuggerUrl)
      })
    }).on('error', reject)
  })
}

async function cdpCall(method, params = {}) {
  const wsUrl = await getWsUrl()
  const ws = new WebSocket(wsUrl)

  return new Promise((resolve, reject) => {
    const id = 1
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ id, method, params }))
    })
    ws.addEventListener('message', (evt) => {
      const data = JSON.parse(evt.data)
      if (data.id === id) {
        ws.close()
        if (data.error) reject(new Error(JSON.stringify(data.error)))
        else resolve(data.result)
      }
    })
    ws.addEventListener('error', (e) => reject(e))
    setTimeout(() => { ws.close(); reject(new Error('timeout')) }, 30000)
  })
}

const [cmd, ...args] = process.argv.slice(2)

if (cmd === 'eval') {
  const expr = args.join(' ')
  const result = await cdpCall('Runtime.evaluate', {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.exceptionDetails) {
    console.error('Error:', result.exceptionDetails.text)
    process.exit(1)
  }
  const val = result.result.value
  console.log(typeof val === 'string' ? val : JSON.stringify(val, null, 2))
} else if (cmd === 'snapshot') {
  const result = await cdpCall('Runtime.evaluate', {
    expression: 'document.body.innerText',
    returnByValue: true,
  })
  console.log(result.result.value)
} else if (cmd === 'capture') {
  const path = args[0] || '/tmp/pigi-capture.png'
  const result = await cdpCall('Page.captureScreenshot', { format: 'png' })
  const fs = await import('node:fs')
  fs.writeFileSync(path, Buffer.from(result.data, 'base64'))
  console.log(`Saved to ${path}`)
} else if (cmd === 'console') {
  // Enable console, collect messages for a bit
  const wsUrl = await getWsUrl()
  const ws = new WebSocket(wsUrl)
  let id = 1
  const messages = []
  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({ id: id++, method: 'Runtime.enable' }))
    ws.send(JSON.stringify({ id: id++, method: 'Log.enable' }))
  })
  ws.addEventListener('message', (evt) => {
    const data = JSON.parse(evt.data)
    if (data.method === 'Runtime.consoleAPICalled') {
      const text = data.params.args.map(a => a.value || a.description || JSON.stringify(a)).join(' ')
      messages.push(`[${data.params.type}] ${text}`)
    }
  })
  const seconds = parseInt(args[0]) || 3
  await new Promise(r => setTimeout(r, seconds * 1000))
  ws.close()
  console.log(messages.join('\n') || '(no console messages)')
} else if (cmd === 'type') {
  // Simulate real user: click textarea, type char by char, press Enter
  const text = args.join(' ')

  // 1. Click the textarea to focus it (get its coordinates)
  const loc = await cdpCall('Runtime.evaluate', {
    expression: `(() => {
      const el = document.querySelector('textarea');
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`,
    returnByValue: true,
  })
  const { x, y } = loc.result.value

  // Mouse click
  await cdpCall('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await cdpCall('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  await new Promise(r => setTimeout(r, 100))

  // 2. Type each character
  for (const ch of text) {
    await cdpCall('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch, unmodifiedText: ch })
    await cdpCall('Input.dispatchKeyEvent', { type: 'keyUp', key: ch })
  }
  await new Promise(r => setTimeout(r, 100))

  // 3. Press Enter to send
  await cdpCall('Input.dispatchKeyEvent', {
    type: 'rawKeyDown', key: 'Enter', code: 'Enter',
    windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
  })
  await cdpCall('Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'Enter', code: 'Enter',
    windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
  })
  console.log(`Typed and sent: "${text}"`)
} else {
  console.log('Usage: cdp.mjs eval <expr> | snapshot | capture [path]')
}
