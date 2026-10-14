/**
 * Godot 文本场景/资源（.tscn / .tres）的结构化解析。只解析到「段 + 属性」这一层，够做检查和按节点比较。
 *
 * 格式：每段一行头 `[类型 键=值 ...]`，后面跟 `属性 = 值` 行；值可能跨多行（数组、字典）。
 */

export interface Section {
  kind: string
  attrs: Record<string, string>
  props: Record<string, string>
  /** 在文件里的起始行（1 起） */
  line: number
}

export interface ParsedScene {
  sections: Section[]
  extResources: Map<string, Section>
  subResources: Map<string, Section>
  /** 节点路径 → 段。根节点路径是 "."，其余按 Godot 的 NodePath 写法（"Player/Sprite"） */
  nodes: Map<string, Section>
  connections: Section[]
}

const HEADER = /^\[([A-Za-z_]+)((?:\s+[^\]]*)?)\]\s*$/
const ATTR = /([A-Za-z_][\w/]*)=("(?:[^"\\]|\\.)*"|[A-Za-z_]+\("(?:[^"\\]|\\.)*"\)|[^\s\]]+)/g

export function unquote(v: string): string {
  return v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1).replace(/\\(.)/g, '$1') : v
}

function balance(s: string): number {
  let depth = 0
  let inString = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inString) {
      if (c === '\\') i++
      else if (c === '"') inString = false
    } else if (c === '"') inString = true
    else if (c === '[' || c === '{' || c === '(') depth++
    else if (c === ']' || c === '}' || c === ')') depth--
  }
  return depth
}

export function nodePath(attrs: Record<string, string>): string {
  const name = unquote(attrs.name ?? '')
  const parent = attrs.parent === undefined ? undefined : unquote(attrs.parent)
  if (parent === undefined) return '.'
  return parent === '.' ? name : `${parent}/${name}`
}

export function parseScene(text: string): ParsedScene {
  const sections: Section[] = []
  const lines = text.split(/\r?\n/)
  let current: Section | null = null
  let pendingKey: string | null = null
  let pendingValue = ''
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (pendingKey && current) {
      pendingValue += `\n${line}`
      if (balance(pendingValue) <= 0) {
        current.props[pendingKey] = pendingValue
        pendingKey = null
      }
      continue
    }
    const header = HEADER.exec(line)
    if (header) {
      const attrs: Record<string, string> = {}
      for (const m of header[2].matchAll(ATTR)) attrs[m[1]] = m[2]
      current = { kind: header[1], attrs, props: {}, line: i + 1 }
      sections.push(current)
      continue
    }
    if (!current || !line.trim() || line.startsWith(';')) continue
    const eq = line.indexOf(' = ')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 3)
    if (balance(value) > 0) {
      pendingKey = key
      pendingValue = value
    } else current.props[key] = value
  }

  const extResources = new Map<string, Section>()
  const subResources = new Map<string, Section>()
  const nodes = new Map<string, Section>()
  const connections: Section[] = []
  for (const s of sections) {
    if (s.kind === 'ext_resource' && s.attrs.id) extResources.set(unquote(s.attrs.id), s)
    else if (s.kind === 'sub_resource' && s.attrs.id) subResources.set(unquote(s.attrs.id), s)
    else if (s.kind === 'node') nodes.set(nodePath(s.attrs), s)
    else if (s.kind === 'connection') connections.push(s)
  }
  return { sections, extResources, subResources, nodes, connections }
}

/** 一段里引用到的 ExtResource / SubResource id。 */
export function referencedIds(section: Section): { ext: string[]; sub: string[] } {
  const all = [...Object.values(section.attrs), ...Object.values(section.props)].join('\n')
  return {
    ext: [...all.matchAll(/ExtResource\(\s*"((?:[^"\\]|\\.)*)"\s*\)/g)].map((m) => m[1]),
    sub: [...all.matchAll(/SubResource\(\s*"((?:[^"\\]|\\.)*)"\s*\)/g)].map((m) => m[1])
  }
}

// ---------- 合并冲突 ----------

export interface ConflictSides {
  ours: string
  theirs: string
  /** diff3 风格时有共同祖先 */
  base?: string
  oursLabel: string
  theirsLabel: string
  count: number
}

export function hasConflictMarkers(text: string): boolean {
  return /^<{7}( |$)/m.test(text) && /^>{7}( |$)/m.test(text)
}

/** 把带冲突标记的文件拆成「我方版本」和「对方版本」两份完整文本。 */
export function splitConflict(text: string): ConflictSides {
  const ours: string[] = []
  const theirs: string[] = []
  const base: string[] = []
  let state: 'both' | 'ours' | 'base' | 'theirs' = 'both'
  let oursLabel = 'ours'
  let theirsLabel = 'theirs'
  let count = 0
  let sawBase = false
  for (const line of text.split(/\r?\n/)) {
    if (/^<{7}( |$)/.test(line)) {
      state = 'ours'
      oursLabel = line.slice(8).trim() || oursLabel
      count++
    } else if (/^\|{7}( |$)/.test(line) && state === 'ours') {
      state = 'base'
      sawBase = true
    } else if (/^={7}$/.test(line) && (state === 'ours' || state === 'base')) state = 'theirs'
    else if (/^>{7}( |$)/.test(line) && state === 'theirs') {
      state = 'both'
      theirsLabel = line.slice(8).trim() || theirsLabel
    } else if (state === 'both') {
      ours.push(line)
      theirs.push(line)
      base.push(line)
    } else if (state === 'ours') ours.push(line)
    else if (state === 'base') base.push(line)
    else theirs.push(line)
  }
  return { ours: ours.join('\n'), theirs: theirs.join('\n'), base: sawBase ? base.join('\n') : undefined, oursLabel, theirsLabel, count }
}

// ---------- 按节点比较 ----------

export interface SceneChange {
  /** 人能看懂的位置：节点路径、资源 id、连接 */
  target: string
  kind: 'added' | 'removed' | 'changed'
  /** changed 时改了哪些属性 */
  props?: string[]
}

function sectionKey(s: Section): string {
  if (s.kind === 'node') return `node ${nodePath(s.attrs)}`
  if (s.kind === 'ext_resource') return `ext_resource ${unquote(s.attrs.id ?? '')} (${unquote(s.attrs.path ?? '')})`
  if (s.kind === 'sub_resource') return `sub_resource ${unquote(s.attrs.id ?? '')} (${unquote(s.attrs.type ?? '')})`
  if (s.kind === 'connection') {
    const a = s.attrs
    return `connection ${unquote(a.signal ?? '')}: ${unquote(a.from ?? '')} → ${unquote(a.to ?? '')}.${unquote(a.method ?? '')}`
  }
  return s.kind
}

export function diffScenes(before: ParsedScene, after: ParsedScene): SceneChange[] {
  const index = (p: ParsedScene): Map<string, Section> => new Map(p.sections.map((s) => [sectionKey(s), s]))
  const a = index(before)
  const b = index(after)
  const changes: SceneChange[] = []
  for (const [key, s] of b) {
    const old = a.get(key)
    if (!old) {
      changes.push({ target: key, kind: 'added' })
      continue
    }
    const props = new Set([...Object.keys(old.props), ...Object.keys(s.props)])
    const attrs = new Set([...Object.keys(old.attrs), ...Object.keys(s.attrs)])
    const changed = [
      ...[...attrs].filter((k) => old.attrs[k] !== s.attrs[k]).map((k) => `[${k}]`),
      ...[...props].filter((k) => old.props[k] !== s.props[k])
    ]
    if (changed.length) changes.push({ target: key, kind: 'changed', props: changed })
  }
  for (const key of a.keys()) if (!b.has(key)) changes.push({ target: key, kind: 'removed' })
  return changes
}

export function describeChanges(changes: SceneChange[]): string[] {
  return changes.map((c) =>
    c.kind === 'changed' ? `changed ${c.target}: ${c.props!.join(', ')}` : `${c.kind} ${c.target}`
  )
}
