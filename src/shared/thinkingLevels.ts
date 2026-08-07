import type { ThinkingLevel } from './ipcContract';

/** Canonical thinking-level order, mirrors pi-ai's EXTENDED_THINKING_LEVELS. */
const THINKING_LEVEL_ORDER: ThinkingLevel[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];

/**
 * Clamp a thinking level to the levels a model actually supports, mirroring
 * the SDK's clampThinkingLevel semantics (nearest available level, searching
 * upward first, then downward). Used when the remembered level came from a
 * different model, so the picker never displays a level the current model
 * does not have.
 */
export function clampThinkingLevelTo(
  level: ThinkingLevel,
  available: ThinkingLevel[],
): ThinkingLevel {
  if (available.includes(level)) {
    return level;
  }
  const requestedIndex = THINKING_LEVEL_ORDER.indexOf(level);
  if (requestedIndex !== -1) {
    for (let i = requestedIndex; i < THINKING_LEVEL_ORDER.length; i++) {
      const candidate = THINKING_LEVEL_ORDER[i];
      if (available.includes(candidate)) {
        return candidate;
      }
    }
    for (let i = requestedIndex - 1; i >= 0; i--) {
      const candidate = THINKING_LEVEL_ORDER[i];
      if (available.includes(candidate)) {
        return candidate;
      }
    }
  }
  return available[0] ?? 'off';
}
