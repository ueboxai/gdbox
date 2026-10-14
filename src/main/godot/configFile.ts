/**
 * 改 project.godot 这类 Godot ConfigFile 文本里的单个键，其余内容原样保留。
 */

export function getConfigValue(text: string, section: string, key: string): string | undefined {
  const lines = text.split(/\r?\n/)
  let current = ''
  for (const line of lines) {
    const sec = /^\s*\[([^\]]+)\]\s*$/.exec(line)
    if (sec) {
      current = sec[1]
      continue
    }
    if (current !== section) continue
    const eq = line.indexOf('=')
    if (eq > 0 && line.slice(0, eq).trim() === key) return line.slice(eq + 1).trim()
  }
  return undefined
}

/** 设置键值；段不存在就在文件末尾新建。value 是 Godot 字面量（字符串要自带引号）。 */
export function setConfigValue(text: string, section: string, key: string, value: string): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  let current = ''
  let sectionEnd = -1
  for (let i = 0; i < lines.length; i++) {
    const sec = /^\s*\[([^\]]+)\]\s*$/.exec(lines[i])
    if (sec) {
      if (current === section) break
      current = sec[1]
      if (current === section) sectionEnd = i + 1
      continue
    }
    if (current !== section) continue
    const eq = lines[i].indexOf('=')
    if (eq > 0 && lines[i].slice(0, eq).trim() === key) {
      lines[i] = `${key}=${value}`
      return lines.join(eol)
    }
    if (lines[i].trim()) sectionEnd = i + 1
  }
  if (sectionEnd < 0) {
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
    lines.push('', `[${section}]`, '', `${key}=${value}`, '')
    return lines.join(eol)
  }
  lines.splice(sectionEnd, 0, `${key}=${value}`)
  return lines.join(eol)
}

/** 读 [section] 下所有键值。 */
export function sectionEntries(text: string, section: string): [string, string][] {
  const out: [string, string][] = []
  let current = ''
  for (const line of text.split(/\r?\n/)) {
    const sec = /^\s*\[([^\]]+)\]\s*$/.exec(line)
    if (sec) {
      current = sec[1]
      continue
    }
    if (current !== section) continue
    const eq = line.indexOf('=')
    if (eq > 0) out.push([line.slice(0, eq).trim(), line.slice(eq + 1).trim()])
  }
  return out
}

/** PackedStringArray("a", "b") ↔ string[] */
export function parsePackedStrings(value: string | undefined): string[] {
  if (!value) return []
  return [...value.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1])
}

export function packedStrings(items: string[]): string {
  return `PackedStringArray(${items.map((s) => `"${s}"`).join(', ')})`
}
