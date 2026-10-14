/**
 * 工具名相关的常量。
 *
 * **这个模块刻意零依赖。** 工具注册表和 skill 层都要用它，而 skill 层不该为了
 * 一个字符串替换把整棵工具树（electron / @aws-sdk / sharp）拉进自己的依赖图。
 */

/**
 * 旧工具名 → 现在的工具名。
 *
 * 用于把工具描述和技能正文里的交叉引用一起改掉：模型照着看到的名字去调用，
 * 名字对不上就是「工具不存在」。改名时在这里留一条旧名映射。
 */
const CROSS_REFERENCE_RENAMES: Readonly<Record<string, string>> = Object.freeze({})

/**
 * Agent 浏览器的六个工具名。
 *
 * 放在这个零依赖模块里，是因为有三处要用而它们互不相干：注册表补
 * `allToolNames()`、HTTP 调试入口拒绝执行、工具实现本身。任何一处去 import
 * 工具实现，都会把 electron 窗口那套拖进不该有它的依赖图。
 */
export const BROWSER_TOOL_NAMES = [
  'browser_open',
  'browser_read',
  'browser_navigate',
  'browser_interact',
  'browser_screenshot',
  'browser_close'
] as const

/**
 * 反问用户那个工具的名字。
 *
 * 和 `BROWSER_TOOL_NAMES` 同样的理由放在这个零依赖模块里：注册表要用它补
 * `allToolNames()`，而**续跑修复**（`core/resume.ts`）也要用它认出「崩溃时
 * 挂在半路的那次提问」。后者去 import 工具实现，会把 zod 和整棵工具树拖进
 * transcript 持久化的依赖图里。
 */
export const ASK_USER_TOOL_NAME = 'ask_user'

/**
 * 换对话归属那个工具的名字。同上，放在零依赖模块里给注册表补名单和风险表用。
 *
 * 它和 `ask_user` / `voice_report` 一样是在 `resolveTools` 里现造的（要宿主给的
 * 通道），进不了 `REGISTRATIONS`。但它是这批现造工具里**唯一一个 `mutating`**，
 * 所以风险表必须专门补上它：渲染层的「本轮改动」按
 * `riskTable[name]`，查不到就跳过，于是一个特意标成 `mutating` 的工具
 * 一次都不会出现在改动清单里 —— 而漏报比没有清单更糟。
 */
export const SET_SESSION_PROJECT_TOOL_NAME = 'set_session_project'

/** 现造工具里唯一的非 safe 那个，风险表照它补 */
export const SET_SESSION_PROJECT_RISK = 'mutating' as const

/**
 * 要 Godot 编辑器连着才能用的工具命名空间。
 *
 * 编辑器没连上时这一组整个不给：让模型看到一堆调不通的工具，它会在上面浪费步数。
 * 和 Unreal 不同，Godot 的场景、资源、脚本都是文本，没有编辑器也能读写、能
 * 起无头 Godot 检查和试玩 —— 所以只有「用户正开着的那个编辑器」这一组依赖连接。
 *
 * 放在这个零依赖模块里：`core/createAgent.ts` 按它挑工具，对外 MCP 服务按它标
 * `projectScoped`。抄成两份的话，加一组时必然只改一处。
 */
export const EDITOR_NAMESPACE = 'godot.editor'

/** 这个命名空间下的工具要不要编辑器连着 */
export function needsEditor(namespace: string): boolean {
  return namespace === EDITOR_NAMESPACE || namespace.startsWith(`${EDITOR_NAMESPACE}.`)
}

/** 这个名字是不是浏览器工具 */
export function isBrowserToolName(name: string): boolean {
  return (BROWSER_TOOL_NAMES as readonly string[]).includes(name)
}

/**
 * 把描述里的 V2 工具名换成 V3 的。
 *
 * 不做这一步，模型会照着描述去调 `material.get_graph`，而注册的是
 * `material_get_graph` —— 表现为「模型反复调用不存在的工具」。
 */
export function rewriteCrossReferences(text: string): string {
  let out = text
  for (const [from, to] of Object.entries(CROSS_REFERENCE_RENAMES)) {
    // 转义点号，避免它匹配任意字符；整词匹配，避免 `foo_bar` 命中 `foo`
    out = out.replace(new RegExp(`\\b${from.replace('.', '\\.')}\\b`, 'g'), to)
  }
  return out
}
