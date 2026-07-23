---
name: pigi-ui-preview
description: Show the user a visual preview of a UI/design choice (color swatches, spacing options, skeleton states, side-by-side variants) by injecting a throwaway overlay into the running renderer and clip-screenshotting it. Use when comparing design options visually without reproducing the exact app state that renders them. Requires the dev app running with CDP (see pigi-debug).
---

# pigi UI Preview

Preview a design choice without reproducing the exact app state that renders it:
inject a throwaway overlay into the running renderer, screenshot just that
region, and read the PNG back so you (and the user) can judge and iterate.

Prerequisite: the dev app must be running with CDP on port 9222. See the
`pigi-debug` skill for starting the dev server and the `scripts/cdp.mjs` helper.

## Why it looks real

The overlay is injected into the actual running app, so it inherits the live
theme: CSS variables, Tailwind classes (`bg-muted`, `animate-pulse`,
`bg-green-500/15`, etc.). Replicate the target component's real class names and
the crop matches production.

It is still a hand-built mock, not the mounted component. For 100% fidelity,
trigger the real state instead of previewing.

## Workflow

1. Inject a `position:fixed` panel via `eval`, build it with the app's real
   Tailwind classes, append to `body`, and return its bounding rect.
2. Capture just that rect with `capture <path> <clipJson>` (scale defaults to 2
   for crisp high-DPI crops).
3. `read` the PNG to view it and iterate on the design.
4. Remove the overlay when done.

```bash
# 1. inject and get the rect (capture the printed JSON into a var)
RECT=$(node scripts/cdp.mjs eval '
(() => {
  document.getElementById("__preview")?.remove();
  const panel = document.createElement("div");
  panel.id = "__preview";
  panel.style.cssText = "position:fixed;top:60px;left:40px;z-index:99999;" +
    "display:flex;gap:16px;background:#fff;padding:16px;border:1px solid #ddd;border-radius:8px";
  // Use the app real classes so it matches production rendering:
  panel.innerHTML = `<div class="animate-pulse rounded-md bg-muted" style="width:200px;height:16px"></div>`;
  document.body.appendChild(panel);
  const r = panel.getBoundingClientRect();
  return JSON.stringify({ x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) });
})()' | tail -1)

# 2. clip screenshot of just the panel
node scripts/cdp.mjs capture /tmp/preview.png "$RECT"

# 4. clean up the overlay
node scripts/cdp.mjs eval 'document.getElementById("__preview")?.remove(); "cleaned"'
```

Then `read /tmp/preview.png`.

The clip rect accepts an optional `scale`
(`{"x":..,"y":..,"width":..,"height":..,"scale":2}`); it defaults to 2.

## Tips

- Lay variants out side by side in one panel (flex row) so a single screenshot
  shows all options for direct comparison.
- Simulate real adjacency: if two elements clash in the real layout (e.g. a diff
  above a status footer), stack them the same way in the preview.
- Keep the panel id stable (e.g. `__preview`) so re-running the inject step
  replaces the previous overlay instead of stacking duplicates.
