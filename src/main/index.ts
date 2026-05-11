/**
 * Electron main process entry point.
 *
 * - Spawns pi-agent utility process (no sessions yet, just the process)
 * - Sessions are created on-demand from renderer
 * - Each session gets control/data MessagePorts for commands and streaming
 */
import { app, BrowserWindow, ipcMain, net, protocol, shell } from 'electron';
import { electronApp, optimizer } from '@electron-toolkit/utils';
import { createMainWindow } from './windows/createMainWindow';
import { stopAllProcesses, registerIpcHandlers } from './ipc/piAgentBridge';
import { registerProjectHandlers } from './ipc/projectHandlers';
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
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window));

  initializeShellEnv();
  registerIpcHandlers();
  registerProjectHandlers();

  ipcMain.on(PiChannel.OpenExternal, (_event, url: string) => {
    if (typeof url !== 'string') return;
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url);
    }
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
