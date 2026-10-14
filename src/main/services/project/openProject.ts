/**
 * 用 Godot 编辑器打开一个工程。
 *
 * 首页双击、合集、右键「启动」走 `shell:openUproject` 这条 IPC，托盘菜单的「最近项目」
 * 直接调这里。两条入口必须同一段代码：插件先装、失败原因带回来、
 * 「打开工程后隐藏主界面」的设置才都能对得上。
 *
 * 和虚幻不同，`project.godot` 没有关联的打开方式 —— 要拿 Godot 可执行文件带
 * `--editor --path <工程目录>` 起一个进程。
 */
import { spawn } from 'child_process'
import { existsSync, statSync } from 'fs'
import { basename, dirname, join } from 'path'

import { appSettingsManager } from '../../appSettingsManager'
import { findMainWindow } from '../../appWindows'
import { installEditorLink } from '../../godot/editorLinkAddon'
import { locateGodot } from '../../godot/locate'
import { projectManager } from './projectManager'
import { projectComparisonKey } from '../../utils/projectPath'

export interface OpenProjectOptions {
  /**
   * 导入弹窗替用户打开工程：编辑器已经连着就复用（返回 `alreadyRunning`），
   * 且打开后不藏主界面 —— 用户正盯着弹窗等导入开始
   */
  forImport?: boolean
}

export interface OpenProjectResult {
  success: boolean
  error?: string
  /** 工程文件已经不在盘上 —— 调用方可能想给「从列表移除」的出口 */
  pathNotFound?: boolean
  /** forImport 打开时发现编辑器已经连着 —— 调用方通常改为直接导，而不是等启动 */
  alreadyRunning?: boolean
  /**
   * 工程打开了，但 GDBox Link 没装上。它不拖垮 `success`（工程可以正常用），
   * 却是之后「AI 看不见编辑器」唯一的线索 —— 调用方一定要拿它去提示用户。
   */
  pluginFailure?: string
}

/** 接受工程目录或 `project.godot` 的路径，统一成工程目录 */
export function projectDirOf(projectPath: string): string {
  if (basename(projectPath).toLowerCase() === 'project.godot') return dirname(projectPath)
  try {
    return statSync(projectPath).isFile() ? dirname(projectPath) : projectPath
  } catch {
    return projectPath
  }
}

export async function openProject(
  projectPath: string,
  options?: OpenProjectOptions
): Promise<OpenProjectResult> {
  try {
    const projectDir = projectDirOf(projectPath)
    if (!existsSync(join(projectDir, 'project.godot'))) {
      return { success: false, error: '工程文件不存在', pathNotFound: true }
    }

    // 导入弹窗替用户打开工程，是为了等它连上后接着导。编辑器已经连着就别再起一个
    const wanted = projectComparisonKey(projectDir)
    if (
      options?.forImport &&
      projectManager
        .getInteractiveProjects()
        .some((project) => projectComparisonKey(project.projectPath) === wanted)
    ) {
      return { success: true, alreadyRunning: true }
    }

    const godot = await locateGodot(appSettingsManager.getGodotPath() || undefined)
    if (!godot) {
      return {
        success: false,
        error: '没有找到 Godot 4。请在「设置 → 项目」里指定 Godot 编辑器的位置。'
      }
    }

    // 装不上要回给界面：它不抛异常，只在返回值里写原因。丢掉的话工程照常打开，
    // 用户之后遇到「AI 看不见编辑器」时，早就想不起来跟打开这一步有关
    let pluginFailure: string | undefined
    if (
      appSettingsManager.getAutoEnableUnrealAgentLink() &&
      !appSettingsManager.isUALinkOptedOut(projectDir)
    ) {
      try {
        installEditorLink(projectDir)
      } catch (error) {
        pluginFailure = error instanceof Error ? error.message : String(error)
        console.warn('[openProject] 装 GDBox Link 失败:', error)
      }
    }

    const child = spawn(godot.path, ['--editor', '--path', projectDir], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    })
    const spawnError = await new Promise<string | undefined>((resolve) => {
      child.once('error', (error) => resolve(error.message))
      child.once('spawn', () => resolve(undefined))
    })
    if (spawnError) return { success: false, error: spawnError }
    child.unref()

    // 「打开工程后隐藏主界面」只在**真的打开了**之后才生效。导入弹窗打开的也不藏
    if (!options?.forImport && appSettingsManager.getHideWindowOnProjectLaunch()) {
      const mainWindow = findMainWindow()
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide()
    }

    return { success: true, ...(pluginFailure ? { pluginFailure } : {}) }
  } catch (error) {
    return { success: false, error: (error as Error).message }
  }
}
