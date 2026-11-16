/**
 * 在 Godot 编辑器里打开「本轮改动」里的某个资源 —— 清单只能说「player.tscn 是新建的」，
 * 说不清它长什么样，那一步交给编辑器本身，一键打开，眼见为实。
 *
 * 场景（`.tscn` / `.scn`）在编辑器里开成一个场景标签页；其余资源进检查器，
 * 同时在文件系统面板里选中，让用户知道它放在哪。
 */

import { callEditor } from '../tools/editorRpc'

/** 是不是工程内的资源路径（`res://…`）。本地绝对路径和节点名不能在编辑器里打开 */
export function isContentPath(target: string): boolean {
  return /^res:\/\/.+/.test(String(target ?? '').trim())
}

export interface OpenAssetResult {
  success: boolean
  /** 已经开着时编辑器不会再开一个标签页，这里会是 false —— 不算失败 */
  opened?: boolean
  error?: string
}

export async function openAssetInEditor(contentPath: string): Promise<OpenAssetResult> {
  if (!isContentPath(contentPath)) {
    return { success: false, error: '不是工程内的资源路径' }
  }
  try {
    const result = await callEditor<{ opened?: boolean; missing?: boolean }>(
      'editor.open_asset',
      { path: contentPath },
      { timeoutMs: 10_000 }
    )
    if (result.missing) return { success: false, error: '资源不存在，可能已经被移动或删除了' }
    return { success: true, opened: result.opened !== false }
  } catch (error) {
    return { success: false, error: (error as Error).message }
  }
}
