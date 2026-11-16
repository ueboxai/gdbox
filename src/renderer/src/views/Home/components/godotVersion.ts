/**
 * `godot --version` 的输出拆成卡片上的两块：
 * "4.3.stable.mono.official.77dcf97d8" → 大字 "4.3"，标签 ".NET"；
 * "4.5.beta2.official.xxx" → "4.5" 和 "beta2"。stable 不标。
 */
export function shortVersion(raw: string): string {
  return raw.match(/^\d+(?:\.\d+)*/)?.[0] ?? raw
}

export function buildTag(raw: string): string {
  const parts = raw.slice(shortVersion(raw).length).split('.').filter(Boolean)
  const tags: string[] = []
  const status = parts[0]
  if (status && status !== 'stable') tags.push(status)
  if (parts.includes('mono')) tags.push('.NET')
  return tags.join(' ')
}
