/**
 * 首页「引擎版本」：列出本机的 Godot 4，启动编辑器（项目管理器），手动添加 / 移除，设默认。
 *
 * 默认引擎就是设置里的 `godotPath`：打开工程、试玩、Agent 的无头检查都用它，
 * 和「设置 → 项目」里指定的是同一个值。
 */

import { spawn } from 'node:child_process'
import { statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { ipcMain } from 'electron'

import { appSettingsManager } from '../appSettingsManager'
import { exesIn, listGodots, probeGodot, type GodotInfo } from '../godot/locate'
import { parseProjectFile } from '../godot/projectFile'
import { readGodotRecentProjects } from '../godot/recentProjects'
import { getPublicDatabase } from '../sqliteDataBase'
import { getProjectByPath } from '../sqliteDataBase/models/project'
import type { GodotRecentProjectItem } from '../../shared/godotRecentProject'

async function listRecentProjects(): Promise<GodotRecentProjectItem[]> {
  const db = getPublicDatabase()
  return Promise.all(
    (await readGodotRecentProjects()).map(async (entry) => {
      const summary = await readFile(join(entry.projectPath, 'project.godot'), 'utf8')
        .then(parseProjectFile)
        .catch(() => ({}) as ReturnType<typeof parseProjectFile>)
      return {
        projectPath: entry.projectPath,
        projectName: summary.name || basename(entry.projectPath),
        engineVersion: summary.engineVersion ?? '',
        lastOpenTime: entry.lastOpenTime,
        isImported: Boolean(getProjectByPath(db, entry.projectPath)),
        thumbnailPath: summary.icon?.startsWith('res://')
          ? join(entry.projectPath, summary.icon.slice('res://'.length))
          : undefined
      }
    })
  )
}

export interface GodotEngineItem {
  path: string
  version: string
  /** 用户手动加的；自动找到的不能移除 */
  custom: boolean
}

/** 最近一次列出来的路径。启动只认这些，渲染层传不进任意可执行文件 */
const listed = new Set<string>()

const sameFile = (a: string, b: string): boolean =>
  process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b

/** 拖进来或选中的可能是 exe，也可能是放 exe 的文件夹 */
async function probeInput(input: string): Promise<GodotInfo | null> {
  let isDir = false
  try {
    isDir = statSync(input).isDirectory() && !/\.app\/?$/i.test(input)
  } catch {
    return null
  }
  for (const p of isDir ? exesIn(input) : [input]) {
    const info = await probeGodot(p)
    if (info) return info
  }
  return null
}

export function registerGodotEnginesIPC(): void {
  ipcMain.handle('godot-engines:list', async () => {
    try {
      const custom = appSettingsManager.getGodotEngines()
      const infos = await listGodots(custom)
      listed.clear()
      const engines: GodotEngineItem[] = infos.map((info) => {
        listed.add(info.path)
        return { ...info, custom: custom.some((p) => sameFile(p, info.path)) }
      })
      return { success: true, engines, defaultPath: appSettingsManager.getGodotPath() }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('godot-engines:add', async (_event, input: string) => {
    void _event
    const info = await probeInput(String(input ?? '').trim())
    if (!info) return { success: false }
    const custom = appSettingsManager.getGodotEngines()
    if (!custom.some((p) => sameFile(p, info.path))) {
      appSettingsManager.setGodotEngines([...custom, info.path])
    }
    listed.add(info.path)
    return { success: true, engine: { ...info, custom: true } }
  })

  ipcMain.handle('godot-engines:remove', (_event, path: string) => {
    void _event
    appSettingsManager.setGodotEngines(
      appSettingsManager.getGodotEngines().filter((p) => !sameFile(p, path))
    )
    if (sameFile(appSettingsManager.getGodotPath(), path)) appSettingsManager.setGodotPath('')
    return { success: true }
  })

  ipcMain.handle('godot-engines:setDefault', (_event, path: string) => {
    void _event
    appSettingsManager.setGodotPath(path ?? '')
    return { success: true }
  })

  ipcMain.handle('godot:recentProjects', async () => {
    try {
      return { success: true, projects: await listRecentProjects() }
    } catch (error) {
      return { success: false, projects: [], error: (error as Error).message }
    }
  })

  ipcMain.handle('godot-engines:launch', (_event, path: string) => {
    void _event
    if (![...listed].some((p) => sameFile(p, path))) {
      return { success: false, error: 'unknown engine' }
    }
    return new Promise<{ success: boolean; error?: string }>((resolve) => {
      const child = spawn(path, ['--project-manager'], { detached: true, stdio: 'ignore' })
      child.once('error', (error) => resolve({ success: false, error: error.message }))
      child.once('spawn', () => {
        child.unref()
        resolve({ success: true })
      })
    })
  })
}
