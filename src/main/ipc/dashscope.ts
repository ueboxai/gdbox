import { ipcMain } from 'electron'
import { generate3DModelName } from '../services/dashscope/imageAnalyzer'

/**
 * 注册 DashScope 相关 IPC 处理器
 */
export function registerDashScopeIPC(): void {
  /**
   * 使用视觉模型为3D模型生成名称（图生模型：识别图片）
   *
   * @param args.imageBase64 - 模型缩略图的 Base64 数据
   * @returns 生成的名称；没绑看得懂图的模型时带 `errorKey`，界面据此提示去配置
   */
  ipcMain.handle(
    'dashscope:generate3DModelName',
    async (
      _event,
      args: { imageBase64: string }
    ): Promise<{ success: boolean; name?: string; error?: string; errorKey?: string }> => {
      const { imageBase64 } = args

      if (!imageBase64) {
        return { success: false, error: '缩略图数据不能为空' }
      }

      console.log('[DashScope IPC] 开始使用视觉模型为3D模型命名')
      const result = await generate3DModelName(imageBase64)

      return result
    }
  )

  console.log('[DashScope IPC] 处理器已注册')
}
