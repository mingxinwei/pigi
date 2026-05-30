---
name: pigi-debug
description: Start dev server, debug via CDP, take screenshots. Use when starting the app, debugging UI, running smoke checks, or needing to inspect renderer state.
---

# pigi Debug

## Start Dev

Kill all existing Electron processes and start fresh. **Stop here** — do NOT wait or verify unless explicitly asked.

```bash
pkill -9 -f Electron || true
nohup npm run dev > /tmp/pigi-dev.log 2>&1 &
```

## Verify App

Only when explicitly instructed. Wait ~5s after dev start, then:

```bash
node scripts/cdp.mjs eval 'document.querySelector("textarea") ? "ready" : "not ready"'
```

## CDP Commands

Port 9222 is enabled in dev mode.

```bash
node scripts/cdp.mjs list                        # list targets
node scripts/cdp.mjs eval '<js expression>'      # execute JS in renderer
node scripts/cdp.mjs type "hello world"          # type into focused input
node scripts/cdp.mjs screenshot /tmp/pigi.png    # capture screenshot
node scripts/cdp.mjs console-errors              # check for errors
node scripts/cdp.mjs ax-snapshot /tmp/ax.json    # accessibility tree
```

## Useful Eval Snippets

```js
// Check DOM element heights
document.querySelectorAll('[data-testid^=tool-block]').length(
  // Scroll state
  () => {
    const el = document.querySelector('[data-testid="transcript-viewport"]');
    if (!el) return null;
    return {
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    };
  },
)()(
  // Find elements by text content
  () => {
    const results = [];
    for (const el of document.querySelectorAll('*')) {
      if (el.children.length === 0 && el.textContent?.includes('SEARCH')) {
        results.push({
          tag: el.tagName,
          class: el.className.substring(0, 80),
          text: el.textContent.trim().substring(0, 60),
        });
      }
    }
    return JSON.stringify(results.slice(0, 10), null, 2);
  },
)();
```

## HMR Limitations

- UI components (ToolBlock, DiffView, etc.) hot-reload fine
- `transcriptController.ts` state changes require full restart
- `preload/index.ts` changes require full restart

## Smoke Check

```bash
node scripts/cdp.mjs console-errors
node scripts/cdp.mjs screenshot /tmp/pigi-smoke.png
```
