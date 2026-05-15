import ElectronStore from 'electron-store';
import type { ShortcutBinding, ShortcutDefinition } from '../../shared/ipcContract';
import { SHORTCUT_DEFAULTS } from '../../shared/shortcutDefaults';

interface ShortcutStoreSchema {
  overrides: Record<string, ShortcutBinding>;
}

const store = new ElectronStore<ShortcutStoreSchema>({
  name: 'shortcuts',
  defaults: {
    overrides: {},
  },
});

const defaultMap = new Map(SHORTCUT_DEFAULTS.map((d) => [d.id, d]));

function resolveBinding(id: string, defaultBinding: ShortcutBinding): ShortcutBinding {
  const overrides = store.get('overrides');
  return overrides[id] ?? defaultBinding;
}

export function getShortcuts(): ShortcutDefinition[] {
  return SHORTCUT_DEFAULTS.map((entry) => ({
    id: entry.id,
    label: entry.label,
    defaultBinding: entry.defaultBinding,
    binding: resolveBinding(entry.id, entry.defaultBinding),
  }));
}

export function setShortcutBinding(
  id: string,
  binding: ShortcutBinding,
): { success: boolean; error?: string } {
  if (!binding || typeof binding.key !== 'string' || binding.key.length === 0) {
    return { success: false, error: 'binding.key must be a non-empty string' };
  }
  const registered = defaultMap.get(id);
  if (!registered) {
    return { success: false, error: `unknown shortcut: ${id}` };
  }

  const overrides = { ...store.get('overrides') };

  // If the new binding matches the default, remove the override
  const defaultBinding = registered.defaultBinding;
  const isDefault =
    binding.key === defaultBinding.key &&
    Boolean(binding.ctrl) === Boolean(defaultBinding.ctrl) &&
    Boolean(binding.meta) === Boolean(defaultBinding.meta) &&
    Boolean(binding.shift) === Boolean(defaultBinding.shift) &&
    Boolean(binding.alt) === Boolean(defaultBinding.alt);

  if (isDefault) {
    delete overrides[id];
  } else {
    overrides[id] = binding;
  }

  store.set('overrides', overrides);
  return { success: true };
}
