import type { ShortcutBinding } from './ipcContract';

export interface ShortcutEntry {
  id: string;
  label: string;
  defaultBinding: ShortcutBinding;
}

/**
 * Canonical shortcut defaults — single source of truth shared by main process
 * store and renderer registry. Add new shortcuts here.
 */
export const SHORTCUT_DEFAULTS: ShortcutEntry[] = [
  {
    id: 'sidebar.newChat',
    label: 'New chat',
    defaultBinding: { key: 'n', meta: true },
  },
  {
    id: 'sidebar.openProject',
    label: 'Open project',
    defaultBinding: { key: 'o', meta: true },
  },
  {
    id: 'navigation.openSwitcher',
    label: 'Session switcher',
    defaultBinding: { key: 'r', ctrl: true },
  },
  {
    id: 'navigation.closeOrSelectSwitcher',
    label: 'Session switcher (Ctrl+Tab)',
    defaultBinding: { key: 'Tab', ctrl: true },
  },
  {
    id: 'navigation.prev',
    label: 'Previous session',
    defaultBinding: { key: '[', meta: true },
  },
  {
    id: 'navigation.next',
    label: 'Next session',
    defaultBinding: { key: ']', meta: true },
  },
];
