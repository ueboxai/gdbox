/**
 * 两条执行流不能同时改同一个文件，也不能同时动同一台编辑器。
 *
 * 虚幻版本按 `/Game/...` 包路径锁、按连接排编辑器钥匙。Godot 的场景、脚本、资源
 * 都是工程里的文本文件，所以锁的粒度直接是**文件**：
 *
 * - 锁键是 `res://` 路径，归属是工程目录（填在锁记录的 connectionId 位上）。
 *   两个工程里同名的 `res://player.gd` 互不相干；界面和给模型的提示里显示的是 `res://`，
 *   比一长串磁盘路径好认。
 * - 只锁工程里的文件。团队工作区里的文档、`.gdbox/` 下的盒子数据、编辑器缓存 `.godot/`
 *   都不锁 —— 文档大家轮流往里追加是正常协作，锁了反而互相挡。
 * - 全是软锁：不翻只读位。虚幻那边翻只读位是为了挡用户在编辑器里手动保存；
 *   Godot 编辑器的保存要靠 `editor_save_all` 在改文件前先落盘，翻只读位只会让
 *   编辑器自己存不进去。
 *
 * 编辑器钥匙（`core/team/editorKey.ts`）只套 `godot.editor` 里会改东西的工具：
 * 编辑器只有一台，队员 A 在编辑器里跑游戏的时候队员 B 去切场景，A 看到的就是半截。
 * `godot_check` / `godot_run` / `godot_screenshot` 各起各的无头 Godot，不排队。
 */

import { existsSync } from 'fs'
import { dirname, isAbsolute, join, relative, resolve } from 'path'

import { EDITOR_NAMESPACE } from './toolNames'

/** 往上找 project.godot。找到给工程目录，否则 null */
export function godotProjectOf(filePath: string): string | null {
  let dir = dirname(resolve(filePath))
  for (let i = 0; i < 16; i++) {
    if (existsSync(join(dir, 'project.godot'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
  return null
}

export interface FileLock {
  /** 工程目录，按 `projectPathKey` 的习惯不改大小写（锁表自己会小写） */
  projectDir: string
  resPath: string
}

/** 这次写文件该锁哪一个。不在 Godot 工程里、或在不该锁的目录里，给 null */
export function fileLockFor(rawPath: unknown): FileLock | null {
  if (typeof rawPath !== 'string' || !rawPath.trim() || !isAbsolute(rawPath)) return null
  const projectDir = godotProjectOf(rawPath)
  if (!projectDir) return null
  const rel = relative(projectDir, resolve(rawPath)).replace(/\\/g, '/')
  if (!rel || rel.startsWith('..')) return null
  if (/^\.(godot|gdbox)(\/|$)/.test(rel)) return null
  return { projectDir, resPath: `res://${rel}` }
}

/** 写文件类工具里装路径的那个参数 */
const WRITE_PATH_PARAM: Record<string, string> = {
  write_local_file: 'path',
  edit_local_file: 'path'
}

export function fileLockForCall(toolName: string, params: unknown): FileLock | null {
  const key = WRITE_PATH_PARAM[toolName]
  if (!key || !params || typeof params !== 'object') return null
  return fileLockFor((params as Record<string, unknown>)[key])
}

/** 要排编辑器钥匙的工具：编辑器里会改状态的那些 */
export function needsEditorKey(meta: { namespace: string; risk: string }): boolean {
  return meta.namespace === EDITOR_NAMESPACE && meta.risk !== 'safe'
}
