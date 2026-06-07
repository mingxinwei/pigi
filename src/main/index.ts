/**
 * Electron main process entry point.
 *
 * - Spawns pi-agent utility process (no sessions yet, just the process)
 * - Sessions are created on-demand from renderer
 * - Each session gets control/data MessagePorts for commands and streaming
 */
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  net,
  protocol,
  shell,
  systemPreferences,
} from 'electron';
import { electronApp, is } from '@electron-toolkit/utils';
import { createMainWindow } from './windows/createMainWindow';
import { stopAllProcesses, registerIpcHandlers } from './ipc/piAgentBridge';
import { registerProjectHandlers } from './ipc/projectHandlers';
import { registerShortcutHandlers } from './ipc/shortcutHandlers';
import { PiChannel } from '../shared/ipcContract';
import { configureDebugPanel } from './debugConfig';
import { initializeShellEnv } from './processes/shellEnvResolver';

configureDebugPanel();

protocol.registerSchemesAsPrivileged([
  { scheme: 'local-file', privileges: { bypassCSP: true, supportFetchAPI: true } },
]);

function setupApplicationMenu(): void {
  const isMac = process.platform === 'darwin';

  const template: Electron.MenuItemConstructorOptions[] = [
    // macOS app menu
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
    // Edit menu — standard copy/paste/undo shortcuts
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        { role: 'selectAll' as const },
      ],
    },
    // View menu — no reload item so Ctrl+R is free for custom shortcuts
    {
      label: 'View',
      submenu: [
        ...(is.dev ? [{ role: 'toggleDevTools' as const }] : []),
        { role: 'resetZoom' as const },
        { role: 'zoomIn' as const },
        { role: 'zoomOut' as const },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const },
      ],
    },
    // Window menu (macOS)
    ...(isMac
      ? [
          {
            label: 'Window',
            submenu: [
              { role: 'minimize' as const },
              { role: 'zoom' as const },
              { role: 'close' as const },
            ],
          },
        ]
      : []),
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.pigi');

  setupApplicationMenu();

  protocol.handle('local-file', (request) =>
    net.fetch('file://' + decodeURIComponent(request.url.slice('local-file://'.length))),
  );

  initializeShellEnv();
  registerIpcHandlers();
  registerProjectHandlers();
  registerShortcutHandlers();

  ipcMain.on(PiChannel.OpenExternal, (_event, url: string) => {
    if (typeof url !== 'string') return;
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url);
    }
  });

  ipcMain.handle(PiChannel.GetAccentColor, () => {
    // macOS 10.14+: returns system accent color as RGBA hex (#RRGGBBAA).
    const accent = systemPreferences.getAccentColor();
    return accent || null;
  });

  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopAllProcesses();
});
