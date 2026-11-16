/**
 * WebSocket IPC 处理模块
 * 提供渲染进程调用 WebSocket 服务的接口
 */
import { ipcMain } from 'electron'
import { serviceManager } from '../services'
import { logger } from '../services/logger'
import { projectManager } from '../services/project'

/**
 * 注册 WebSocket 相关的 IPC handlers
 */
export function registerWebSocketIPC(): void {
  const ws = serviceManager.getWebSocketService()

  /**
   * 获取服务状态
   */
  ipcMain.handle('ws:status', () => {
    return ws.getStatus()
  })

  /**
   * 再启动一次桥接（横幅上的「重试」）。已经在监听时直接返回成功
   */
  ipcMain.handle('ws:start', async () => {
    try {
      await ws.startServer()
      return { success: true }
    } catch (error) {
      logger.error('[WebSocket IPC] 启动失败:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  /**
   * 发送请求（RPC 模式）
   */
  ipcMain.handle(
    'ws:call',
    async (_, method: string, payload: unknown, clientId?: string, timeout?: number) => {
      try {
        const result = await ws.callRequest(method, payload, clientId, timeout)
        return { success: true, data: result }
      } catch (error) {
        logger.error('[WebSocket IPC] 请求失败:', error)
        return { success: false, error: (error as Error).message }
      }
    }
  )

  /**
   * 获取所有已连接的工程列表
   */
  // 只给交互式编辑器。界面上的「已连接」是说给用户听的，一个跑批的
  // commandlet 不算「你打开着这个工程」（见 projectManager.getInteractiveProjects）
  ipcMain.handle('ws:projects', () => {
    return projectManager.getInteractiveProjects()
  })

  logger.info('[WebSocket IPC] IPC handlers 已注册')
}
