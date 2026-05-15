import { useEffect, useState } from 'react';
import type { ShortcutBinding, ShortcutDefinition } from '../../../shared/ipcContract';
import { resolveShortcutBindings } from '../shortcuts/shortcutRegistry';

function bindingMatches(binding: ShortcutBinding, event: KeyboardEvent): boolean {
  if (event.key.toLowerCase() !== binding.key.toLowerCase()) {
    return false;
  }
  if (Boolean(binding.meta) !== event.metaKey) {
    return false;
  }
  if (Boolean(binding.ctrl) !== event.ctrlKey) {
    return false;
  }
  if (Boolean(binding.shift) !== event.shiftKey) {
    return false;
  }
  if (Boolean(binding.alt) !== event.altKey) {
    return false;
  }
  return true;
}

/**
 * Register global keyboard shortcuts.
 *
 * Takes a mapping from shortcut IDs (matching those in the shortcut registry)
 * to action callbacks. On mount, loads shortcut bindings from the persistent
 * store, resolves effective bindings, and registers a global keydown listener.
 *
 * Shortcut IDs without a corresponding action are ignored.
 */
export function useKeyboardShortcuts(
  shortcutActions: Record<string, () => void>,
): Map<string, ShortcutBinding> | null {
  const [bindings, setBindings] = useState<Map<string, ShortcutBinding> | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.piApi
      .getShortcuts()
      .then((persisted: ShortcutDefinition[]) => {
        if (cancelled) return;
        setBindings(resolveShortcutBindings(persisted));
      })
      .catch((error: unknown) => {
        console.error('Failed to load keyboard shortcuts:', error);
        // Fall back to defaults
        if (!cancelled) {
          setBindings(resolveShortcutBindings([]));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!bindings) return;
    const resolvedBindings = bindings;

    function handleKeyDown(event: KeyboardEvent): void {
      for (const [id, binding] of resolvedBindings) {
        if (bindingMatches(binding, event)) {
          const action = shortcutActions[id];
          if (action) {
            event.preventDefault();
            action();
            return;
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [bindings, shortcutActions]);

  return bindings;
}
