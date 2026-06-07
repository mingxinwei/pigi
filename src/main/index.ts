/**
 * Electron main process entry point.
 *
 * - Spawns pi-agent utility process (no sessions yet, just the process)
 * - Sessions are created on-demand from renderer
 * - Each session gets control/data MessagePorts for commands and streaming
 */
import { app, BrowserWindow, ipcMain, net, protocol, shell, systemPreferences } from 'electron';
import { electronApp } from '@electron-toolkit/utils';
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

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.pigi');

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
