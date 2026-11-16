import { ref } from 'vue'
import i18n from '@renderer/i18n'

/** 这是 composable 不是组件，拿不到 `useI18n()`；`i18n.global.t` 每次调用现读当前语言 */
const t = i18n.global.t

/**
 * 首页「从系统里往窗口里拖文件」的覆层状态。drop 本身由 Home.vue 处理。
 */
export function useDragImport() {
  const isDragOver = ref(false)
  const overlayText = ref('')

  /**
   * 这一层只管「从系统里往窗口里拖文件」。应用内部的卡片拖拽（比如把工程拖进分组）
   * 一样会冒泡到挂着这些处理器的页面根节点上，所以每个处理器都得先认一下是不是文件拖拽，
   * 不是就彻底放手。
   *
   * 以前 dragover 是无条件 preventDefault + dropEffect='copy'，等于把内部拖拽劫走：
   * 内部拖拽声明的是 effectAllowed='move'，跟这里的 copy 对不上，浏览器把结果解析成
   * none —— 光标变成禁用图标，drop 事件根本不发，真正的放置目标怎么写都没用。
   */
  const isFileDrag = (e: DragEvent): boolean => Boolean(e.dataTransfer?.types?.includes('Files'))

  const handleDragEnter = (e: DragEvent) => {
    if (!isFileDrag(e)) return
    e.preventDefault()
    e.stopPropagation()
    isDragOver.value = true
    const count = e.dataTransfer?.items?.length || e.dataTransfer?.files?.length || 0
    overlayText.value =
      count > 0
        ? t('page.home.project.importToast.dropCounted', { count })
        : t('page.home.project.importToast.dropPlain')
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  }

  const handleDragOver = (e: DragEvent) => {
    if (!isFileDrag(e)) return
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  }

  const handleDragLeave = (e: DragEvent) => {
    if (!isFileDrag(e)) return
    e.preventDefault()
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = e.clientX
    const y = e.clientY
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
      return
    }
    isDragOver.value = false
    overlayText.value = ''
  }

  return {
    isDragOver,
    overlayText,
    handleDragEnter,
    handleDragOver,
    handleDragLeave
  }
}
