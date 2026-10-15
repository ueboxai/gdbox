/**
 * 编辑器看护（`core/team/editorWatch.ts`）接到真实的服务上：
 * WebSocket 事件、已连接工程、Godot 进程、打开工程、等插件连回来。
 */

import { existsSync } from 'fs'
import { join } from 'path'

import { watchEditorCrashes, type EditorWatchOptions } from '../agent-v3/core/team/editorWatch'
import { isGodotProjectRunning } from '../godot/processes'
import { serviceManager } from '../services'
import { projectManager } from '../services/project'
import { projectComparisonKey } from '../utils/projectPath'

/** 重开之后最多等插件多久。Godot 编辑器冷启动连导入一般在一分钟内 */
const RECONNECT_WAIT_MS = 3 * 60_000
const RECONNECT_POLL_MS = 2_000

/** 用户在设置里关了「编辑器崩溃后重开」就不开 —— 那是用户的设置 */
async function crashHandledElsewhere(): Promise<{ declined: string } | null> {
  const { appSettingsManager } = await import('../appSettingsManager')
  return appSettingsManager.getAutoRecoverEditorCrash()
    ? null
    : { declined: '用户在设置里关了「编辑器崩溃后重开」，需要用户自己打开工程' }
}

function isConnected(projectDir: string): boolean {
  const key = projectComparisonKey(projectDir)
  return projectManager
    .getInteractiveProjects()
    .some((project) => projectComparisonKey(project.projectPath) === key)
}

export function startTeamEditorWatch(
  isOurs: (projectDir: string) => boolean,
  options: EditorWatchOptions
): () => void {
  const ws = serviceManager.getWebSocketService()
  return watchEditorCrashes(
    {
      onEvent: (method, callback) => ws.onEvent(method, callback),
      connectedProjects: () =>
        projectManager
          .getInteractiveProjects()
          .map((p) => ({ connectionId: p.connectionId, projectPath: p.projectPath })),
      findProjectFile: async (projectDir) => {
        const file = join(projectDir, 'project.godot')
        return existsSync(file) ? file : null
      },
      isRunning: (projectFile) => isGodotProjectRunning(join(projectFile, '..')),
      reopen: async (projectFile) => {
        const { openProject } = await import('../services/project/openProject')
        // forImport：不藏主界面 —— 用户正看着任务板
        const result = await openProject(projectFile, { forImport: true })
        if (!result.success) throw new Error(result.error ?? '打开工程失败')
      },
      waitLive: async (projectDir) => {
        const deadline = Date.now() + RECONNECT_WAIT_MS
        while (Date.now() < deadline) {
          if (isConnected(projectDir)) return true
          await new Promise((resolve) => setTimeout(resolve, RECONNECT_POLL_MS))
        }
        return isConnected(projectDir)
      },
      // Godot 编辑器崩了不写崩溃报告
      crashReason: async () => null,
      isOurs,
      crashHandledElsewhere
    },
    options
  )
}
