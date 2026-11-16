import { execFile } from 'node:child_process'
import { existsSync, readdirSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface GodotInfo {
  path: string
  /** `godot --version` 的输出，比如 "4.7.1.stable.official.a13da4feb" */
  version: string
}

/**
 * 找 Godot。它是绿色版单文件，没有注册表可查，只能按常见安装位置挨个试。
 * 每个候选都跑一次 `--version` 确认真能用、而且是 4.x。
 */
export async function locateGodot(preferred?: string): Promise<GodotInfo | null> {
  for (const candidate of await candidates(preferred)) {
    const info = await probeGodot(candidate)
    if (info) return info
  }
  return null
}

/**
 * 首页「引擎版本」：自动能找到的和用户手动加的全列出来。
 * - 自动找到的换成链接指向的实际 exe（winget 的 Links 下全是链接），同一个文件只算一个；
 * - 同一版本带的 `_console.exe` 只是套了个控制台窗口，不单列；
 * - `extra` 原样保留、放前面，同一个文件既被手动加过又能自动找到时按手动算。
 */
export async function listGodots(extra: string[] = []): Promise<GodotInfo[]> {
  const seen = new Set<string>()
  const paths: string[] = []
  const auto = (await candidates()).filter((p) => !isConsoleBuild(p)).map(realPath)
  for (const p of [...extra, ...auto]) {
    const key = fileKey(realPath(p))
    if (seen.has(key)) continue
    seen.add(key)
    paths.push(p)
  }
  const infos = await Promise.all(paths.map((p) => probeGodot(p)))
  return infos.filter((info): info is GodotInfo => info !== null)
}

function isConsoleBuild(p: string): boolean {
  return /console\.exe$/i.test(realPath(p))
}

function realPath(p: string): string {
  try {
    return realpathSync(p)
  } catch {
    // 不存在的文件照原样算，探测那一步会把它刷掉
    return p
  }
}

function fileKey(p: string): string {
  return process.platform === 'win32' ? p.toLowerCase() : p
}

export async function probeGodot(input: string): Promise<GodotInfo | null> {
  if (!input) return null
  // macOS 上用户在文件对话框里选的是 Godot.app，能跑的是包里那个可执行文件
  const path = /\.app\/?$/i.test(input) ? join(input, 'Contents', 'MacOS', 'Godot') : input
  const output = await new Promise<string | null>((resolve) => {
    execFile(path, ['--version'], { timeout: 15_000, windowsHide: true }, (err, stdout) => {
      resolve(err ? null : stdout.trim())
    })
  })
  if (!output) return null
  const version = output.split(/\r?\n/).pop()?.trim() ?? ''
  if (!/^4\.\d+/.test(version)) return null
  return { path, version }
}

async function candidates(preferred?: string): Promise<string[]> {
  const list: string[] = []
  if (preferred) list.push(preferred)
  list.push(...(await onPath()))

  const local = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
  // winget：Links 下是转发到实际安装位置的链接
  list.push(join(local, 'Microsoft', 'WinGet', 'Links', 'godot.exe'))
  list.push(...exesUnder(join(local, 'Microsoft', 'WinGet', 'Packages'), /^GodotEngine\./i))
  // scoop
  list.push(...exesIn(join(homedir(), 'scoop', 'apps', 'godot', 'current')))
  // Steam
  for (const steam of ['C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam']) {
    list.push(...exesIn(join(steam, 'steamapps', 'common', 'Godot Engine')))
  }
  return [...new Set(list)].filter((p) => existsSync(p))
}

function onPath(): Promise<string[]> {
  return new Promise((resolve) => {
    const cmd = process.platform === 'win32' ? 'where' : 'which'
    execFile(cmd, ['godot'], { timeout: 5_000, windowsHide: true }, (err, stdout) => {
      resolve(
        err
          ? []
          : stdout
              .split(/\r?\n/)
              .map((s) => s.trim())
              .filter(Boolean)
      )
    })
  })
}

/** 目录里名字像 Godot 编辑器的 exe；优先不带 console 的那个。 */
export function exesIn(dir: string): string[] {
  if (!existsSync(dir)) return []
  try {
    const exes = readdirSync(dir).filter((f) => /^godot.*\.exe$/i.test(f))
    exes.sort((a, b) => Number(/console/i.test(a)) - Number(/console/i.test(b)))
    return exes.map((f) => join(dir, f))
  } catch {
    return []
  }
}

function exesUnder(root: string, dirPattern: RegExp): string[] {
  if (!existsSync(root)) return []
  try {
    return readdirSync(root)
      .filter((d) => dirPattern.test(d))
      .flatMap((d) => exesIn(join(root, d)))
  } catch {
    return []
  }
}
