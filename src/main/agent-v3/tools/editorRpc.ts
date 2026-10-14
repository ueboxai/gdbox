/**
 * 调 Godot 编辑器里 GDBox Link 插件的 RPC。
 *
 * 连接方向和虚幻盒子的 UnrealAgentLink 一样：盒子是被动的 WebSocket 服务端，插件那边主动连过来，
 * 断了每 3 秒自己重试（`resources/godot/addons/gdbox_link/gdbox_link.gd`）。
 * 所以「编辑器没连上」时，不要让用户去界面上点「连接」—— 没有这个按钮。
 *
 * 这里收敛取连接、按目标工程路由、错误形状归一三件事，工具本身只剩
 * 「方法名 + 参数 + 成功文案」。
 */

import { serviceManager } from '../../services'
import { WebSocketServiceError } from '../../services/websocket/types'
import { getTargetConnectionId } from '../core/projectTargetContext'

/** 插件侧 RPC 的失败响应形状 */
interface RpcErrorShape {
  ok?: boolean
  success?: boolean
  error?: string
  message?: string
  code?: string | number
  details?: unknown
}

const DEFAULT_TIMEOUT_MS = 30_000

/**
 * 编辑器没连上时回给模型的那一句：陈述事实 + 下一步，不是借模型之口下达给用户的指令。
 */
export const EDITOR_NOT_CONNECTED_MESSAGE =
  'Godot 编辑器未连接：现在没有编辑器连到盒子。可能是编辑器没开，或者工程里还没启用 GDBox Link 插件。' +
  '不依赖编辑器的事（读写工程文件、godot_check / godot_run 跑无头检查）照样能做；' +
  '不要让用户去界面上「连接」：插件断线后每 3 秒自己重连，盒子这边没有这个按钮。'

export class EditorNotConnectedError extends Error {
  constructor() {
    super(EDITOR_NOT_CONNECTED_MESSAGE)
    this.name = 'EditorNotConnectedError'
  }
}

/** 调一次 RPC，**不**把 `ok:false` 当异常 —— 给「响应本身就是结果」的命令用 */
export async function callEditorRaw<T>(
  method: string,
  params: Record<string, unknown>,
  options: { timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<T> {
  const ws = serviceManager.getWebSocketService()
  if (ws.getConnectionCount() === 0) throw new EditorNotConnectedError()

  let response: T
  try {
    response = await ws.callRequest<T>(
      method,
      params,
      getTargetConnectionId(),
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      options.signal
    )
  } catch (error) {
    // 面向用户的那句在 message 里，写给模型的那半句在 agentHint 里；这条路的终点是模型，两句都给
    if (error instanceof WebSocketServiceError && error.agentHint) {
      throw new WebSocketServiceError(error.code, `${error.message} ${error.agentHint}`)
    }
    throw error
  }
  if (response === null || response === undefined) {
    throw new Error(`${method} 失败：Godot 编辑器未返回数据`)
  }
  return response
}

/**
 * 调一次 RPC，`ok:false` / `success:false` 抛成一个 message 已经写给模型看的异常。
 * @throws {EditorNotConnectedError} 没有连着的编辑器
 */
export async function callEditor<T>(
  method: string,
  params: Record<string, unknown>,
  options: { timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<T> {
  const response = await callEditorRaw<T>(method, params, options)
  const shape = response as RpcErrorShape | null
  if (shape && (shape.ok === false || shape.success === false)) {
    const reason = shape.error || shape.message || '未提供失败原因'
    throw new Error(
      [
        `${method} 失败：${reason}`,
        shape.code !== undefined ? `（错误码 ${shape.code}）` : '',
        shape.details ? `\n详情：${JSON.stringify(shape.details)}` : ''
      ].join('')
    )
  }
  return response
}
