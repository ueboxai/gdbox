/**
 * 读 project.godot。
 *
 * 它是 Godot 自己的 ConfigFile 格式（类 INI）：`[section]` 下面是 `key=value`，
 * 值是 Variant 字面量。这里只取工程库要显示的三项，不做完整解析。
 */

export interface ProjectFileSummary {
  name?: string
  /** config/features 里第一个形如 "4.7" 的版本号 */
  engineVersion?: string
  /** config/icon，res:// 路径 */
  icon?: string
}

export function parseProjectFile(text: string): ProjectFileSummary {
  const out: ProjectFileSummary = {}
  let section = ''
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith(';')) continue
    const sec = /^\[([^\]]+)\]$/.exec(line)
    if (sec) {
      section = sec[1]
      continue
    }
    if (section !== 'application') continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1).trim()
    if (key === 'config/name') out.name = readString(value)
    else if (key === 'config/icon') out.icon = readString(value)
    else if (key === 'config/features') {
      const match = /"(\d+\.\d+)"/.exec(value)
      if (match) out.engineVersion = match[1]
    }
  }
  return out
}

/** Godot 的字符串字面量：双引号包起来，内部 \" 和 \\ 转义。 */
function readString(value: string): string | undefined {
  const m = /^"((?:[^"\\]|\\.)*)"/.exec(value)
  if (!m) return undefined
  return m[1].replace(/\\(.)/g, '$1')
}
