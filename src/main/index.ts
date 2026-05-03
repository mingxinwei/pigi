/**
 * Electron main process entry point.
 *
 * Kept minimal — delegates to focused modules:
 * - windows/createMainWindow.ts — window lifecycle
 * - processes/createPiAgentProcess.ts — spawn utility process
 * - ipc/utilityBridge.ts — establish channels, register IPC handlers
 */
import { app } from 'electron'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { createMainWindow } from './windows/createMainWindow'
import { startPiAgent, stopPiAgent, registerPiIpcHandlers } from './ipc/utilityBridge'

// Enable remote debugging in dev mode
if (is.dev) {
  app.commandLine.appendSwitch('remote-debugging-port', '9222')
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.pigi')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  registerPiIpcHandlers()
  createMainWindow()
  startPiAgent()

  app.on('activate', () => {
    const { BrowserWindow } = require('electron')
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  stopPiAgent()
})
