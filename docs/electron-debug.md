# Electron Debugging and UI Automation

Notes are based on Electron docs and Chrome DevTools Protocol docs queried through Context7.

This project should be easy to inspect while the agent is developing it. Use three layers:

1. **Electron main process debugging** for SDK/runtime/IPC issues.
2. **Renderer debugging via Chrome DevTools Protocol (CDP)** for UI state, screenshots, snapshots, JS execution, and console errors.
3. **Automation smoke checks** for repeatable prompt/session/tool UI verification.

## Current Setup

`src/main/index.ts` already enables a dev CDP endpoint:

```ts
if (is.dev) {
  app.commandLine.appendSwitch('remote-debugging-port', '9222')
}
```

When `pnpm run dev` is running, the renderer should be discoverable at:

```bash
curl http://127.0.0.1:9222/json/list
```

Use this as the primary renderer-debug entry point.

## Documentation References

Context7 lookups used:

- Electron: `/electron/electron`
  - main process debugging uses `--inspect` / `--inspect-brk`, default inspector port `9229`
  - renderer debugging can use `--remote-debugging-port=9222`
  - `webContents.openDevTools()` opens renderer DevTools
  - `webContents.debugger` can attach to a renderer and send CDP commands
- Chrome DevTools Protocol: `/chromedevtools/devtools-protocol`
  - `Runtime.evaluate` executes JS in the page context
  - `Page.captureScreenshot` captures PNG/JPEG screenshots
  - `Accessibility.getFullAXTree` can provide accessibility snapshots
  - `Performance.getMetrics` and tracing help investigate jank
## Recommended Debug Channels

### 1. Renderer: Chrome DevTools / CDP

Use for:

- screenshots
- accessibility/text snapshots
- executing JS in the renderer
- checking DOM state
- checking console errors
- inspecting network requests if needed
- performance traces

Preferred workflow:

```bash
pnpm run dev
curl http://127.0.0.1:9222/json/list
```

Then attach using one of:

- Chrome DevTools: open the listed `devtoolsFrontendUrl`
- direct CDP script/client for automation

### 2. Renderer Alternative: Electron `webContents.debugger`

Electron exposes `webContents.debugger`, which can attach directly to a renderer and send Chrome DevTools Protocol commands from the main process.

Use it sparingly for built-in diagnostics or debug commands. For agent-driven development, direct external CDP is usually cleaner because it does not require app code changes.

Example from Electron docs:

```ts
try {
  win.webContents.debugger.attach('1.1')
  await win.webContents.debugger.sendCommand('Network.enable')
} catch (err) {
  console.error('Debugger attach failed', err)
}
```

Do not attach `webContents.debugger` at the same time as normal DevTools/CDP unless needed; debugger clients can interfere with each other.

### 3. Main Process: Node Inspector

Use for:

- SDK runtime initialization
- IPC handlers
- Agent Host bridge
- session switching
- process lifecycle

Recommended future script:

```json
{
  "dev:inspect": "electron-vite dev -- --inspect=9229"
}
```

If `electron-vite` does not pass the flag correctly, use the equivalent Electron launch flag in its supported format. Keep renderer CDP on `9222` and main inspector on `9229`.

### 4. Agent Host Debugging

When pi SDK moves to `utilityProcess`/worker:

- log Agent Host lifecycle events clearly
- include host pid in logs
- expose `agent_host_ready` / `agent_host_error`
- add a restart path only after the basic host is stable
- keep stream/control protocol inspectable

## Direct CDP Automation

Direct CDP is the standard automation path for this Electron app because Electron's renderer is a Chromium target when `--remote-debugging-port=9222` is enabled.

A small direct CDP helper is useful because it does not depend on Chrome, browser extensions, or MCP target discovery.

Suggested future script:

```text
scripts/cdp.mjs
```

Capabilities to implement:

```bash
node scripts/cdp.mjs list
node scripts/cdp.mjs screenshot /tmp/pigi.png
node scripts/cdp.mjs eval 'document.body.innerText'
node scripts/cdp.mjs console-errors
node scripts/cdp.mjs ax-snapshot /tmp/pigi-ax.json
```

Implementation approach:

- fetch `http://127.0.0.1:9222/json/list`
- pick the Electron renderer target
- connect to its `webSocketDebuggerUrl`
- use CDP domains:
  - `Runtime.evaluate` for JS execution
  - `Page.captureScreenshot` for screenshots
  - `Log.enable` / `Runtime.consoleAPICalled` for console diagnostics
  - `Accessibility.getFullAXTree` for agent-readable snapshots
  - `Performance.getMetrics` for lightweight metrics
  - tracing APIs for deeper performance investigations

Potential lightweight dependency:

```bash
pnpm add -D chrome-remote-interface
```

Do this only if the direct script is needed often.

## Screenshots and Snapshots

Recommended files:

```text
/tmp/pigi-screenshot.png
/tmp/pigi-full.png
/tmp/pigi-ax.json
/tmp/pigi-dom.txt
/tmp/pigi-console.json
```

Use screenshots for visual regressions. Use accessibility snapshots/DOM text for agent-readable state.

Minimum useful debug bundle:

```text
screenshot
accessibility snapshot
console errors
current URL/title
runtime state from window/api if safe
```

## JS Evaluation Helpers

Useful renderer snippets:

```js
// title
() => document.title

// visible text
() => document.body.innerText

// app dimensions
() => ({ width: window.innerWidth, height: window.innerHeight })

// console-safe app state if exposed later
() => window.__PIGI_DEBUG__?.getState?.()

// scroll info
() => {
  const el = document.querySelector('[data-testid="transcript-viewport"]')
  if (!el) return null
  return {
    scrollTop: el.scrollTop,
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }
}
```

Add stable `data-testid` attributes to important UI elements:

```text
data-testid="transcript-viewport"
data-testid="chat-input"
data-testid="send-button"
data-testid="abort-button"
data-testid="sidebar"
data-testid="status-bar"
data-testid="message-list"
data-testid="tool-block"
```

This makes direct CDP automation more reliable.

## Console and Error Policy

During development:

- renderer console errors should be treated as bugs
- main process errors should include context and operation name
- Agent Host errors should include session id/cwd when available
- IPC failures should return structured errors, not only log

Recommended error shape:

```ts
interface AppError {
  code: string
  message: string
  details?: unknown
}
```

## Performance Debugging

Use CDP performance traces when investigating jank. The direct CDP helper should eventually expose:

```bash
node scripts/cdp.mjs trace-start
# interact with app
node scripts/cdp.mjs trace-stop /tmp/pigi-trace.json.gz
```

Focus areas:

- token streaming causing React renders
- Markdown rendering of finalized messages
- Shiki/code highlighting
- virtualizer measurement churn
- large tool output expansion

## Recommended Smoke Automation

After starting `pnpm run dev`, verify:

1. Window loads.
2. Runtime ready appears.
3. Chat input exists.
4. No renderer console errors.
5. Prompt can be sent.
6. Streaming text appears.
7. Abort button appears during streaming.
8. Screenshot can be captured.

Direct CDP workflow:

```bash
node scripts/cdp.mjs list
node scripts/cdp.mjs ax-snapshot /tmp/pigi-ax.json
node scripts/cdp.mjs console-errors
node scripts/cdp.mjs screenshot /tmp/pigi-smoke.png
```

## Best Practices for This Project

- Keep renderer CDP enabled in dev only.
- Keep main inspector separate from renderer CDP ports.
- Prefer accessibility snapshots for agent-driven inspection.
- Add stable `data-testid` attributes before relying on automated clicking.
- Use MessagePort for streaming protocol tests; use normal IPC for command tests.
- Avoid using screenshots as the only assertion; pair them with snapshots/console checks.
- Keep debug helpers out of production builds or guard with `is.dev`.
