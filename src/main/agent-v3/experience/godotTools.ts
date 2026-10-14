/**
 * 改 Godot 文件的那两个本地工具：经验系统要看见它们改了什么。
 *
 * ## 为什么要看本地写文件工具
 *
 * 虚幻盒子里，模型的「代码」就在上帝工具的参数里（Python 脚本），失败和成功两次的脚本一比
 * 就知道改了哪一行。GDBox 不是这样：模型用 `write_local_file` / `edit_local_file` 改
 * `.gd` / `.tscn`，再用 `godot_check` 验 —— 而两次 `godot_check` 的参数一模一样。
 * 「改了什么才过的」全在两次检查**之间**的那几次改文件里，不记它们就什么也学不到。
 *
 * 只记 Godot 的文本文件：改 README、改技能文件和引擎的规矩无关，记了只会让整理员分心。
 */

import { promises as fs } from 'fs'
import { isAbsolute } from 'path'

/** 改文件的本地工具。参数形状见 `vendor/pi-harness/tools/write.ts`、`edit.ts` */
export const GODOT_EDIT_TOOLS: ReadonlySet<string> = new Set([
  'write_local_file',
  'edit_local_file'
])

/** Godot 的文本文件：脚本、场景、资源、着色器、工程配置 */
const GODOT_TEXT_FILE = /(?:\.(?:gd|tscn|tres|gdshader)|(?:^|[\\/])project\.godot)$/i

export function isGodotTextPath(path: unknown): path is string {
  return typeof path === 'string' && GODOT_TEXT_FILE.test(path.trim())
}

/** GDScript 才做执行前提醒：错误写法（`KinematicBody2D`、`yield`）都是脚本里的写法 */
export function isGdScriptPath(path: string): boolean {
  return /\.gd$/i.test(path.trim())
}

export interface GodotEdit {
  path: string
  /** 写进去的新文字：整文件写是全文，局部改是各处 newText 连起来 */
  newText: string
  /** 被换掉的旧文字。整文件写时只有事先读到了才有（见 `readBeforeWrite`） */
  oldText?: string
}

/**
 * 从参数里拿出这次改了哪个 Godot 文件、换上了什么。不是 Godot 文件回 undefined。
 *
 * `edit_local_file` 认两种形状：`edits: [{ oldText, newText }]`，以及 pi 兼容的单处
 * `oldText` / `newText`（`prepareEditArguments` 会把它转成前者，但钩子拿到的未必是转过的）。
 */
export function editOf(tool: string, args: unknown): GodotEdit | undefined {
  if (!GODOT_EDIT_TOOLS.has(tool)) return undefined
  const a = (args ?? {}) as {
    path?: unknown
    content?: unknown
    edits?: unknown
    oldText?: unknown
    newText?: unknown
  }
  if (!isGodotTextPath(a.path)) return undefined
  const path = a.path.trim()
  if (tool === 'write_local_file') {
    return typeof a.content === 'string' ? { path, newText: a.content } : undefined
  }
  const pairs: { oldText: string; newText: string }[] = []
  if (Array.isArray(a.edits)) {
    for (const edit of a.edits as { oldText?: unknown; newText?: unknown }[]) {
      if (typeof edit?.oldText === 'string' && typeof edit?.newText === 'string') {
        pairs.push({ oldText: edit.oldText, newText: edit.newText })
      }
    }
  }
  if (typeof a.oldText === 'string' && typeof a.newText === 'string') {
    pairs.push({ oldText: a.oldText, newText: a.newText })
  }
  if (pairs.length === 0) return undefined
  return {
    path,
    newText: pairs.map((p) => p.newText).join('\n'),
    oldText: pairs.map((p) => p.oldText).join('\n')
  }
}

/** 整文件写之前读回旧内容的上限。再大的 Godot 文本文件不是手写的，比对也没意义 */
const READ_LIMIT = 200_000

/**
 * 整文件写之前，读一下盘上现在的内容。
 *
 * 写工具的参数里只有新全文；不读旧的，整理员只看得到「写成了什么」，看不出「改了哪一行」。
 * 只认绝对路径：相对路径要按 agent 的工作目录解析，这里猜错了读到的是别的文件，比不读更糟。
 * 文件不存在（新建）、读不了，都回 undefined。
 */
export async function readBeforeWrite(path: string): Promise<string | undefined> {
  if (!isAbsolute(path)) return undefined
  try {
    const stat = await fs.stat(path)
    if (!stat.isFile() || stat.size > READ_LIMIT) return undefined
    return await fs.readFile(path, 'utf8')
  } catch {
    return undefined
  }
}

/**
 * 验证工具：跑一遍工程、把 GDScript 和引擎报错交回来。它们就是 Godot 这边的「上帝工具」——
 * 报错来自模型现写的脚本，工具名几乎不区分报错，区分全压在报错本身（见 `specificity.ts`）。
 */
export const VERIFY_TOOLS: ReadonlySet<string> = new Set(['godot_check', 'godot_run'])

/**
 * 验证工具这一次到底过没过。
 *
 * `godot_check` / `godot_run` 发现脚本错误时**不算工具失败**：它们正常返回一段文字，
 * 里面写着「N error(s):」（见 `tools/godot/runtime.ts`）—— 对工具来说，检查出错误正是它的本职。
 * 可对经验系统来说，这才是那次「失败」；不在这里改判，`godot_check` 永远是成功的，
 * 什么都学不到。
 *
 * 只把报错那一段交出去：同一份结果里的「超时」「退出码不对」提示会让整条被当成环境噪声，
 * 而真有报错时，报错才是知识。没有报错、只是超时或崩了，交回那一行 —— 它会被
 * `isEnvironmentalError` 认成环境类，不学，但也不算「过了」。
 */
export function verifyOutcome(call: { tool: string; isError: boolean; text: string }): {
  isError: boolean
  text: string
} {
  if (!VERIFY_TOOLS.has(call.tool) || call.isError) return call
  const text = call.text
  const header = /^\d+ error\(s\):[ \t]*$/m.exec(text)
  if (header) {
    const rest = text.slice(header.index + header[0].length)
    const end = rest.search(/\n\n\d+ warning\(s\):/)
    return { isError: true, text: (end >= 0 ? rest.slice(0, end) : rest).trim() }
  }
  const fatal = /^Could not start: .*$/m.exec(text)
  if (fatal) return { isError: true, text: fatal[0] }
  const broken = /^.*(?:did not (?:exit|finish) in time|exited abnormally).*$/m.exec(text)
  if (broken) return { isError: true, text: broken[0] }
  return call
}
