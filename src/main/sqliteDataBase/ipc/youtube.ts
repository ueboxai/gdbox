/**
 * YouTube 视频分析 IPC 处理器
 * 用于在主进程中调用服务端 API 分析 YouTube 视频内容
 * 供知识库添加 YouTube 来源使用
 */
import { ipcMain } from 'electron'
import {
  YOUTUBE_KEY_HINT,
  analyzeYouTubeLocally
} from '../../services/videoAnalysis/localVideoAnalysis'

/**
 * YouTube 分析请求参数接口
 */
interface YouTubeAnalyzeParams {
  /** YouTube 视频 URL */
  url: string
  /** 自定义分析提示词（可选） */
  prompt?: string
  /** 认证 Token */
}

/**
 * YouTube 分析结果接口
 */
interface YouTubeAnalyzeResult {
  success: boolean
  /** 分析结果（Markdown 格式） */
  content?: string
  /** 视频标题 */
  title?: string
  /** YouTube 视频 ID */
  videoId?: string
  /** 规范化后的 YouTube URL */
  url?: string
  /** 错误信息 */
  error?: string
}

/**
 * 调用服务端 YouTube 分析 API
 */
async function analyzeYouTubeVideo(params: YouTubeAnalyzeParams): Promise<YouTubeAnalyzeResult> {
  const { url, prompt } = params

  if (!url || typeof url !== 'string') {
    return {
      success: false,
      error: '请提供有效的 YouTube 视频 URL'
    }
  }

  // 用户自己配了 Gemini 的 Key 就直连 —— 服务端那条路做的也是同一件事：
  // 把 YouTube 链接丢给 Gemini 的 fileData
  const local = await analyzeYouTubeLocally(url, prompt)
  if (local) {
    if (!local.success) return { success: false, error: local.error }
    return { success: true, content: local.content, title: local.title, url }
  }

  return { success: false, error: YOUTUBE_KEY_HINT }
}

/**
 * 注册 YouTube 分析 IPC 处理器
 */
export function registerYouTubeIPC(): void {
  console.log('[YouTubeIPC] 注册 YouTube 分析 IPC 处理器')

  /**
   * 分析 YouTube 视频
   * @param params - 分析参数（url, prompt?）
   */
  ipcMain.handle(
    'youtube:analyze',
    async (_event, params: YouTubeAnalyzeParams): Promise<YouTubeAnalyzeResult> => {
      console.log('[YouTubeIPC] 收到分析请求:', params?.url)

      if (!params || typeof params !== 'object') {
        return {
          success: false,
          error: '无效的请求参数'
        }
      }

      return await analyzeYouTubeVideo(params)
    }
  )
}
