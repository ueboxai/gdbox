/**
 * Godot 自己记的工程名单 —— 项目管理器里那份列表。
 *
 * 存在用户数据目录的 `projects.cfg` 里（Windows 是 `%APPDATA%\Godot`，macOS 是
 * `~/Library/Application Support/Godot`，Linux 是 `~/.local/share/godot`）。
 * 格式是 ConfigFile：每个工程一段 `[<工程目录>]`，下面只有 `favorite=` 之类的标记。
 *
 * 名单里没有「最近打开时间」—— Godot 的项目管理器自己也是拿工程目录下
 * `.godot/` 的修改时间排序的，这里照做。
 */
import { promises as fs } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

export interface GodotRecentProject {
  /** 工程目录 */
  projectPath: string
  favorite: boolean
  /** ISO 时间；读不到就是空串 */
  lastOpenTime: string
}

export function godotUserDataDir(): string {
  if (process.platform === 'win32') {
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Godot')
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Godot')
  }
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'godot')
}

/** 解析 projects.cfg：段名就是工程目录 */
export function parseProjectsCfg(text: string): { projectPath: string; favorite: boolean }[] {
  const projects: { projectPath: string; favorite: boolean }[] = []
  let current: { projectPath: string; favorite: boolean } | undefined
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    const section = /^\[(.+)\]$/.exec(line)
    if (section) {
      current = { projectPath: section[1], favorite: false }
      projects.push(current)
    } else if (current && /^favorite\s*=\s*true$/i.test(line)) {
      current.favorite = true
    }
  }
  return projects
}

async function mtimeIso(path: string): Promise<string> {
  try {
    return (await fs.stat(path)).mtime.toISOString()
  } catch {
    return ''
  }
}

/** 名单上还在盘上的工程，按最近修改时间倒序 */
export async function readGodotRecentProjects(
  dataDir = godotUserDataDir()
): Promise<GodotRecentProject[]> {
  let text: string
  try {
    text = await fs.readFile(join(dataDir, 'projects.cfg'), 'utf8')
  } catch {
    return []
  }
  const entries = await Promise.all(
    parseProjectsCfg(text).map(async (entry) => {
      const projectFile = join(entry.projectPath, 'project.godot')
      const exists = await fs
        .access(projectFile)
        .then(() => true)
        .catch(() => false)
      if (!exists) return undefined
      const lastOpenTime =
        (await mtimeIso(join(entry.projectPath, '.godot'))) || (await mtimeIso(projectFile))
      return { ...entry, lastOpenTime }
    })
  )
  return entries
    .filter((entry): entry is GodotRecentProject => Boolean(entry))
    .sort((a, b) => b.lastOpenTime.localeCompare(a.lastOpenTime))
}
