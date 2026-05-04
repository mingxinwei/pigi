import { dialog, ipcMain } from 'electron'
import { PiChannel, type ProjectStateResult } from '../../shared/ipcContract'
import { getMainWindow } from '../windows/createMainWindow'
import { getProjectState, setActiveProject } from '../projects/projectStore'

function projectStateResult(): ProjectStateResult {
  return {
    success: true,
    ...getProjectState(),
  }
}

export function registerProjectHandlers(): void {
  ipcMain.handle(PiChannel.GetProjects, async () => projectStateResult())

  ipcMain.handle(PiChannel.SetActiveProject, async (_event, path: string) => {
    if (!path || typeof path !== 'string' || path.trim().length === 0) {
      return { success: false, error: 'path must be a non-empty string' }
    }

    setActiveProject(path)
    return projectStateResult()
  })

  ipcMain.handle(PiChannel.OpenProjectDirectory, async () => {
    const win = getMainWindow()
    const result = win
      ? await dialog.showOpenDialog(win, {
          properties: ['openDirectory'],
        })
      : await dialog.showOpenDialog({
          properties: ['openDirectory'],
        })

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true }
    }

    setActiveProject(result.filePaths[0])
    return projectStateResult()
  })
}
