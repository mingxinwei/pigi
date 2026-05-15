import type { ShortcutBinding, ShortcutDefinition } from '../../../shared/ipcContract';
import { SHORTCUT_DEFAULTS } from '../../../shared/shortcutDefaults';

/**
 * Resolve the effective binding for each shortcut, preferring a persisted
 * override from the main process store when available.
 */
export function resolveShortcutBindings(
  persisted: ShortcutDefinition[],
): Map<string, ShortcutBinding> {
  const overrideMap = new Map(persisted.map((s) => [s.id, s.binding]));
  const result = new Map<string, ShortcutBinding>();
  for (const entry of SHORTCUT_DEFAULTS) {
    result.set(entry.id, overrideMap.get(entry.id) ?? entry.defaultBinding);
  }
  return result;
}
