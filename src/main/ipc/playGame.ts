/**
 * 界面上的「运行游戏」：对话顶栏、项目卡片都走这里（实现见 `godot/playGame.ts`）。
 *
 * - `game:play`：开（已经开着就是重开）。返回失败原因，界面直接显示。
 * - `game:stop`：关。
 * - `game:status`：这个工程现在有没有在跑（页面切回来时问一次）。
 * - 事件 `game:status`：开了、关了、崩了都推一次，按钮跟着变；崩了带报错。
 */

import { BrowserWindow, ipcMain } from 'electron'

import { appSettingsManager } from '../appSettingsManager'
import { locateGodot } from '../godot/locate'
import { isGameRunning, playGame, setGameStatusListener, stopGame } from '../godot/playGame'
import { projectDirOf } from '../services/project/openProject'

export function registerPlayGameIPC(): void {
  setGameStatusListener((status) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('game:status', status)
    }
  })

  ipcMain.handle('game:play', async (_event, projectPath: string, scene?: string) => {
    void _event
    try {
      const godot = await locateGodot(appSettingsManager.getGodotPath() || undefined)
      if (!godot) {
        return {
          success: false,
          error: '没有找到 Godot 4。请在「设置 → 项目」里指定 Godot 编辑器的位置。'
        }
      }
      await playGame(godot.path, projectDirOf(projectPath), scene ? { scene } : {})
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('game:stop', (_event, projectPath: string) => {
    void _event
    return { success: stopGame(projectDirOf(projectPath)) }
  })

  ipcMain.handle('game:status', (_event, projectPath: string) => {
    void _event
    return { running: isGameRunning(projectDirOf(projectPath)) }
  })
}
