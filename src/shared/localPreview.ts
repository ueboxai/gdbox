/**
 * 内置浏览器能直接显示哪些本地文件。
 *
 * 主进程按这张表决定一个本地文件能不能在浏览器里打开、回什么 Content-Type；
 * 渲染层按它决定对话里点一条路径是在浏览器面板里看，还是交给系统默认程序。
 * 两边必须是同一张表，否则会出现「点了进面板，面板说打不开」。
 *
 * 只列 Chromium 自己能渲染的类型。表外的文件（Office 文档、模型、压缩包）
 * 浏览器只会触发下载，而下载在这个浏览器里是关掉的。
 */
const TEXT = 'text/plain; charset=utf-8'

const PREVIEW_TYPES: Record<string, string> = {
  // 不带 charset：让页面自己的 <meta charset> 说了算
  html: 'text/html',
  htm: 'text/html',
  pdf: 'application/pdf',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  txt: TEXT,
  md: TEXT,
  log: TEXT,
  csv: TEXT,
  ini: TEXT,
  yaml: TEXT,
  yml: TEXT,
  json: 'application/json; charset=utf-8',
  xml: 'text/xml; charset=utf-8'
}

function extensionOf(path: string): string {
  const name = String(path).split(/[\\/]/).pop() ?? ''
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/** 能在内置浏览器里显示时返回 Content-Type，否则 undefined */
export function localPreviewType(path: string): string | undefined {
  return PREVIEW_TYPES[extensionOf(path)]
}

/**
 * `file://` 地址还原成用户认得的路径，地址栏里显示和编辑都用它。
 * 不是 `file://` 返回 null。
 * @param href 地址
 * @param windows 是否按 Windows 的写法（反斜杠）显示
 */
export function filePathOfUrl(href: string, windows: boolean): string | null {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  if (url.protocol !== 'file:') return null
  let path: string
  try {
    path = decodeURIComponent(url.pathname)
  } catch {
    path = url.pathname
  }
  if (url.host) path = `//${url.host}${path}`
  else if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1)
  return windows ? path.replace(/\//g, '\\') : path
}

/**
 * 对话里左键点这条路径时，是不是在浏览器面板里打开。
 *
 * 网页、PDF、图片和音视频是「拿来看」的，进面板；纯文本、JSON 这类用户多半
 * 要改，仍交给系统默认程序（通常是编辑器）。
 */
export function opensInBrowserPane(path: string): boolean {
  const type = localPreviewType(path)
  if (!type) return false
  return type === 'text/html' || type === 'application/pdf' || /^(?:image|video|audio)\//.test(type)
}
