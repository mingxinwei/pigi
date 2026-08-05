---
name: pigi-jitter-debug
description: Measure and debug visible jitter / vibration / flicker in the renderer at the true paint level (scroll pinning, auto-scroll follow, animation stability). Use when the user reports the message list or any scrolling/animated UI "抖", "抖动", "跳", "闪烁", "jitter", "vibration", or "flicker" — especially issues that only appear during fast streaming. Builds on pigi-debug for the CDP setup.
---

# pigi Jitter Debug

Measuring what the user actually sees is the hard part: most JS sampling points
do NOT observe the painted frame. This skill covers the reliable method, the
traps, and a ready-made repro.

## Core Knowledge: who runs when in a frame

Chromium's per-frame order (simplified):

1. Tasks (IPC handlers, React commits scheduled from them, timers)
2. `requestAnimationFrame` callbacks
3. Style recalc + layout
4. ResizeObserver callbacks ← last JS point before paint
5. Paint

Consequences:

- **A `useLayoutEffect` keyed on virtualizer state is one frame late for
  content growth.** The streaming commit grows row DOM immediately, but the
  virtualizer only learns the new size from its own ResizeObserver, so a pin
  keyed on `totalSize` fires in a re-render that happens _after_ the growth
  frame already painted unpinned. This caused the message-list vibration fixed
  in `MessageList.tsx` (pin now runs inside a ResizeObserver callback observing
  the rows wrapper — step 4, same frame as the growth).
- TanStack Virtual's built-in `shouldAdjustScrollPositionOnItemSizeChange`
  correction also runs in step 4 (right timing) but targets the virtualizer's
  own gapless coordinate model (row gaps are CSS margins, invisible to
  measurements), so it never hits the true bottom. Keep it disabled
  (`() => false`) when pinning to the real DOM `scrollHeight`.

## Trap 1: rAF probes read pre-render state

rAF runs at step 2; pins run at step 4. A rAF loop sampling
`scrollHeight - scrollTop - clientHeight` records the transient _before_ the
pin of the same frame — it shows oscillation on BOTH broken and fixed builds.
Useless for verdicts.

## Trap 2: `Page.captureScreenshot` perturbs timing

Looping `captureScreenshot` forces a fresh BeginFrame each time, giving
post-paint tasks (React re-render + late pin) time to complete before the next
capture. Every capture looks pinned even on a build that visibly vibrates at
vsync rate. Do not use it to judge jitter. (`Page.startScreencast` does not
reliably deliver frames in this Electron setup either — it sends frame 1 and
goes quiet.)

## The reliable method: painted-state ResizeObserver probe

RO callbacks execute in registration order within step 4. A probe observer
registered AFTER the app's own observers (which were created at mount) runs
after the app's pin, and nothing scroll-relevant runs between step 4 and
paint — so the value it reads **is** what gets painted.

`scripts/paintedStateProbe.js` (install via
`node scripts/cdp.mjs eval "$(cat .pi/skills/pigi-jitter-debug/scripts/paintedStateProbe.js)"`):

- Observes the message-list rows wrapper.
- On every content resize, records `d = scrollHeight - scrollTop - clientHeight`
  (distance from bottom) and a timestamp into `window.__painted`.
- Interpretation while pinned to the bottom and streaming:
  - `d > 2` samples = frames painted off-bottom (visible jump).
  - `|d| <= 0.5` = sub-pixel rounding, fine.

Read results:

```bash
node scripts/cdp.mjs eval '(() => {
  const p = window.__painted;
  const bad = p.filter(e => e.d > 2);
  return JSON.stringify({total: p.length, paintedUnpinned: bad.length,
    max: Math.max(...p.map(e => e.d)), sample: p.slice(10, 30)});
})()'
```

For a non-message-list target, adapt the two selectors at the top of the probe.

## Standard repro (fast streaming)

1. Start dev per pigi-debug (`pkill -9 -f Electron; nohup npm run dev > /tmp/pigi-dev.log 2>&1 &`).
2. Open a project, new chat, pick a FAST model (DeepSeek V4 Flash).
3. Install the painted-state probe (above).
4. Send a long pure-text prompt (no tool calls, forces sustained streaming).
   Output is markdown-rendered, where single newlines collapse into one
   paragraph — ask for a blank line between lines so every poem line becomes
   its own block and each delta visibly grows the row height:

   `不要用任何工具，直接输出：写一首 400 行的长诗，每行以行号开头，每两行之间空一行（markdown 段落），主题是 <topic>，不要输出任何其他解释文字。`

5. Wait for completion, read `window.__painted`.

Baseline numbers from the message-list pin fix (2026-07):

- Broken build (`fe40745`): 82/88 samples ~22.5px off (one line behind, every growth frame).
- Fixed build: 0/87 samples off, max 0.5px.

## Always run a control

Probe trust comes from discrimination: run the same repro on the broken code
(`git stash` the fix, restart dev — renderer state changes need a restart,
HMR does not re-run unchanged-signature effects) and confirm the probe flags
it, then `git stash pop` and confirm it passes. One clean + one dirty run
validates both the fix and the probe.

## Secondary tool: frame shift analysis

When you need per-frame content movement (e.g. verifying smoothness rather
than pinned-ness), `scripts/shotLoop.mjs` captures composited frames as fast
as CDP allows (~6-8fps), and `scripts/shiftMatch.mjs` template-matches a
viewport strip between consecutive frames: monotonic cumulative shift = no
vibration; ±line-height zigzag = vibration. Caveat: capture perturbs timing
(trap 2) — a monotonic result does NOT prove absence of vsync-rate jitter, but
a zigzag DOES prove presence. Usage:

```bash
node .pi/skills/pigi-jitter-debug/scripts/shotLoop.mjs <seconds> /tmp/shots
# convert to 640-wide BMPs (macOS sips), then analyze:
for f in /tmp/shots/shot-*.jpg; do
  n=$(basename "$f" .jpg | sed 's/shot-//')
  sips -s format bmp -Z 640 "$f" --out "/tmp/shots-bmp/$n.bmp" > /dev/null 2>&1
done
node .pi/skills/pigi-jitter-debug/scripts/shiftMatch.mjs /tmp/shots-bmp <count> [rectJson]
```

`scripts/frameServer.mjs` serves captured frames with CORS headers if you
prefer analyzing them in-page via canvas.
