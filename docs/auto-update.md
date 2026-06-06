# Auto-Update Design

## Overview

Add auto-update to pigi (Electron app), powered by `electron-updater` with GitHub Releases. Two flows: silent background check with blue-dot notification, and manual check from macOS menu with progress window.

## Decisions

### Library: electron-updater

- Chosen because the project already uses electron-builder with GitHub publish configured in `electron-builder.yml`. electron-updater reads that config directly, zero additional setup.
- `electron-log` for file-based logging (no existing logging).

### Channel: stable only

Single `latest` channel. No beta/alpha.

### autoDownload: false

Set globally to `false`. Both auto-check and manual check call `downloadUpdate(cancellationToken)` explicitly. This gives us control over cancellation (progress window cancel button calls `cancellationToken.cancel()`).

### autoInstallOnAppQuit: false

User must explicitly trigger install. Two install paths:

1. Blue-dot menu: "Update to new version" in Settings popover → `quitAndInstall()`
2. Progress window: "Install and Restart" button → `quitAndInstall()`

### Flow 1: Automatic Background Check

```
App launch / every 2 hours
  → autoUpdater.checkForUpdates()
    → update-available? Yes
      → autoUpdater.downloadUpdate()
        → download-progress events (logged only)
        → update-downloaded
          → IPC main→renderer: pi:update_downloaded
          → AppStore.updateDownloaded = true
          → Blue dot appears on Settings sidebar button
```

Blue dot: small blue circle on the far right of the Settings `SidebarMenuButton`. Clicking Settings opens the existing Popover, now with a third item: "Update to new version" (only visible when `updateDownloaded` is true). Clicking it calls `quitAndInstall()`.

### Flow 2: Manual Check (macOS App Menu)

```
User clicks "Check for Updates" in app menu
  → main process: autoUpdater.checkForUpdates()
    → update-available? Yes
      → Open UpdateProgressWindow (BrowserWindow, ~400x180, centered, modal, borderless)
      → autoUpdater.downloadUpdate(cancellationToken)
        → IPC main→progressWindow: pi:update_download_progress { percent, bytesPerSecond }
        → progressWindow shows progress bar + Cancel button
        → Cancel → cancellationToken.cancel() → close window
        → update-downloaded
          → IPC main→progressWindow: pi:update_downloaded
          → progressWindow shows "Install and Restart" button
          → Click → pi:quit_and_install → main calls quitAndInstall()
    → update-not-available? Yes
      → Show brief toast/notification: "You're up to date"
    → error? Just log it
```

### Progress Window

- Created by main process via `createUpdateProgressWindow.ts` in `src/main/windows/` (following existing project convention).
- Loads the same renderer at `#/update-progress`. In `main.tsx`, check `window.location.hash` to render `<UpdateProgress />` instead of `<App />`.
- UI: progress bar, percentage text, cancel button (during download), "Install and Restart" button (on completion).
- No need for electron-vite multi-entry config.

### IPC Channels

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `pi:update_downloaded` | main → all renderers | Notify download complete (blue dot + progress window) |
| `pi:update_download_progress` | main → progress window | Download progress updates |
| `pi:quit_and_install` | renderer → main | User triggers install |

### Preload API (extends window.piApi)

```ts
onUpdateDownloaded: (callback: (info: UpdateDownloadedEvent) => void) => () => void
onUpdateProgress: (callback: (info: ProgressInfo) => void) => () => void
onUpdateNotAvailable: (callback: () => void) => () => void
quitAndInstall: () => void
cancelDownload: () => void
```

### Zustand Store

```ts
updateDownloaded: boolean  // true when download complete, drives blue dot
setUpdateDownloaded: (v: boolean) => void
```

### File Structure

```
src/main/
├── ipc/
│   ├── updateManager.ts          # autoUpdater init, events, IPC handlers, timer
│   └── piAgentBridge.ts          # existing
├── windows/
│   ├── createUpdateProgressWindow.ts  # progress window factory
│   └── createMainWindow.ts       # existing
└── index.ts                      # + app menu item, updateManager init

src/renderer/src/
├── main.tsx                      # + hash route fork for #/update-progress
└── components/
    └── UpdateProgress.tsx        # progress window UI

src/preload/index.ts              # + auto-update API methods

src/shared/ipcContract.ts         # + PiChannel enum entries
```

### Dev Testing

- `dev-app-update.yml` at project root, mirrors `electron-builder.yml` publish config
- In dev mode: `autoUpdater.forceDevUpdateConfig = true`
- Need a GitHub release with higher version to trigger update detection

### Dependencies to Add

- `electron-updater` (runtime)
- `electron-log` (runtime)

### Platform Scope

macOS only for now. Windows deferred.
