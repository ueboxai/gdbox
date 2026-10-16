import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { hasConflictMarkers, parseScene, referencedIds, unquote, type ParsedScene } from './tscn'

/**
 * 场景体检：git 合并不会告诉你的那些问题。
 *
 * 实验里小林合并后留下的悬空 ExtResource 在冲突区外面，git 不报，Godot 打开时才炸。
 * 这里在不开引擎的情况下逐个文件查：残留冲突标记、引用了没声明的资源、资源文件不存在、
 * 重复 id、父节点不存在、同名兄弟节点、没人用的资源声明。
 */

export interface SceneIssue {
  file: string
  line?: number
  severity: 'error' | 'warning'
  message: string
}

export function checkScene(
  file: string,
  text: string,
  resolveRes: (res: string) => boolean
): SceneIssue[] {
  const issues: SceneIssue[] = []
  const add = (severity: SceneIssue['severity'], message: string, line?: number): void => {
    issues.push({ file, line, severity, message })
  }
  if (hasConflictMarkers(text)) {
    const line = text.split(/\r?\n/).findIndex((l) => /^<{7}( |$)/.test(l)) + 1
    add('error', 'Unresolved merge conflict markers. Godot cannot load this file.', line)
    return issues
  }

  let scene: ParsedScene
  try {
    scene = parseScene(text)
  } catch (err) {
    add('error', `Could not parse: ${(err as Error).message}`)
    return issues
  }

  // 重复 id
  const seen = new Map<string, number>()
  for (const s of scene.sections) {
    if ((s.kind === 'ext_resource' || s.kind === 'sub_resource') && s.attrs.id) {
      const key = `${s.kind}:${unquote(s.attrs.id)}`
      if (seen.has(key))
        add(
          'error',
          `Duplicate ${s.kind} id "${unquote(s.attrs.id)}" (also on line ${seen.get(key)}).`,
          s.line
        )
      else seen.set(key, s.line)
    }
  }

  // 资源文件是否存在
  for (const [id, s] of scene.extResources) {
    const path = unquote(s.attrs.path ?? '')
    if (path.startsWith('res://') && !resolveRes(path))
      add('error', `ext_resource "${id}" points to ${path}, which does not exist.`, s.line)
  }

  // 悬空引用、没人用的声明
  const usedExt = new Set<string>()
  const usedSub = new Set<string>()
  for (const s of scene.sections) {
    const { ext, sub } = referencedIds(s)
    for (const id of ext) {
      usedExt.add(id)
      if (!scene.extResources.has(id))
        add(
          'error',
          `ExtResource("${id}") is used but never declared (dangling after a merge?).`,
          s.line
        )
    }
    for (const id of sub) {
      usedSub.add(id)
      if (!scene.subResources.has(id))
        add('error', `SubResource("${id}") is used but never declared.`, s.line)
    }
  }
  for (const [id, s] of scene.extResources) {
    if (!usedExt.has(id))
      add(
        'warning',
        `ext_resource "${id}" (${unquote(s.attrs.path ?? '')}) is declared but not used.`,
        s.line
      )
  }

  // 节点树：父节点要先出现、同一父节点下不能重名
  const paths = new Set<string>()
  for (const [path, s] of scene.nodes) {
    const parent = s.attrs.parent === undefined ? null : unquote(s.attrs.parent)
    if (parent !== null && parent !== '.' && !paths.has(parent)) {
      add(
        'error',
        `Node "${path}" has parent "${parent}", which does not exist in this scene (renamed or removed on another branch?).`,
        s.line
      )
    }
    paths.add(path)
  }
  const nodeCount = scene.sections.filter((s) => s.kind === 'node').length
  if (nodeCount !== scene.nodes.size) {
    const counts = new Map<string, number>()
    for (const s of scene.sections.filter((x) => x.kind === 'node')) {
      const key = `${s.attrs.parent ?? ''}|${s.attrs.name ?? ''}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    for (const [key, n] of counts)
      if (n > 1)
        add(
          'error',
          `Two sibling nodes share the name ${key.split('|')[1]} under ${key.split('|')[0] || 'the root'}.`
        )
  }

  // 连接两端的节点要存在
  for (const c of scene.connections) {
    for (const end of ['from', 'to'] as const) {
      const p = unquote(c.attrs[end] ?? '')
      if (p && !scene.nodes.has(p))
        add('error', `Signal connection ${end} "${p}" does not exist.`, c.line)
    }
  }
  return issues
}

/** 工程里所有 .tscn / .tres；跳过 .godot、addons 里不归自己管的不跳（插件也可能被合坏）。 */
export function sceneFiles(projectDir: string): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name === '.godot' || name === '.git' || name === '.gdbox' || name === 'node_modules')
        continue
      const abs = join(dir, name)
      const st = statSync(abs)
      if (st.isDirectory()) {
        if (!existsSync(join(abs, '.gdignore'))) walk(abs)
      } else if (/\.(tscn|tres)$/.test(name)) out.push(abs)
    }
  }
  walk(projectDir)
  return out
}

export function checkProjectScenes(projectDir: string, only?: string[]): SceneIssue[] {
  const resolveRes = (res: string): boolean =>
    existsSync(join(projectDir, res.slice('res://'.length)))
  const files = only ?? sceneFiles(projectDir)
  return files.flatMap((abs) => {
    const rel = `res://${relative(projectDir, abs).split(sep).join('/')}`
    return checkScene(rel, readFileSync(abs, 'utf8'), resolveRes)
  })
}

export function formatIssues(issues: SceneIssue[]): string {
  if (!issues.length) return 'No problems found.'
  const errors = issues.filter((i) => i.severity === 'error')
  const warnings = issues.filter((i) => i.severity === 'warning')
  const fmt = (i: SceneIssue): string => `${i.file}${i.line ? `:${i.line}` : ''} — ${i.message}`
  return [
    errors.length ? `${errors.length} error(s):\n${errors.map(fmt).join('\n')}` : '',
    warnings.length ? `${warnings.length} warning(s):\n${warnings.map(fmt).join('\n')}` : ''
  ]
    .filter(Boolean)
    .join('\n\n')
}
