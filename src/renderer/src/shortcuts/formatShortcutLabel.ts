import type { ShortcutBinding } from '../../../shared/ipcContract';
import { useAppStore } from '../state/appStore';

/**
 * Returns a human-readable display string for a shortcut binding.
 * On Mac, modifiers are shown as symbols: ⌘ ⌃ ⌥ ⇧
 * On other platforms, modifiers are shown as words: Ctrl Alt Shift
 */
export function formatShortcutLabel(binding: ShortcutBinding): string {
  const isMac = useAppStore.getState().platform === 'mac';
  const parts: string[] = [];
  if (binding.meta) {
    parts.push(isMac ? '⌘' : 'Meta');
  }
  if (binding.ctrl) {
    parts.push(isMac ? '⌃' : 'Ctrl');
  }
  if (binding.alt) {
    parts.push(isMac ? '⌥' : 'Alt');
  }
  if (binding.shift) {
    parts.push(isMac ? '⇧' : 'Shift');
  }
  const keyLabel = binding.key.length === 1 ? binding.key.toUpperCase() : binding.key;
  parts.push(keyLabel);
  return parts.join(' ');
}
