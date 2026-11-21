import { inject, provide, type InjectionKey, type Ref } from 'vue'
import { agentBrowserAPI } from '@renderer/api/agentBrowser'
import { openFilePath } from '@renderer/composables/useFilePathMenu'

/**
 * 对话里的本地文件在这条对话的浏览器面板里打开。
 *
 * 浏览器按对话分开，所以由对话页提供、正文里的路径链接取用。
 * 不在对话页里（笔记等别处的 Markdown）取不到，调用方照旧交给系统默认程序。
 */
export type OpenInBrowser = (path: string) => Promise<void>

const openInBrowserKey: InjectionKey<OpenInBrowser> = Symbol('open-in-browser')

export function useOpenInBrowser(): OpenInBrowser | undefined {
  return inject(openInBrowserKey, undefined)
}

/**
 * @param sessionId 这条对话的浏览器会话；还没有时退回系统默认程序
 * @param onOpened 打开后把面板切到网页页签
 */
export function provideOpenInBrowser(
  sessionId: Ref<string | null | undefined>,
  onOpened: () => void
): OpenInBrowser {
  const open: OpenInBrowser = async (path) => {
    const id = sessionId.value
    if (!id) return openFilePath(path)
    try {
      await agentBrowserAPI.openUrl(id, path)
      onOpened()
    } catch {
      // 浏览器打不开（文件没了、浏览器正忙）就交给系统，打不开时那边会报原因
      await openFilePath(path)
    }
  }
  provide(openInBrowserKey, open)
  return open
}
