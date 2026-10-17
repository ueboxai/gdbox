/**
 * 首批工具的公共结果（MCP `structuredContent`）。
 *
 * ## 为什么需要它
 *
 * 工具的结构化数据放在 `AgentToolResult.details` 里，而 `details` 是**给宿主
 * 界面用的**，从来没发给过 MCP 客户端。外部调用方今天只有两条路：
 *
 *   - 适配层的工具（`adaptV2Tool`）把整个返回值 `JSON.stringify` 塞进了文本块，
 *     所以数据其实在，只是没有形状，得靠调用方自己 `JSON.parse` 一段
 *     「碰巧是 JSON」的文本；
 *   - `defineTool` 原生工具（`godot_check`）连这条路都没有 ——
 *     `toContent()` 只转 `text`，它那份报错清单**只存在于一段散文里**。
 *
 * 两条都不能当接口用。这里给首批工具一份显式的、字段固定的结构化结果。
 *
 * ## 为什么是「显式挑字段」而不是把 details 整个透出去
 *
 * `details` 是宿主 UI 数据，里面有什么由各工具自便，透出去等于把内部结构
 * 变成对外接口 —— 以后改一个界面字段就是一次破坏性变更。所以一个工具一个
 * 小 serializer，字段是选出来的。没有 serializer 的工具不返回 `structuredContent`，
 * 保持现状。
 *
 * ## 缺失和「确认为空」必须分得开
 *
 * 工具没报某个字段时一律给 `null`，**不补 0、不补空数组、不拿数组长度冒充总数**。
 * 「没有报错」和「这次没拿到报错清单」是两件事，前者能下结论，后者只能去问。
 */

/** 有 serializer 的工具。其余工具不返回 structuredContent */
const SERIALIZERS: Record<string, (details: Record<string, unknown>) => Record<string, unknown>> = {
  godot_check: serializeCheck,
  godot_run: serializeCheck,
  godot_screenshot: serializeScreenshot,
  editor_scene_tree: serializeSceneTree,
  project_list: serializeProjectList,
  team_gate: serializeTeamGate,
  team_list: serializeTeamList
}

/**
 * 把一个工具的 `details` 转成公共结构化结果。
 *
 * @returns 结构化结果；该工具没有 serializer、或 details 不是对象时为 `undefined`
 */
export function toStructuredContent(
  toolName: string,
  details: unknown
): Record<string, unknown> | undefined {
  const serialize = SERIALIZERS[toolName]
  if (!serialize) return undefined
  if (!details || typeof details !== 'object' || Array.isArray(details)) return undefined

  try {
    return serialize(details as Record<string, unknown>)
  } catch (error) {
    // 序列化炸了不能把一次成功的工具调用变成失败：文本块里的结果是完整的，
    // 少一份结构化视图而已。
    console.warn(`[AgentV3][MCP-Server] ${toolName} 的公共结果序列化失败:`, error)
    return undefined
  }
}

/** 已导出的工具名，给测试和文档用 */
export const PUBLIC_RESULT_TOOLS = Object.keys(SERIALIZERS)

// ── 取值助手 ────────────────────────────────────────────────────────────────
//
// 一律「有才给、没有给 null」。见文件头：缺失不能伪装成确认为空。

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function bool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function arr(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null
}

function obj(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

// ── godot_check / godot_run ─────────────────────────────────────────────────

/** 报错和警告原样给出；没跑完（超时）时调用方不该把「没报错」当通过 */
function serializeCheck(details: Record<string, unknown>): Record<string, unknown> {
  const errors = arr(details.errors)
  const warnings = arr(details.warnings)
  return {
    errors,
    errorCount: errors ? errors.length : null,
    warnings,
    warningCount: warnings ? warnings.length : null,
    timedOut: bool(details.timedOut)
  }
}

// ── godot_screenshot ────────────────────────────────────────────────────────

function serializeScreenshot(details: Record<string, unknown>): Record<string, unknown> {
  return { path: str(details.path) }
}

// ── project_list ────────────────────────────────────────────────────────────

/** 命令行的 `gdbox projects list` 靠它挑工程 */
function serializeProjectList(details: Record<string, unknown>): Record<string, unknown> {
  return { projects: arr(details.projects), collections: arr(details.collections) }
}

// ── editor_scene_tree ───────────────────────────────────────────────────────

function serializeSceneTree(details: Record<string, unknown>): Record<string, unknown> {
  return { scene: str(details.scene), tree: obj(details.tree) }
}

// ── team_gate / team_list ───────────────────────────────────────────────────

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** 外部团队的交付闸。`gdbox team gate`（Claude Code 的 Stop hook）靠它判拦不拦 */
function serializeTeamGate(details: Record<string, unknown>): Record<string, unknown> {
  return {
    teamId: str(details.teamId),
    objective: str(details.objective),
    verdict: str(details.verdict),
    verdictAt: num(details.verdictAt),
    lastWriteAt: num(details.lastWriteAt),
    deliveries: num(details.deliveries),
    passed: bool(details.passed),
    ended: bool(details.ended)
  }
}

function serializeTeamList(details: Record<string, unknown>): Record<string, unknown> {
  const teams = arr(details.teams)
  return {
    teams: teams
      ? teams.map((team) => {
          const t = (team ?? {}) as Record<string, unknown>
          return {
            ...serializeTeamGate(t),
            projectPath: str(t.projectPath),
            createdAt: num(t.createdAt)
          }
        })
      : null
  }
}
