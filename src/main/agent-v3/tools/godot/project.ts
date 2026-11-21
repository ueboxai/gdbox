/**
 * Godot 工具共用的两件事：这一轮操作的是哪个工程、用哪个 Godot。
 *
 * 工程优先取模型显式给的 `project_path`；没给就用这条对话绑定的工程
 * （和编辑器工具同一个来源，见 `core/projectTargetContext.ts`）。
 * 两边都没有时不猜 —— 报错让模型去问用户，或先 `set_session_project`。
 */

import { existsSync } from 'fs'
import { join } from 'path'

import { locateGodot, type GodotInfo } from '../../../godot/locate'
import { getWorkingProjectPath } from '../../core/projectTargetContext'

export const NO_GODOT =
  '没有找到 Godot 4。请用户在「设置 → 项目」里指定 Godot 编辑器的位置，然后再试。'

/** 找到的 Godot 缓存一份：每次调工具都跑一遍 `--version` 太慢 */
let cached: { preferred: string; info: GodotInfo } | undefined

export async function requireGodot(): Promise<GodotInfo> {
  const { appSettingsManager } = await import('../../../appSettingsManager')
  const preferred = appSettingsManager.getGodotPath()
  if (cached && cached.preferred === preferred && existsSync(cached.info.path)) return cached.info
  const info = await locateGodot(preferred, appSettingsManager.getGodotEngines())
  if (!info) throw new Error(NO_GODOT)
  const adopt = !preferred && !appSettingsManager.getGodotPath()
  if (adopt) appSettingsManager.setGodotPath(info.path)
  cached = { preferred: adopt ? info.path : preferred, info }
  return info
}

/** 测试用 */
export function resetGodotCacheForTest(): void {
  cached = undefined
}

/** 取这一轮的工程目录。给的路径不是 Godot 工程就直接报错，不往下跑 */
export function resolveProjectDir(explicit?: string): string {
  const dir = explicit?.trim() || getWorkingProjectPath()
  if (!dir) {
    throw new Error(
      '不知道要操作哪个工程：这条对话还没有归属工程，参数里也没给 project_path。' +
        '问用户是哪个工程，或者先用 set_session_project 绑定。'
    )
  }
  if (!existsSync(join(dir, 'project.godot'))) {
    throw new Error(`${dir} 下没有 project.godot，不是 Godot 工程。`)
  }
  return dir
}
