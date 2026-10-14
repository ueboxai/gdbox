import { execFile } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
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
      resolve(err ? [] : stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean))
    })
  })
}

/** 目录里名字像 Godot 编辑器的 exe；优先不带 console 的那个。 */
function exesIn(dir: string): string[] {
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
