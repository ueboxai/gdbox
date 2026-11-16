/**
 * 这一条命令针对哪个 Godot 工程。
 *
 * ## 三级顺序，一级都不能跳
 *
 *   1. 显式 `--project`
 *   2. 从当前目录逐层往上找最近的 `project.godot`
 *   3. 都没有时，**只有恰好一个** Godot 编辑器连着才自动采用它
 *
 * ## 为什么第 1、2 级定出来的工程不再对一遍清单
 *
 * 编辑器类工具（`editor_*`）要的是「这个工程的编辑器连着」，这件事由盒子
 * 在收到请求时判定（`_meta.unrealBox.projectPath`），没连着就回
 * `PROJECT_NOT_CONNECTED`，**绝不改发给旁边另一个在线的编辑器**。
 * 无头工具（`godot_check` / `godot_run` / `godot_screenshot`）根本不需要
 * 编辑器，工程目录作为 `project_path` 参数直接交过去。
 * 两种情况都不需要 CLI 先拿一份清单来比对。
 *
 * 第 3 级的自动采用之所以安全，是因为「恰好一个」意味着没有别的选项，
 * 猜不错。有两个就一律报歧义。
 */

import { promises as fs } from 'node:fs'
import { basename, dirname, isAbsolute, join, parse, resolve } from 'node:path'

import { GdboxError } from './errors.js'

/** 工程的标志文件。Godot 4 的工程根目录下有且只有这一个 */
const PROJECT_FILE = 'project.godot'

/** 「我的项目」里登记的工程，来自 `project_list` 的公共结果 */
export interface RegisteredProject {
  name: string
  path: string
  /** 登记时识别出的 Godot 版本；没识别出来是 null */
  godotVersion: string | null
  /** 目录里还有没有 project.godot；服务端没报是 null */
  onDisk: boolean | null
  /** 这个工程的编辑器此刻是否连着（GDBox Link） */
  editorConnected: boolean
  projectKey: string | null
}

export interface ResolvedProject {
  name: string
  path: string
  /** 定下来的依据，`doctor` 要说清楚是怎么定的 */
  source: 'explicit' | 'cwd' | 'single'
}

async function hasProjectFile(dir: string): Promise<boolean> {
  try {
    return (await fs.stat(join(dir, PROJECT_FILE))).isFile()
  } catch {
    return false
  }
}

/**
 * 把用户给的路径规整成工程根目录。
 *
 * 接受 `project.godot` 文件，也接受它所在的目录 —— 用户手上有哪个就给哪个，
 * 让他先想清楚该给哪种是没必要的负担。
 */
export async function canonicalizeProjectPath(input: string, cwd = process.cwd()): Promise<string> {
  const absolute = isAbsolute(input) ? input : resolve(cwd, input)

  let stats: Awaited<ReturnType<typeof fs.stat>>
  try {
    stats = await fs.stat(absolute)
  } catch {
    throw new GdboxError(
      'INVALID_ARGUMENT',
      `--project 指向的路径不存在：${absolute}`,
      '给 project.godot 文件或它所在的目录都可以。'
    )
  }

  if (stats.isFile()) {
    if (basename(absolute).toLowerCase() !== PROJECT_FILE) {
      throw new GdboxError('INVALID_ARGUMENT', `--project 指向的不是 project.godot：${absolute}`)
    }
    return dirname(absolute).replace(/\\/g, '/')
  }

  if (!(await hasProjectFile(absolute))) {
    throw new GdboxError(
      'INVALID_ARGUMENT',
      `这个目录里没有 project.godot：${absolute}`,
      '确认路径指向 Godot 工程的根目录。'
    )
  }
  return absolute.replace(/\\/g, '/')
}

/**
 * 从一个目录逐层往上找最近的 `project.godot`。
 *
 * 找到根目录还没有就返回 undefined —— 那不是错误，只是「这次没有本地线索」，
 * 会落到第 3 级。
 */
export async function findProjectUpwards(from: string): Promise<string | undefined> {
  let current = resolve(from)
  const root = parse(current).root

  for (;;) {
    if (await hasProjectFile(current)) return current.replace(/\\/g, '/')

    if (current === root) return undefined
    const parent = dirname(current)
    // 保险：`dirname` 在极少数畸形路径上可能不动，避免死循环
    if (parent === current) return undefined
    current = parent
  }
}

/**
 * 工程的显示名：`project.godot` 里的 `config/name`，读不到就用目录名。
 *
 * 只认最常见的那一种写法（双引号字符串）。认不出来就退回目录名，
 * 不为一个显示用的名字去写一个 ConfigFile 解析器。
 */
export async function projectName(dir: string): Promise<string> {
  try {
    const text = await fs.readFile(join(dir, PROJECT_FILE), 'utf8')
    const match = /^config\/name\s*=\s*"((?:[^"\\]|\\.)*)"/m.exec(text)
    if (match?.[1]) return match[1].replace(/\\"/g, '"')
  } catch {
    // 读不到就用目录名
  }
  return basename(dir)
}

/**
 * 第 1、2 级：用户点名的，或者当前目录所在的那个工程。
 *
 * @returns 两级都没有线索时是 undefined
 */
export async function localProject(
  explicit: string | undefined,
  cwd: string = process.cwd()
): Promise<ResolvedProject | undefined> {
  if (explicit) {
    const path = await canonicalizeProjectPath(explicit, cwd)
    return { name: await projectName(path), path, source: 'explicit' }
  }

  const nearby = await findProjectUpwards(cwd)
  if (nearby) return { name: await projectName(nearby), path: nearby, source: 'cwd' }

  return undefined
}

/**
 * 第 3 级：没有点名、也不在工程目录里时，看连着的编辑器。
 *
 * 恰好一个才用；零个和多个都报错，下一步都是「用 --project 说清楚」。
 */
export function pickConnected(registered: RegisteredProject[]): ResolvedProject {
  const connected = registered.filter((project) => project.editorConnected)

  if (connected.length === 1) {
    return { name: connected[0].name, path: connected[0].path, source: 'single' }
  }

  if (connected.length === 0) {
    throw new GdboxError(
      'PROJECT_NOT_CONNECTED',
      '没有指定工程：没给 --project，当前目录往上也没有 project.godot，也没有连着的 Godot 编辑器。',
      '用 --project <工程目录> 指定，或者在工程目录里运行本命令。'
    )
  }

  throw new GdboxError(
    'PROJECT_AMBIGUOUS',
    `有 ${connected.length} 个 Godot 编辑器连着，无法确定目标工程。`,
    '运行 gdbox projects list 看清单，再用 --project 指定工程目录。'
  )
}
