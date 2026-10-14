<script setup lang="ts">
import AppButton from '@renderer/components/AppButton.vue'
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { message } from '@renderer/utils/messageManager'
import {
  PhArrowLeft,
  PhCloudArrowUp,
  PhDatabase,
  PhGlobe,
  PhLink,
  PhX,
  PhYoutubeLogo
} from '@phosphor-icons/vue'
import { isSupportedSourceFile } from '../utils/fileTypeUtils'

/**
 * 递归遍历 FileSystemDirectoryEntry 获取所有文件
 * @param entry 目录入口
 * @returns Promise<File[]> 该目录下所有支持的文件
 */
const traverseDirectory = async (entry: FileSystemDirectoryEntry): Promise<File[]> => {
  const files: File[] = []
  const reader = entry.createReader()

  /**
   * 读取目录内容（分批读取，直到没有更多条目）
   */
  const readEntries = (): Promise<FileSystemEntry[]> => {
    return new Promise((resolve, reject) => {
      reader.readEntries(
        (entries) => resolve(entries),
        (error) => reject(error)
      )
    })
  }

  /**
   * 处理单个条目
   */
  const processEntry = async (childEntry: FileSystemEntry): Promise<void> => {
    if (childEntry.isFile) {
      const fileEntry = childEntry as FileSystemFileEntry
      const file = await new Promise<File>((resolve, reject) => {
        fileEntry.file(resolve, reject)
      })
      // 只添加支持的文件类型
      if (isSupportedSourceFile(file.name)) {
        files.push(file)
      }
    } else if (childEntry.isDirectory) {
      // 递归处理子目录
      const subFiles = await traverseDirectory(childEntry as FileSystemDirectoryEntry)
      files.push(...subFiles)
    }
  }

  // 持续读取直到没有更多条目（某些浏览器分批返回）
  let entries: FileSystemEntry[]
  do {
    entries = await readEntries()
    await Promise.all(entries.map(processEntry))
  } while (entries.length > 0)

  return files
}

defineProps<{
  open: boolean
  currentCount?: number
  maxCount?: number
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'close'): void
  (e: 'add-source', payload: SourcePayload): void
}>()

/**
 * 来源数据负载接口
 */
interface SourcePayload {
  type: 'file' | 'link' | 'youtube' | 'bilibili' | 'wechat' | 'ue-project'
  content: string | File
  title?: string
  /** 网页描述(可选) */
  description?: string
  /** 原始 URL(针对网页类型) */
  sourceUrl?: string
  /** 是否正在加载 */
  loading?: boolean
}

type ModalMode = 'default' | 'link' | 'youtube' | 'bilibili' | 'wechat'

/**
 * 清洗 Bilibili 视频 URL，移除追踪参数但保留必要参数
 * 例如: https://www.bilibili.com/video/BV1rnBKB2EME/?spm_id_from=333.1007.tianma.1-1-1.click&vd_source=xxx&p=18
 * 清洗为: https://www.bilibili.com/video/BV1rnBKB2EME?p=18
 * 保留 p 参数：用于识别合集视频的具体分集
 * @param url 原始 Bilibili URL
 * @returns 清洗后的 URL
 */
const cleanBilibiliUrl = (url: string): string => {
  try {
    const urlObj = new URL(url)
    // 移除末尾的斜杠
    const basePath = (urlObj.origin + urlObj.pathname).replace(/\/+$/, '')

    // 提取需要保留的参数（p: 合集分集号）
    const preservedParams = new URLSearchParams()
    const pValue = urlObj.searchParams.get('p')
    if (pValue) {
      preservedParams.set('p', pValue)
    }

    // 如果有需要保留的参数，则附加到 URL
    const queryString = preservedParams.toString()
    return queryString ? `${basePath}?${queryString}` : basePath
  } catch {
    // 如果 URL 解析失败，返回原始值
    return url
  }
}

const { t } = useI18n()
const currentMode = ref<ModalMode>('default')
const inputValue = ref('')
/** 是否正在拖拽文件到上传区域 */
const isDragOver = ref(false)

const fileInput = ref<HTMLInputElement | null>(null)
const handleSelectFile = (): void => {
  fileInput.value?.click()
}

const handleFileChange = (e: Event): void => {
  const files = (e.target as HTMLInputElement).files
  if (!files || files.length === 0) return

  // 过滤支持的文件类型并批量发送
  const supportedFiles: File[] = []
  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    if (isSupportedSourceFile(file.name)) {
      supportedFiles.push(file)
    }
  }

  if (supportedFiles.length === 0) {
    message.warning(t('notebook.addSource.noSupportedFiles'))
    return
  }

  // 批量添加来源
  for (const file of supportedFiles) {
    emit('add-source', {
      type: 'file',
      content: file,
      title: file.name
    })
  }

  message.success(t('notebook.addSource.addedFiles', { count: supportedFiles.length }))
  handleClose()
}

/**
 * 处理拖拽进入事件
 * @param e 拖拽事件
 */
const handleDragOver = (e: DragEvent): void => {
  e.preventDefault()
  e.stopPropagation()
  isDragOver.value = true
}

/**
 * 处理拖拽离开事件
 * @param e 拖拽事件
 */
const handleDragLeave = (e: DragEvent): void => {
  e.preventDefault()
  e.stopPropagation()
  isDragOver.value = false
}

/**
 * 处理文件/文件夹拖放事件
 * 支持拖入单个文件、多个文件、文件夹或混合内容
 * @param e 拖拽事件
 */
const handleDrop = async (e: DragEvent): Promise<void> => {
  e.preventDefault()
  e.stopPropagation()
  isDragOver.value = false

  const items = e.dataTransfer?.items
  const files = e.dataTransfer?.files

  if (!items || items.length === 0) return

  // 收集所有需要处理的文件
  const allFiles: File[] = []
  const processPromises: Promise<void>[] = []

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    // 使用 webkitGetAsEntry 判断是文件还是目录
    const entry = item.webkitGetAsEntry?.()

    if (entry?.isDirectory) {
      // 处理目录：递归遍历获取所有支持的文件
      console.log(`[AddSourceModal] 检测到文件夹: ${entry.name}`)
      processPromises.push(
        traverseDirectory(entry as FileSystemDirectoryEntry).then((dirFiles) => {
          allFiles.push(...dirFiles)
        })
      )
    } else if (entry?.isFile && files && files[i]) {
      // 普通文件：检查是否支持
      const file = files[i]
      if (isSupportedSourceFile(file.name)) {
        allFiles.push(file)
      }
    }
  }

  // 等待所有目录遍历完成
  if (processPromises.length > 0) {
    message.loading({ content: t('notebook.addSource.scanning'), key: 'folder_scan' })
    try {
      await Promise.all(processPromises)
      message.destroy('folder_scan')
    } catch (error) {
      console.error('[AddSourceModal] 扫描文件夹失败:', error)
      message.error({ content: t('notebook.addSource.scanFailed'), key: 'folder_scan' })
      return
    }
  }

  if (allFiles.length === 0) {
    message.warning(t('notebook.addSource.noSupportedFiles'))
    return
  }

  // 批量添加来源
  for (const file of allFiles) {
    emit('add-source', {
      type: 'file',
      content: file,
      title: file.name
    })
  }

  message.success(t('notebook.addSource.addedFiles', { count: allFiles.length }))
  handleClose()
}

const setMode = (mode: ModalMode): void => {
  currentMode.value = mode
  inputValue.value = ''
}

const goBack = (): void => {
  currentMode.value = 'default'
  inputValue.value = ''
}

/**
 * 处理添加来源
 * 链接模式：直接添加带 loading 状态的来源，后台异步读取内容
 * YouTube 模式：同样带 loading 状态，后台异步调用 Gemini 分析
 */
const handleAdd = (): void => {
  if (!inputValue.value.trim()) return

  // 链接模式：支持批量添加，每行一个 URL
  if (currentMode.value === 'link') {
    const urls = inputValue.value
      .split('\n')
      .map((url) => url.trim())
      .filter((url) => url.length > 0)

    if (urls.length === 0) return

    for (const url of urls) {
      emit('add-source', {
        type: 'link',
        content: '', // 初始内容为空
        title: url, // 先用 URL 作为标题
        sourceUrl: url,
        loading: true // 标记为加载中
      })
    }
    handleClose()
    return
  }

  // YouTube 模式：带 loading 状态，让父组件处理异步分析
  if (currentMode.value === 'youtube') {
    emit('add-source', {
      type: 'youtube',
      content: '', // 初始内容为空
      title: inputValue.value, // 先用 URL 作为标题
      sourceUrl: inputValue.value,
      loading: true // 标记为加载中
    })
    handleClose()
    return
  }

  // Bilibili 模式：带 loading 状态，让父组件处理异步分析
  if (currentMode.value === 'bilibili') {
    const cleanedUrl = cleanBilibiliUrl(inputValue.value)
    emit('add-source', {
      type: 'bilibili',
      content: '', // 初始内容为空
      title: cleanedUrl, // 使用清洗后的 URL 作为标题
      sourceUrl: cleanedUrl, // 使用清洗后的 URL
      loading: true // 标记为加载中
    })
    handleClose()
    return
  }

  // 微信公众号模式：带 loading 状态，让父组件处理异步采集
  if (currentMode.value === 'wechat') {
    emit('add-source', {
      type: 'wechat',
      content: '', // 初始内容为空
      title: inputValue.value, // 先用 URL 作为标题
      sourceUrl: inputValue.value,
      loading: true // 标记为加载中
    })
    handleClose()
    return
  }

  // 其他模式直接添加
  emit('add-source', {
    type: currentMode.value as SourcePayload['type'],
    content: inputValue.value
  })
  handleClose()
}

const handleClose = (): void => {
  emit('update:open', false)
  emit('close')
  setTimeout(() => {
    currentMode.value = 'default'
    inputValue.value = ''
  }, 200)
}

const modeTitle = computed(() => {
  switch (currentMode.value) {
    case 'link':
      return t('notebook.addSource.modes.link')
    case 'youtube':
      return t('notebook.addSource.modes.youtube')
    case 'bilibili':
      return t('notebook.addSource.modes.bilibili')
    case 'wechat':
      return t('notebook.addSource.modes.wechat')
    default:
      return t('notebook.addSource.title')
  }
})
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="open" class="modal-overlay" @click.self="handleClose">
        <div class="modal-container">
          <!-- Header -->
          <div class="modal-header">
            <div class="header-left">
              <div v-if="currentMode === 'default'" class="app-icon">
                <div class="icon-circle">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path
                      d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"
                    />
                  </svg>
                </div>
              </div>

              <div v-if="currentMode !== 'default'" class="back-btn" @click="goBack">
                <PhArrowLeft />
              </div>

              <div class="modal-title-large">
                <PhCloudArrowUp />
                <span :class="{ 'ml-2': currentMode !== 'default' }">{{ modeTitle }}</span>
              </div>
            </div>

            <div class="header-right">
              <button class="close-btn" @click="handleClose">
                <PhX />
              </button>
            </div>
          </div>

          <!-- Default Mode Content -->
          <div v-if="currentMode === 'default'">
            <div class="modal-desc">
              {{ t('notebook.addSource.description') }}
              <div class="sub-desc">
                {{ t('notebook.addSource.examples') }}
              </div>
            </div>

            <div
              class="upload-area"
              :class="{ 'drag-over': isDragOver }"
              @click="handleSelectFile"
              @dragover="handleDragOver"
              @dragleave="handleDragLeave"
              @drop="handleDrop"
            >
              <div class="upload-content">
                <div class="upload-icon-circle">
                  <PhCloudArrowUp />
                </div>
                <div class="upload-title">{{ t('notebook.addSource.upload.title') }}</div>
                <div class="upload-hint">
                  {{ t('notebook.addSource.upload.dragHint') }}
                  <span class="link-text">{{ t('notebook.addSource.upload.selectFile') }}</span
                  >{{ t('notebook.addSource.upload.suffix') }}
                </div>
                <div class="supported-types">
                  {{ t('notebook.addSource.upload.supportedTypes') }}
                </div>
              </div>
              <input
                ref="fileInput"
                type="file"
                style="display: none"
                multiple
                @change="handleFileChange"
              />
            </div>

            <div class="source-options">
              <div class="option-col">
                <div class="col-header"><PhLink /> {{ t('notebook.addSource.links.title') }}</div>
                <div class="col-items">
                  <div class="option-item" @click="setMode('link')">
                    <div class="option-icon"><PhGlobe /></div>
                    <span>{{ t('notebook.addSource.links.website') }}</span>
                  </div>
                  <!--
                    B 站 / YouTube 走 BYOK：YouTube 用用户自己的 Gemini Key，
                    B 站先在本地解析出真实播放地址再交给通义千问。
                    缺 Key 时给的是「去哪配哪家」，不是「不可用」，所以无条件渲染。
                  -->
                  <div class="option-item" @click="setMode('youtube')">
                    <div class="option-icon"><PhYoutubeLogo /></div>
                    <span>YouTube</span>
                  </div>
                  <div class="option-item" @click="setMode('bilibili')">
                    <div class="option-icon">
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
                        <path
                          d="M17.813 4.653h.854c1.51.054 2.769.578 3.773 1.574 1.004.995 1.524 2.249 1.56 3.76v7.36c-.036 1.51-.556 2.769-1.56 3.773s-2.262 1.524-3.773 1.56H5.333c-1.51-.036-2.769-.556-3.773-1.56S.036 18.858 0 17.347v-7.36c.036-1.511.556-2.765 1.56-3.76 1.004-.996 2.262-1.52 3.773-1.574h.774l-1.174-1.12a1.234 1.234 0 0 1-.373-.906c0-.356.124-.659.373-.907l.027-.027c.267-.249.573-.373.92-.373.347 0 .653.124.92.373L9.653 4.44c.071.071.134.142.187.213h4.267a.836.836 0 0 1 .16-.213l2.853-2.747c.267-.249.573-.373.92-.373.347 0 .662.151.929.4.267.249.391.551.391.907 0 .355-.124.657-.373.906l-1.174 1.12zm-1.12 4.04h-9.12c-.667 0-1.2.533-1.2 1.2v7.2c0 .667.533 1.2 1.2 1.2h9.12c.667 0 1.2-.533 1.2-1.2v-7.2c0-.667-.533-1.2-1.2-1.2zm-6.24 1.8a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8zm4.8 0a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8z"
                        />
                      </svg>
                    </div>
                    <span>Bilibili</span>
                  </div>
                  <div class="option-item" @click="setMode('wechat')">
                    <div class="option-icon">
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
                        <path
                          d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178A1.17 1.17 0 0 1 4.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178 1.17 1.17 0 0 1-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-1.797-.052-3.746.512-5.28 1.786-1.72 1.428-2.687 3.72-1.78 6.22.942 2.453 3.666 4.229 6.884 4.229.826 0 1.622-.12 2.361-.336a.722.722 0 0 1 .598.082l1.584.926a.272.272 0 0 0 .14.047c.134 0 .24-.111.24-.247 0-.06-.023-.12-.038-.177l-.327-1.233a.582.582 0 0 1-.023-.156.49.49 0 0 1 .201-.398C23.024 18.48 24 16.82 24 14.98c0-3.21-2.931-5.837-6.656-6.088V8.89c-.135-.01-.269-.03-.407-.03v-.002zm-2.53 3.274c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.97-.982zm4.844 0c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.969-.982z"
                        />
                      </svg>
                    </div>
                    <span>{{ t('notebook.addSource.links.wechat') }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Sub Modes Content -->
          <div v-else class="mode-content">
            <div class="input-wrapper">
              <div v-if="currentMode === 'link'" class="input-group">
                <label>网址</label>
                <a-textarea
                  v-model:value="inputValue"
                  placeholder="https://example.com&#10;https://example.org&#10;https://example.net"
                  :rows="4"
                  :auto-size="{ minRows: 3, maxRows: 8 }"
                  size="large"
                />
                <div class="input-hint">
                  支持批量添加，每行输入一个公开网页 URL，将自动读取网页内容
                </div>
              </div>

              <div v-else-if="currentMode === 'youtube'" class="input-group">
                <label>YouTube URL</label>
                <a-input
                  v-model:value="inputValue"
                  placeholder="https://youtube.com/watch?v=..."
                  size="large"
                  @press-enter="handleAdd"
                />
                <div class="input-hint">输入 YouTube 视频链接</div>
              </div>

              <div v-else-if="currentMode === 'bilibili'" class="input-group">
                <label>Bilibili URL</label>
                <a-input
                  v-model:value="inputValue"
                  placeholder="https://www.bilibili.com/video/BV..."
                  size="large"
                  @press-enter="handleAdd"
                />
                <div class="input-hint">
                  输入 Bilibili
                  视频链接，将自动公开分析视频内容，该功能为第三方提供的实验功能，不保证可用性
                </div>
              </div>

              <div v-else-if="currentMode === 'wechat'" class="input-group">
                <label>微信公众号文章链接</label>
                <a-input
                  v-model:value="inputValue"
                  placeholder="https://mp.weixin.qq.com/s/..."
                  size="large"
                  @press-enter="handleAdd"
                />
                <div class="input-hint">
                  输入微信公众号文章链接，将自动提取文章内容并转换为 Markdown 格式
                </div>
              </div>
            </div>

            <div class="mode-actions">
              <AppButton class="cancel-btn" @click="goBack">取消</AppButton>
              <AppButton variant="primary" :disabled="!inputValue.trim()" @click="handleAdd">
                添加
              </AppButton>
            </div>
          </div>

          <!-- Footer Limit -->
          <div class="modal-footer">
            <div class="limit-info">
              <div class="limit-icon"><PhDatabase /></div>
              <span>{{ t('notebook.addSource.sourceLimit') }}</span>
            </div>
            <div class="limit-bar-wrapper">
              <div
                class="limit-bar"
                :style="{ width: `${((currentCount || 0) / (maxCount || 100)) * 100}%` }"
              ></div>
            </div>
            <div class="limit-count">{{ currentCount || 0 }}/{{ maxCount || 100 }}</div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped lang="less">
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: var(--color-bg-scrim);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-container {
  width: 1200px;
  max-width: 95vw;
  max-height: 90vh;
  border-radius: 24px;
  box-shadow: 0 8px 32px var(--shadow-color);
  background: var(--color-bg-surface-hover);
  padding: 32px;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  color: var(--color-text-primary);
  border: 1px solid var(--color-border-subtle);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
  height: 40px;

  .header-left {
    display: flex;
    align-items: center;

    .back-btn {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      color: var(--color-text-primary);
      transition: background 0.2s;

      &:hover {
        background: var(--color-bg-surface-hover);
      }
    }

    .app-icon {
      display: flex;
      flex-direction: column;
      gap: 2px;

      .icon-circle {
        color: var(--color-accent-text);
        display: none;
      }
      .app-name {
        font-size: 14px;
        color: var(--color-text-primary);
        font-weight: 500;
        opacity: 0.7;
      }
    }

    .modal-title-large {
      font-size: 24px;
      font-weight: 500;
      color: var(--color-text-primary);
    }
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 12px;

    .close-btn {
      background: transparent;
      border: none;
      color: var(--color-text-secondary);
      font-size: 18px;
      cursor: pointer;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;

      &:hover {
        background: var(--color-bg-surface-hover);
      }
    }
  }
}

.modal-desc {
  font-size: 14px;
  color: var(--color-text-secondary);
  margin-bottom: 24px;
  line-height: 1.5;

  .sub-desc {
    color: var(--color-text-secondary);
    margin-top: 4px;
  }
}

.upload-area {
  border: 1px dashed var(--color-border);
  border-radius: 12px;
  padding: 48px;
  display: flex;
  justify-content: center;
  align-items: center;
  margin-bottom: 24px;
  cursor: pointer;
  transition: all 0.2s;
  background: var(--color-bg-surface-hover);

  &:hover {
    background: var(--color-bg-surface-hover);
    border-color: var(--color-border-strong);
  }

  &.drag-over {
    background: var(--color-accent-bg);
    border-color: var(--color-accent-border);
    border-style: solid;

    .upload-icon-circle {
      transform: scale(1.1);
      background: var(--color-accent-bg);
    }
  }

  .upload-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;

    .upload-icon-circle {
      width: 40px;
      height: 40px;
      background: var(--color-accent-bg);
      color: var(--color-accent-text);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      margin-bottom: 12px;
    }

    .upload-title {
      font-size: 16px;
      font-weight: 500;
      color: var(--color-text-primary);
      margin-bottom: 4px;
    }

    .upload-hint {
      font-size: 14px;
      color: var(--color-text-secondary);
      margin-bottom: 24px;

      .link-text {
        color: var(--color-accent-text);
        font-weight: 500;
      }
    }

    .supported-types {
      font-size: 12px;
      color: var(--color-text-secondary);
      max-width: 600px;
      line-height: 1.4;
    }
  }
}

.source-options {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
  background: var(--color-bg-surface-hover);
  border-radius: 12px;
  padding: 24px;
  border: 1px solid var(--color-border-subtle);
  margin-bottom: 24px;

  .option-col {
    display: flex;
    flex-direction: column;
    gap: 12px;

    .col-header {
      font-size: 13px;
      font-weight: 500;
      color: var(--color-text-primary);
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;
    }

    .option-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 12px;
      border: 1px solid var(--color-border-subtle);
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s;

      &:hover {
        background: var(--color-bg-surface-hover);
        border-color: var(--color-border);
      }

      .option-icon {
        width: 20px;
        height: 20px;
        background: var(--color-bg-raised);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        color: var(--color-text-primary);
      }

      span {
        font-size: 13px;
        color: var(--color-text-primary);
        font-weight: 500;
      }
    }
  }
}

.mode-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 0 0 24px 0;

  .input-wrapper {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 16px;

    .input-group {
      display: flex;
      flex-direction: column;
      gap: 8px;

      label {
        font-size: 14px;
        color: var(--color-text-secondary);
      }

      .input-hint {
        font-size: 12px;
        color: var(--color-text-secondary);
      }
    }
  }

  .mode-actions {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    margin-top: 24px;

    .cancel-btn {
      background: transparent;
      color: var(--color-text-primary);
      border: 1px solid var(--color-border-subtle);

      &:hover {
        border-color: var(--color-border);
      }
    }
  }
}

.modal-footer {
  display: flex;
  align-items: center;
  background: var(--color-bg-surface-hover);
  border-radius: 12px;
  padding: 12px 16px;
  gap: 16px;
  border: 1px solid var(--color-border-subtle);

  .limit-info {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--color-text-primary);
  }

  .limit-bar-wrapper {
    flex: 1;
    height: 4px;
    background: var(--color-bg-raised);
    border-radius: 2px;
    overflow: hidden;

    .limit-bar {
      height: 100%;
      background: var(--color-accent-solid);
    }
  }

  .limit-count {
    font-size: 12px;
    color: var(--color-text-secondary);
  }
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
