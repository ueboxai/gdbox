/**
 * 引擎桥接（盒子这一侧的 WebSocket 服务）的渲染层封装。
 *
 * 重新启动是用户点一下的动作，失败原因会随 `ws:status-changed` 推回横幅，
 * 所以这里回 `{ success, error? }`，不像读取类接口那样用 `unwrapResult` 抛异常。
 */

export interface BridgeActionResult {
  success: boolean
  error?: string
}

/** 再启动一次桥接。已经在监听时主进程直接返回成功 */
export async function restartBridge(): Promise<BridgeActionResult> {
  const ws = window.api?.websocket
  if (!ws?.start) return { success: false }
  try {
    return await ws.start()
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}
