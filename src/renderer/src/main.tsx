import './assets/main.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { Toaster } from './components/ui/sonner';

/** Convert a hex color (e.g. '#007aff') to oklch format for CSS var (needed for Tailwind opacity modifiers). */
function hexToOklch(hex: string): string {
  const linearize = (c: number): number => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const r = linearize(parseInt(hex.slice(1, 3), 16));
  const g = linearize(parseInt(hex.slice(3, 5), 16));
  const b = linearize(parseInt(hex.slice(5, 7), 16));
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const C = Math.sqrt(A * A + B * B);
  const H = (Math.atan2(B, A) * 180) / Math.PI + (Math.atan2(B, A) < 0 ? 360 : 0);
  return `oklch(${L.toFixed(3)} ${C.toFixed(3)} ${H.toFixed(3)})`;
}

// Inject system accent color as CSS variable before first paint.
window.piApi
  .getAccentColor()
  .then((hex) => {
    if (hex) {
      document.documentElement.style.setProperty('--system-accent', hexToOklch(hex));
    }
  })
  .catch(() => {
    // Silently fall back to CSS defaults.
  });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <Toaster />
  </StrictMode>,
);
