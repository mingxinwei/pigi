import { app, type BrowserWindow } from 'electron'
import { is } from '@electron-toolkit/utils'

declare const __PIGI_DEBUG_PANEL__: boolean

const DEBUG_PANEL_ENV = 'PIGI_DEBUG_PANEL'
const DEBUG_PANEL_ENABLED_VALUE = '1'
const REMOTE_DEBUGGING_PORT = '9222'
const DEVTOOLS_MODE = 'detach'

export function isDebugPanelEnabled(): boolean {
  return __PIGI_DEBUG_PANEL__ || process.env[DEBUG_PANEL_ENV] === DEBUG_PANEL_ENABLED_VALUE
}

export function configureDebugPanel(): void {
  if (is.dev || isDebugPanelEnabled()) {
    app.commandLine.appendSwitch('remote-debugging-port', REMOTE_DEBUGGING_PORT)
  }
}

export function openDebugPanel(window: BrowserWindow): void {
  if (!isDebugPanelEnabled()) {
    return
  }

  window.webContents.once('did-finish-load', () => {
    window.webContents.openDevTools({ mode: DEVTOOLS_MODE })
  })
}
