import { randomBytes } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, parse, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { localPreviewType } from '../../../shared/localPreview'
import { serveLocalFile } from '../../utils/localResourceServer'
import { checkNavigationUrl, type UrlCheckResult } from './urlPolicy'

/**
 * 内置浏览器里看本机文件：Agent 生成的网页、PDF、图片、音视频。
 *
 * ## 为什么不直接放开 `file:`
 *
 * 浏览器同样会打开不受信任的网页。放开 `file:`，任何网页都能借一次跳转或
 * `<iframe>` 去读本机文件。所以本机文件走一个只挂在浏览器分区上的专用协议：
 *
 *     gdbox-file://<授权号>/<文件名>
 *
 * - **只有 `open()` 能授权**，也就是 Agent 的 `browser_open`、用户的地址栏和
 *   对话里点路径。页面自己的跳转、`window.open`、跟随链接一律只认已授权的地址。
 * - **网页授权它所在的文件夹**：旁边的 CSS、脚本、图片要能按相对路径加载。
 *   读不到文件夹以外的东西（符号链接、联接按真实位置算），也不提供以 `.` 开头的
 *   文件和目录（`.git`、`.env`）。文件夹是盘符根目录或用户主目录时只授权网页本身。
 * - **PDF、图片、音视频、纯文本只授权文件本身**：它们用不到旁边的文件。
 * - **授权号是随机的**，每个文件夹一个、各自一个源：网页猜不到别的文件夹的地址，
 *   一个文件夹里的页面也读不到另一个文件夹的文件。授权只在本次运行里有效；
 *   会话恢复时存的是 `file://` 地址，重新走一遍 `open()` 授权。
 *
 * 界面和模型看到的一律是 `file://` 地址（`displayUrl`），`gdbox-file://` 只在页面内部用。
 */

export const LOCAL_FILE_SCHEME = 'gdbox-file'

/** 网页的附属文件。只用来回 Content-Type，不能单独打开 */
const ASSET_TYPES: Record<string, string> = {
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  map: 'application/json; charset=utf-8',
  wasm: 'application/wasm',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
  vtt: 'text/vtt; charset=utf-8'
}

interface Grant {
  root: string
  /** 只授权这一个文件时是它的文件名 */
  only?: string
}

/** 授权号 → 授权范围 */
const grants = new Map<string, Grant>()
/** 授权范围 → 授权号。同一个文件夹里的几个页面共用一个源，相互的链接才走得通 */
const grantIds = new Map<string, string>()
/** 网页是不是合法 UTF-8，按路径记，文件改了重算 */
const charsets = new Map<string, { mtimeMs: number; size: number; utf8: boolean }>()

function rootKey(dir: string): string {
  return process.platform === 'win32' ? dir.toLowerCase() : dir
}

/** 盘符根目录和用户主目录：把整个文件夹交给一个网页等于交出整个盘或整个用户资料 */
function isBroadFolder(dir: string): boolean {
  return dir === parse(dir).root || rootKey(dir) === rootKey(homedir())
}

function isInside(root: string, path: string): boolean {
  const inside = relative(root, path)
  return !inside.startsWith('..') && !isAbsolute(inside)
}

export class LocalFileError extends Error {}

/**
 * 地址栏或 `browser_open` 收到的是不是本机文件。是就返回路径，否则 null。
 *
 * 认 `file://` 地址；Windows 上认盘符路径（`C:\`、`C:/`）和 UNC 路径，
 * macOS / Linux 上认 `/` 开头的绝对路径。
 */
export function localPathFromAddress(raw: string): string | null {
  const input = raw.trim()
  if (/^file:/i.test(input)) {
    try {
      return fileURLToPath(input)
    } catch {
      return null
    }
  }
  if (process.platform !== 'win32') return /^\/(?!\/)/.test(input) ? input : null
  if (/^[A-Za-z]:[\\/]/.test(input) || /^\\\\[^\\/]+[\\/]/.test(input)) return input
  return null
}

/**
 * 授权一个本地文件（网页连同它所在的文件夹），返回浏览器该加载的地址。
 *
 * 文件不存在、是文件夹、或者浏览器显示不了这种类型时抛 `LocalFileError`，
 * 文案直接给模型和用户看。
 */
export async function grantLocalFile(filePath: string): Promise<URL> {
  const full = resolve(filePath)
  const info = await stat(full).catch(() => null)
  if (!info) throw new LocalFileError(`文件不存在：${full}`)
  if (!info.isFile()) throw new LocalFileError(`这是文件夹，不是文件：${full}`)
  const type = localPreviewType(full)
  if (!type) {
    throw new LocalFileError(
      `浏览器显示不了 ${extname(full) || '无扩展名的'} 文件：${full}。` +
        '可以打开网页、PDF、图片、音视频和纯文本。'
    )
  }

  const root = dirname(full)
  const name = basename(full)
  const grant: Grant =
    type === 'text/html' && !isBroadFolder(root) ? { root } : { root, only: name }
  const key = grant.only ? `file:${rootKey(full)}` : `dir:${rootKey(root)}`
  let id = grantIds.get(key)
  if (!id) {
    id = randomBytes(16).toString('hex')
    grantIds.set(key, id)
    grants.set(id, grant)
  }
  return new URL(`${LOCAL_FILE_SCHEME}://${id}/${encodeURIComponent(name)}`)
}

/** 一个已授权的 `gdbox-file://` 地址指向哪个文件、在哪份授权里。不是、没授权或越界都返回 null */
function resolveGrant(url: string | URL): { grant: Grant; path: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${LOCAL_FILE_SCHEME}:`) return null
  const grant = grants.get(parsed.hostname)
  if (!grant) return null

  let segments: string[]
  try {
    segments = parsed.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  } catch {
    return null
  }
  // `.` 开头的一律不给：既挡 `..`，也挡 `.git`、`.env` 这类不该被网页读到的东西
  if (segments.some((segment) => /^\.|[\\:\0]/.test(segment))) return null

  if (grant.only && (segments.length !== 1 || rootKey(segments[0]) !== rootKey(grant.only))) {
    return null
  }

  const full = join(grant.root, ...segments)
  if (!isInside(grant.root, full)) return null
  return { grant, path: full }
}

/** 一个已授权的 `gdbox-file://` 地址指向哪个文件。不是、没授权或越界都返回 null */
export function localPathOf(url: string | URL): string | null {
  return resolveGrant(url)?.path ?? null
}

/** 页面里的跳转、新窗口、跟随链接用的校验：已授权的本机地址放行，其余按网址策略 */
export function checkBrowserUrl(raw: string): UrlCheckResult {
  if (localPathOf(raw) !== null) return { ok: true, url: new URL(raw) }
  return checkNavigationUrl(raw)
}

/** 给界面、模型和会话存档看的地址：`gdbox-file://` 换回 `file://`，其余原样 */
export function displayUrl(url: string): string {
  const path = localPathOf(url)
  if (path === null) return url
  const parsed = new URL(url)
  return `${pathToFileURL(path).href}${parsed.search}${parsed.hash}`
}

/**
 * 网页的编码。
 *
 * 没写 `<meta charset>` 的网页，Chromium 会按 Windows-1252 猜，中文全成乱码 ——
 * Agent 写的网页常常不带这一行。整份文件是合法 UTF-8 就声明 UTF-8；不是的话
 * （GBK 之类）一定写了自己的 meta，交给页面。
 */
async function withHtmlCharset(path: string, type: string): Promise<string> {
  if (type !== 'text/html') return type
  const info = await stat(path).catch(() => null)
  if (!info) return type
  let known = charsets.get(path)
  if (!known || known.mtimeMs !== info.mtimeMs || known.size !== info.size) {
    let utf8 = true
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(await readFile(path))
    } catch {
      utf8 = false
    }
    known = { mtimeMs: info.mtimeMs, size: info.size, utf8 }
    charsets.set(path, known)
  }
  return known.utf8 ? 'text/html; charset=utf-8' : type
}

/**
 * 按真实位置再查一遍越界：文件夹里的符号链接、联接可能指到外面去。
 * 只授权一个文件时不查 —— 那个文件是用户自己点开的。
 */
async function realPathInside(grant: Grant, path: string): Promise<string | null> {
  const real = await realpath(path).catch(() => null)
  if (real === null || grant.only) return real
  const root = await realpath(grant.root).catch(() => null)
  return root !== null && isInside(root, real) ? real : null
}

/** `gdbox-file://` 的协议处理，只装在浏览器自己的分区上 */
export async function handleLocalFileRequest(request: Request): Promise<Response> {
  const resolved = resolveGrant(request.url)
  const path = resolved && (await realPathInside(resolved.grant, resolved.path))
  if (!path) return new Response('Not found', { status: 404 })

  const response = await serveLocalFile(path, request.headers.get('range'))
  if (response.status === 200 || response.status === 206) {
    const type = localPreviewType(path) ?? ASSET_TYPES[extname(path).slice(1).toLowerCase()]
    if (type) response.headers.set('Content-Type', await withHtmlCharset(path, type))
    // Agent 改完文件用户点刷新，要看到的是新的那份
    response.headers.set('Cache-Control', 'no-store')
  }
  return response
}

/** 仅供测试：清掉本次运行的授权 */
export function resetLocalFileGrants(): void {
  grants.clear()
  grantIds.clear()
  charsets.clear()
}
