/**
 * Selectable app accent colors.
 *
 * The accent drives links, search highlights, the message mini-map's active
 * state, and focus rings (exposed to CSS as `--system-accent`). Each entry
 * carries a picker swatch (`hex`) plus oklch values tuned per theme: light-mode
 * values stay dark enough to read as link text on a white background, while
 * dark-mode values are lifted so they stay legible on a dark background.
 *
 * This array is the single source of truth for the (upcoming) settings-page
 * accent picker; `applyThemeAccent` wires a choice into the DOM.
 */
export interface ThemeAccent {
  /** Stable identifier persisted with the user's choice. */
  id: string;
  /** Human-readable label for the picker. */
  name: string;
  /** Swatch color shown in the picker. */
  hex: string;
  /** Accent oklch tuned for light mode. */
  lightOklch: string;
  /** Accent oklch tuned for dark mode. */
  darkOklch: string;
}

export const THEME_ACCENTS: readonly ThemeAccent[] = [
  {
    id: 'indigo',
    name: 'Indigo',
    hex: '#6366f1',
    lightOklch: 'oklch(0.55 0.2 277.1)',
    darkOklch: 'oklch(0.7 0.17 277.1)',
  },
  {
    id: 'violet',
    name: 'Violet',
    hex: '#7c5cfc',
    lightOklch: 'oklch(0.56 0.22 286.5)',
    darkOklch: 'oklch(0.72 0.19 286.5)',
  },
  {
    id: 'blue',
    name: 'Blue',
    hex: '#3b82f6',
    lightOklch: 'oklch(0.55 0.18 259.8)',
    darkOklch: 'oklch(0.7 0.16 259.8)',
  },
  {
    id: 'sky',
    name: 'Sky',
    hex: '#0ea5e9',
    lightOklch: 'oklch(0.55 0.15 237.3)',
    darkOklch: 'oklch(0.72 0.13 237.3)',
  },
  {
    id: 'teal',
    name: 'Teal',
    hex: '#14b8a6',
    lightOklch: 'oklch(0.54 0.12 182.5)',
    darkOklch: 'oklch(0.74 0.12 182.5)',
  },
  {
    id: 'emerald',
    name: 'Emerald',
    hex: '#10b981',
    lightOklch: 'oklch(0.53 0.15 162.5)',
    darkOklch: 'oklch(0.74 0.14 162.5)',
  },
  {
    id: 'amber',
    name: 'Amber',
    hex: '#e0724a',
    lightOklch: 'oklch(0.57 0.15 40.2)',
    darkOklch: 'oklch(0.74 0.13 40.2)',
  },
  {
    id: 'rose',
    name: 'Rose',
    hex: '#f43f5e',
    lightOklch: 'oklch(0.58 0.21 16.4)',
    darkOklch: 'oklch(0.7 0.19 16.4)',
  },
];

/** Accent applied when the user has not chosen one. */
export const DEFAULT_THEME_ACCENT_ID = 'indigo';

/** Look up an accent by id, falling back to the default. */
export function findThemeAccent(id: string): ThemeAccent {
  return THEME_ACCENTS.find((accent) => accent.id === id) ?? THEME_ACCENTS[0];
}

/**
 * Publish an accent to the DOM. CSS maps `--system-accent` to `--accent-light`
 * in `:root` and `--accent-dark` under `.dark`, so setting both here keeps the
 * accent correct across theme switches without re-applying on toggle.
 */
export function applyThemeAccent(id: string): void {
  const accent = findThemeAccent(id);
  const root = document.documentElement;
  root.style.setProperty('--accent-light', accent.lightOklch);
  root.style.setProperty('--accent-dark', accent.darkOklch);
}
