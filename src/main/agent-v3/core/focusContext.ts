/**
 * 「当前打开的资产」查询。
 *
 * 用户说「改一下当前这个场景」时，得知道编辑器里正开着什么。
 *
 * ## 与 V2 的区别：不再维护黑板
 *
 * V2 把这个信息缓存在 `ContextManager` 的 per-session 黑板里，靠
 * `syncFocusedEditorContext` 定期回填，工具再去黑板里翻。那套的问题是：
 *
 *   - 缓存会过期 —— 用户在引擎里切了窗口，黑板还是旧的
 *   - 与会话绑定，而「当前开着什么」是**引擎的状态**，跟哪个会话在问无关
 *   - 为了这一个字段，`ContextManager` 长到 1259 行
 *
 * V3 直接按需问引擎（`editor.get_focus_context`）。
 * 一次 RPC 的开销远小于维护一份会过期的缓存。
 */

import { serviceManager } from '../../services'

/** 场景树里选中的一个节点 */
export interface SelectedNode {
  name: string
  class: string
  /** 相对场景根节点的路径，根节点自己是 `.` */
  path: string
}

/**
 * 编辑器此刻的焦点与选中状态。
 *
 * 用户说「把**这个**节点改成 X」时靠的就是它们。
 * 组装在插件侧 `gdbox_link.gd` 的 `_focus_context()`。
 */
export interface FocusContext {
  /** 正在编辑的场景 */
  editedScene?: { name: string; path: string }
  openScenes?: Array<{ name: string; path: string }>

  selectedNodes?: SelectedNode[]
  selectedNodeCount?: number
  selectedNodesTruncated?: boolean

  /** FileSystem 面板里的选中 */
  fileSystem?: {
    selectedFiles: Array<{ name: string; path: string; class?: string }>
    selectedFileCount: number
    selectedFilesTruncated: boolean
    selectedFolders: string[]
  }
}

/** 查询超时。这是个辅助查询，卡住的话宁可当查不到也不要拖住工具调用 */
const TIMEOUT_MS = 5_000

/**
 * 问引擎当前开着什么。
 *
 * 查不到一律返回空对象而不是抛 —— 调用方要的是「有就用，没有就走别的路径」，
 * 抛异常会把一个可降级的辅助查询变成硬失败。
 */
export async function getFocusContext(): Promise<FocusContext> {
  try {
    const ws = serviceManager.getWebSocketService()
    if (ws.getConnectionCount() === 0) return {}
    return await ws.callRequest<FocusContext>('editor.get_focus_context', {}, undefined, TIMEOUT_MS)
  } catch (error) {
    console.warn('[AgentV3] 查询焦点编辑器失败:', (error as Error).message)
    return {}
  }
}
