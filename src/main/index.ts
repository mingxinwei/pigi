/**
 * Electron main process entry point.
 *
 * - Spawns pi-agent utility process (no sessions yet, just the process)
 * - Sessions are created on-demand from renderer
 * - Each session gets control/data MessagePorts for commands and streaming
 */
import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createMainWindow } from './windows/createMainWindow'
import { stopAllProcesses, registerIpcHandlers } from './ipc/piAgentBridge'
import { registerProjectHandlers } from './ipc/projectHandlers'
import { configureDebugPanel } from './debugConfig'
import { initializeNpmCommandDetection } from './processes/npmCommandDetector'

configureDebugPanel()

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.pigi')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  initializeNpmCommandDetection()
  registerIpcHandlers()
  registerProjectHandlers()
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  stopAllProcesses()
})
