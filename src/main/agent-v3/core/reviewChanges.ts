/**
 * 审查这一轮改过的资源 —— 「它说做完了，到底做成了没有」。
 *
 * 问的是磁盘上工程的当前状态，不是模型的记忆：
 *
 * - 说建好/改好的文件在不在（`missing`）
 * - 说删掉的是不是真没了（`still-there`），还有没有别的文件在引用它（`orphan-referencer`）
 * - 场景 / 资源里 `ext_resource` 指向的文件在不在（`broken-dependency`）
 *
 * Godot 的场景和资源是文本，这几项不用开编辑器就能查；脚本能不能编译交给
 * `godot_check`（要起一次无头 Godot，不适合挂在一个按钮上）。
 */

import { promises as fs } from 'fs'
import { join } from 'path'

import type {
  AgentReviewFinding,
  AgentReviewResult,
  AgentReviewTarget
} from '../../../shared/agentReview'
import { REVIEW_SEVERITY_ORDER } from '../../../shared/agentReview'

/** 会被别的文件引用的文本格式：查「谁还在引用被删的那个」时只扫这几种 */
const REFERENCING_EXTENSIONS = new Set(['.tscn', '.tres', '.gd', '.gdshader', '.godot', '.cfg'])
/** 扫引用时跳过的目录：导入缓存、版本库、依赖 */
const SKIPPED_DIRS = new Set(['.godot', '.git', '.import', 'node_modules'])
/** 一次审查最多扫多少个文件找引用。工程再大也不能把按钮卡住 */
const MAX_SCANNED_FILES = 5000

function toDiskPath(projectRoot: string, resPath: string): string {
  return join(projectRoot, resPath.replace(/^res:\/\//, ''))
}

async function exists(path: string): Promise<boolean> {
  return fs
    .access(path)
    .then(() => true)
    .catch(() => false)
}

/** `[ext_resource ... path="res://..."]` 里的路径 */
export function extResourcePaths(text: string): string[] {
  const paths: string[] = []
  for (const match of text.matchAll(/^\[ext_resource\b[^\]]*?\bpath="(res:\/\/[^"]+)"/gm)) {
    paths.push(match[1])
  }
  return paths
}

async function listReferencingFiles(root: string): Promise<string[]> {
  const files: string[] = []
  const walk = async (dir: string): Promise<void> => {
    if (files.length >= MAX_SCANNED_FILES) return
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (files.length >= MAX_SCANNED_FILES) return
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) await walk(full)
      } else {
        const dot = entry.name.lastIndexOf('.')
        if (dot >= 0 && REFERENCING_EXTENSIONS.has(entry.name.slice(dot).toLowerCase())) {
          files.push(full)
        }
      }
    }
  }
  await walk(root)
  return files
}

function toResPath(projectRoot: string, diskPath: string): string {
  return 'res://' + diskPath.slice(projectRoot.length).replace(/\\/g, '/').replace(/^\/+/, '')
}

export async function reviewChanges(
  targets: AgentReviewTarget[],
  projectRoot: string | undefined
): Promise<AgentReviewResult> {
  const resTargets = targets.filter((target) => /^res:\/\//.test(target.path))
  if (!projectRoot) {
    return {
      success: true,
      checked: 0,
      findings: [],
      engineChecked: false,
      engineError: '不知道这一轮改的是哪个工程，没法核对磁盘上的文件。'
    }
  }

  const findings: AgentReviewFinding[] = []
  let referencing: { path: string; text: string }[] | undefined

  for (const target of resTargets) {
    const disk = toDiskPath(projectRoot, target.path)
    const present = await exists(disk)

    if (target.action === 'deleted') {
      if (present) {
        findings.push({ target: target.path, code: 'still-there', severity: 'error' })
        continue
      }
      referencing ??= await Promise.all(
        (await listReferencingFiles(projectRoot)).map(async (path) => ({
          path,
          text: await fs.readFile(path, 'utf8').catch(() => '')
        }))
      )
      const users = referencing
        .filter((file) => file.text.includes(target.path))
        .map((file) => toResPath(projectRoot, file.path))
      if (users.length > 0) {
        findings.push({
          target: target.path,
          code: 'orphan-referencer',
          severity: 'error',
          detail: users.slice(0, 10).join('\n')
        })
      }
      continue
    }

    if (!present) {
      findings.push({ target: target.path, code: 'missing', severity: 'error' })
      continue
    }

    if (/\.(tscn|tres)$/i.test(target.path)) {
      const text = await fs.readFile(disk, 'utf8').catch(() => '')
      const broken: string[] = []
      for (const dep of extResourcePaths(text)) {
        if (!(await exists(toDiskPath(projectRoot, dep)))) broken.push(dep)
      }
      if (broken.length > 0) {
        findings.push({
          target: target.path,
          code: 'broken-dependency',
          severity: 'error',
          detail: broken.join('\n')
        })
      }
    }
  }

  findings.sort((a, b) => REVIEW_SEVERITY_ORDER[a.severity] - REVIEW_SEVERITY_ORDER[b.severity])
  return { success: true, checked: resTargets.length, findings, engineChecked: true }
}
