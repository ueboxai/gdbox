interface VaultBrowseConfig {
  vaultType?: string
  networkPath?: string
  browsePath?: string
}

/**
 * 界面上的 UNC 路径例子和前缀。走 i18n 插值传进去：写进语言包的话，
 * vue-i18n 编译消息时会吃掉反斜杠。
 */
export const UNC_PATH_EXAMPLE = '\\\\192.168.1.100\\Assets'
export const UNC_PATH_PREFIX = '\\\\'
/** 资产库名称里不允许的字符，同样走插值（`|` 在 vue-i18n 里是复数分隔符） */
export const VAULT_NAME_INVALID_CHARS = '< > : " / \\ | ? *'

const HTTP_URL_RE = /^https?:\/\//i
const WINDOWS_DRIVE_RE = /^[a-zA-Z]:[\\/]/

const isWindowsLikePath = (value: string): boolean =>
  WINDOWS_DRIVE_RE.test(value) || value.startsWith('\\\\') || value.startsWith('//')

export const isHttpUrl = (value?: string | null): boolean =>
  HTTP_URL_RE.test(String(value || '').trim())

export const isBrowsableAbsolutePath = (value: string): boolean => {
  const trimmed = String(value || '').trim()
  if (!trimmed) return false
  return isWindowsLikePath(trimmed) || trimmed.startsWith('/')
}

export const getNetworkBrowseBasePath = (vault?: VaultBrowseConfig | null): string | null => {
  if (!vault || vault.vaultType !== 'network') return null

  const browsePath = String(vault.browsePath || '').trim()
  if (browsePath) return browsePath

  const networkPath = String(vault.networkPath || '').trim()
  if (!networkPath || isHttpUrl(networkPath)) return null

  return networkPath
}

export const normalizeVaultRelativePath = (value?: string | null): string => {
  let normalized = String(value || '').trim()
  if (!normalized) return ''

  normalized = normalized.replace(/^[\\/]+/, '')
  if (normalized === 'ALL') return ''

  if (normalized.startsWith('ALL/') || normalized.startsWith('ALL\\')) {
    normalized = normalized.slice(4)
  }

  return normalized.replace(/^[\\/]+/, '')
}

export const buildBrowsePath = (basePath: string, relativePath?: string | null): string => {
  const trimmedBase = String(basePath || '').trim()
  if (!trimmedBase) return ''

  const normalizedRelative = normalizeVaultRelativePath(relativePath)
  const windowsLike = isWindowsLikePath(trimmedBase)
  const sep = windowsLike ? '\\' : '/'
  const normalizedBase = windowsLike ? trimmedBase.replace(/\//g, '\\') : trimmedBase
  const cleanBase = normalizedBase.replace(/[\\/]+$/, '')

  if (!normalizedRelative) {
    return cleanBase || normalizedBase
  }

  const cleanRelative = normalizedRelative.replace(/[\\/]+/g, sep)
  return `${cleanBase}${sep}${cleanRelative}`
}

/**
 * 打开一个网络库文件夹对应的本地目录，并把失败**说出来**。
 *
 * 原来两处调用都是 `await window.api.shell.openPath(path)` 然后把返回值丢掉。
 * 主进程那边其实分得很细（`{ success, error, pathNotFound }`，见 ipc/shell.ts），
 * 但渲染层一个都没看 —— 于是「浏览路径填错了 / 共享没挂上」的结果是**点了完全没反应**，
 * 用户只能怀疑是按钮坏了。这是用户实际报上来的现象。
 *
 * 路径要带进提示里：这个功能十次失败九次是那个 SMB 路径本身不对，
 * 把盒子拼出来的完整路径给他看，他自己就知道该改哪儿。
 */
export const openBrowsePath = async (
  physicalPath: string,
  deps: {
    openPath: (
      path: string
    ) => Promise<{ success: boolean; error?: string; pathNotFound?: boolean }>
    onNotFound: (path: string) => void
    onFailed: (path: string, error: string) => void
  }
): Promise<boolean> => {
  const result = await deps.openPath(physicalPath)
  if (result?.success) return true

  if (result?.pathNotFound) {
    deps.onNotFound(physicalPath)
  } else {
    deps.onFailed(physicalPath, result?.error || '')
  }
  return false
}

export const pathStartsWithBase = (
  candidate?: string | null,
  basePath?: string | null
): boolean => {
  const normalizedCandidate = String(candidate || '')
    .trim()
    .replace(/[\\/]+/g, '/')
    .toLowerCase()
  const normalizedBase = String(basePath || '')
    .trim()
    .replace(/[\\/]+/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase()

  if (!normalizedCandidate || !normalizedBase) return false

  return (
    normalizedCandidate === normalizedBase || normalizedCandidate.startsWith(`${normalizedBase}/`)
  )
}
