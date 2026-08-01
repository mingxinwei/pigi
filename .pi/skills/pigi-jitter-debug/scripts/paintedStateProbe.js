/**
 * Painted-state probe for the message list. Install with:
 *   node scripts/cdp.mjs eval "$(cat .pi/skills/pigi-jitter-debug/scripts/paintedStateProbe.js)"
 *
 * Why this works: ResizeObserver callbacks run in registration order after
 * layout, before paint. The app's own observers were registered at mount, so
 * this probe runs after the app's bottom pin — the recorded value is what the
 * frame actually paints.
 *
 * Results land in window.__painted as {t, d} entries where d is the distance
 * in px from the scroll bottom at paint time (d > 2 = visibly off-bottom).
 */
(() => {
  const container = document.querySelector('[data-testid=message-list]');
  if (!container) return 'no message list';
  const wrapper = container.querySelector('[data-testid=message-virtualizer] > div');
  if (!wrapper) return 'no rows wrapper';
  window.__painted = [];
  const ro = new ResizeObserver(() => {
    const d = container.scrollHeight - container.scrollTop - container.clientHeight;
    window.__painted.push({ t: Math.round(performance.now()), d: Math.round(d * 10) / 10 });
  });
  ro.observe(wrapper);
  window.__paintedRo = ro; // keep a reference; call .disconnect() to stop
  return 'painted-state probe installed';
})();
