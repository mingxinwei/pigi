/**
 * Create and configure the main BrowserWindow.
 */
import { BrowserWindow, shell } from 'electron';
import { join } from 'path';
import { is } from '@electron-toolkit/utils';
import icon from '../../../resources/icon.png?asset';
import { openDebugPanel } from '../debugConfig';

let mainWindow: BrowserWindow | null = null;

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function createMainWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 680,
    minHeight: 400,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 15 },
    ...(process.platform === 'darwin'
      ? { vibrancy: 'menu', backgroundColor: '#00000000' }
      : { backgroundColor: '#ffffff' }),
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
    },
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow!.show();
  });

  // Disable built-in menu shortcuts (Ctrl+R, Ctrl+Shift+I, etc.) so
  // keyboard events reach the renderer for custom shortcut handling.
  mainWindow.webContents.setIgnoreMenuShortcuts(true);

  // Toggle DevTools with F12 or Ctrl+Shift+I (dev only)
  if (is.dev) {
    mainWindow.webContents.on('before-input-event', (_event, input) => {
      if (input.type !== 'keyDown') return;
      const isDevToolsKey =
        input.code === 'F12' || (input.code === 'KeyI' && input.control && input.shift);
      if (isDevToolsKey) {
        if (mainWindow!.webContents.isDevToolsOpened()) {
          mainWindow!.webContents.closeDevTools();
        } else {
          mainWindow!.webContents.openDevTools({ mode: 'detach' });
        }
      }
    });
  }

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  openDebugPanel(mainWindow);

  return mainWindow;
}
