import { ipcMain } from 'electron';
import { PiChannel, type ShortcutBinding } from '../../shared/ipcContract';
import { getShortcuts, setShortcutBinding } from '../shortcuts/shortcutStore';

function isValidBinding(value: unknown): value is ShortcutBinding {
  if (!value || typeof value !== 'object') return false;
  const binding = value as Record<string, unknown>;
  if (typeof binding.key !== 'string' || binding.key.length === 0) return false;
  return true;
}

export function registerShortcutHandlers(): void {
  ipcMain.handle(PiChannel.GetShortcuts, async () => {
    return getShortcuts();
  });

  ipcMain.handle(PiChannel.SetShortcut, async (_event, id: string, binding: unknown) => {
    if (!id || typeof id !== 'string') {
      return { success: false, error: 'id must be a non-empty string' };
    }
    if (!isValidBinding(binding)) {
      return { success: false, error: 'binding must have a non-empty key string' };
    }
    return setShortcutBinding(id, binding);
  });
}
