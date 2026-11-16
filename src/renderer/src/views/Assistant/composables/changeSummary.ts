import type { AgentProcessItem } from '../components/AgentProcessLog.types'

export type ToolRisk = 'safe' | 'mutating' | 'destructive'

/**
 * 台账里的一条改动 —— 一次真的动了东西的工具调用。
 *
 * 台账是**全的**，它会落盘给「用量」页统计；面板显示的是它的一个子集，
 * 哪些不上面板见 `PANEL_HIDDEN_TOOLS`。所以下面这些字段（命令原文、
 * 能不能撤回）对本地命令行照样成立，只是用户在「本轮改动」里看不到那几行。
 */
export interface ChangeEntry {
  /** 工具名，界面按它取展示文案 */
  toolName: string
  risk: ToolRisk
  /** 改的是哪个东西：`res://` 路径 / 磁盘绝对路径 / 资产名，取不到就空串 */
  target: string
  /**
   * 同一个工具的多次调用可能干着不同的事，target 表达不了的那部分放这里：
   * 命令原文、编辑器里打开的是哪个场景、套的是哪个风格预设。取不到就省略。
   */
  detail?: string
  /**
   * 写文件时这个文件原来不存在 —— 工具返回值里的 `fileChange.created` 说的。
   * 只有为 true 时才写；没有它，新写的脚本和改过的脚本在清单上长得一样。
   */
  created?: boolean
  /** 这一步能不能撤回。shell 命令干了什么我们无从得知，只能标成不可回滚 */
  reversible: boolean
  /** 执行失败的调用也列出来，但标明没生效 */
  failed: boolean
}

/**
 * 从参数里挑出「改的是什么」。
 *
 * 工具各有各的参数名，逐个写映射会变成一张没人维护的表；这里只按常见键名
 * 找第一个像目标的字符串，找不到就不显示目标。
 *
 * - `path`：写 / 改本地文件的磁盘绝对路径
 * - `name`：gen_* 生成的资产名。只在调用失败、没有返回值可读时才用得上 ——
 *   成功的调用以返回值里真写出来的 `res://` 路径为准，见 `extractChangeOutcomes`
 * - `url` / `label`：浏览器。`browser_interact` 给的是已被主进程核对过的元素标签。
 *   **不取 value** —— 用户输入的内容在审批弹窗里已经看过一遍，没有理由再长期挂在台账上
 * - `destination`：`import_to_project` 放进哪个目录，同样只是失败时的兜底
 */
const TARGET_KEYS = ['path', 'name', 'url', 'label', 'destination'] as const

function firstString(record: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    : []
}

export function extractChangeTarget(args: unknown): string {
  if (!isPlainObject(args)) return ''

  // gen_voice 一次合成好几条台词，文件名取自每条的 id，顶层没有 name
  const lines = args.lines
  if (Array.isArray(lines) && isPlainObject(lines[0])) {
    const id = firstString(lines[0], ['id'])
    if (id) return id
  }

  return firstString(args, TARGET_KEYS)
}

/** MCP 工具名前缀，见主进程 `McpClientManager.toSafeToolName` */
const MCP_PREFIX = 'mcp_'

/**
 * 这条改动是不是经 MCP server 做的。
 *
 * 界面要据此换一套说法：`mcp_my-server_do_thing` 这种名字对用户毫无意义。
 */
export function isMcpChange(entry: Pick<ChangeEntry, 'toolName'>): boolean {
  return String(entry.toolName ?? '').startsWith(MCP_PREFIX)
}

/**
 * 工具名 → 界面文案的 i18n key。
 *
 * **有翻译就用翻译，没有就原样显示工具名**。新增工具时忘了配文案，
 * 退化成一个能看懂的英文标识，而不是坏掉。
 */
export function changeLabelKey(toolName: string): string {
  return `assistant.changes.tools.${toolName}`
}

/** 盘符路径（`C:\` `C:/`）、UNC 网络路径（`\\server\share\`）、POSIX 绝对路径（`/home/…`） */
const LOCAL_FILE_TARGET = /^(?:[A-Za-z]:[\\/]|\\\\[^\\/\s]+[\\/]|\/[^/])/

/**
 * 这条改动动的是不是硬盘上的文件（给的是绝对路径）。
 *
 * 写 / 改文件的工具收的是磁盘绝对路径，有改前改后的快照，能看对比、
 * 能在资源管理器里定位；gen_* 和导入给的是 `res://` 路径，界面上分在另一组。
 *
 * @param entry 一条改动
 */
export function isLocalFileChange(entry: Pick<ChangeEntry, 'target'>): boolean {
  return LOCAL_FILE_TARGET.test(String(entry.target ?? '').trim())
}

/**
 * 这个 target 是不是工程内的资源路径（`res://…`）。
 *
 * 只有它能在 Godot 编辑器里打开、能送去审查。主进程 `openAsset.ts` 的
 * `isContentPath` 是同样的判断 —— 那边是入参防线（不信任传进去的字符串），
 * 这边是显示判断（不给点不动的按钮）。两边各自成立，不是可以合并的重复。
 */
export function isResPath(target: string): boolean {
  return /^res:\/\/.+/.test(String(target ?? '').trim())
}

/**
 * 一样东西在这一轮里的净结果。
 *
 * 只有三种，因为用户只会问这三个问题：这东西是新出现的、原来就有被改了、
 * 还是没了。中间过程（改了几次）不在这个维度上。
 */
export type ChangeAction = 'created' | 'modified' | 'deleted'

/** 动的是哪类东西。认不出来时是空串 —— 不显示类型，好过显示一个猜的 */
export type ChangeKind =
  | 'scene'
  | 'script'
  | 'shader'
  | 'resource'
  | 'image'
  | 'audio'
  | 'video'
  | 'model'
  | 'config'
  | 'file'
  | 'style'
  | 'asset'
  | 'folder'
  | 'note'
  | 'web'

/** 一类步骤，同工具名且同 detail 的合并计数（改五次同一个脚本是一条 ×5，不是五行） */
export interface ChangeStep {
  toolName: string
  /** 这几步共同的差异信息，见 ChangeEntry.detail */
  detail?: string
  count: number
  /** 这一类里失败了几次 */
  failedCount: number
}

/** 一个被动过的东西 —— 界面上的一行 */
export interface ChangeGroup {
  /** 分组键，同时用作列表 key */
  key: string
  /** 完整目标路径；编辑器操作和取不到目标的调用为空串 */
  target: string
  /** 硬盘上的文件（给的是绝对路径，可以打开、定位、看对比） */
  local: boolean
  action: ChangeAction
  kind: ChangeKind | ''
  /** 这一组一共几步 */
  stepCount: number
  /** 其中失败几步 */
  failedCount: number
  /** 其中撤不回去几步 */
  irreversibleCount: number
  /** 明细，展开后才显示 */
  steps: ChangeStep[]
}

/**
 * 新建出一样东西的工具。
 *
 * 用显式集合而不是按名字猜：`gen_*` 每次都是写出新文件，`import_to_project`
 * 是把文件放进工程；写文件则要看那个文件原来在不在，由返回值说（`created`）。
 */
const CREATE_TOOLS = new Set([
  'gen_sprite',
  'gen_tileset',
  'gen_sfx',
  'gen_music',
  'gen_voice',
  'import_to_project',
  'generate_image',
  'generate_video',
  'generate_3d_model',
  'rig_3d_model',
  'create_folders',
  'create_note'
])

/** 同理，删掉整个东西的工具 */
const DELETE_TOOLS = new Set([
  'delete_note',
  'delete_assets',
  // 删文件夹连里面的资产一起软删，净结果就是「这个文件夹没了」
  'delete_folders'
])

/**
 * 收尾内务 —— 这些**永远不单独占一行**。
 *
 * 判据：用户能不能在自己工程里指着它说「这个」。「player.tscn」可以，
 * 「保存全部场景」「停止运行」不行 —— 它们是 agent 干活的过程，不是工程里
 * 多出来的东西。`editor_save_all` 是改场景文件之前的例行动作（先把用户没存的
 * 改动落盘，免得被覆盖），`editor_stop` 是跟在 `editor_play` 后面的收尾。
 *
 * 能对上某一行的照常并进那一行的展开区；对不上任何一行的（它们都不带参数）
 * 就不显示。整轮只有内务时清单为空，面板不显示。
 *
 * `godot_check` / `godot_run` / `godot_screenshot` 是只读验证（safe），
 * 压根进不了台账，不必列在这里。
 */
const BOOKKEEPING_TOOLS = new Set(['editor_save_all', 'editor_stop'])

/**
 * 在用户的 Godot 编辑器里做的操作：运行游戏、打开场景、选中节点。
 *
 * 它们不改工程里的文件，但改了用户眼前的编辑器 —— 标签页被切走、游戏窗口
 * 弹出来，用户得知道是谁干的。界面上单独成区，一行一个操作，按工具名 + detail
 * 分组：它们的 `path` 参数是「在编辑器里打开哪个场景」，不是「改了哪个文件」，
 * 当成 target 会和真正写过那个场景的行并到一起，读起来像那个场景被改了。
 */
const EDITOR_ACTION_TOOLS = new Set(['editor_play', 'editor_open_scene', 'editor_select'])

/** 这一行是不是编辑器里的操作，界面据此把它分进「编辑器里的操作」那一区 */
export function isEditorAction(toolName: string): boolean {
  return EDITOR_ACTION_TOOLS.has(toolName)
}

/**
 * 记进台账、但不在「本轮改动」面板上显示的工具。
 *
 * ## 为什么本地命令行不显示
 *
 * 这个面板回答的是「我的工程里变了什么」。`run_shell_command` 跑在用户自己的
 * 电脑上，没有可打开、可审查的目标 —— 它在清单上只能原样贴一条命令，而那条命令
 * 多半是 `where ffmpeg`、`ls -l` 这种探路，却照样顶着一个「不可回滚」的红标。
 * 狼来了喊多了，红标本身就失效了。
 *
 * **命令没有因此消失。** 它定成 destructive（见 `localShell.ts`），每一条都要
 * 用户在审批弹窗里点头才跑得起来，过程日志里也一字不落地留着原文。
 *
 * ## 为什么只在这一层挡，不在 `summarizeChanges()` 里挡
 *
 * 那一步的产物会**落盘**进 `responseMetadata.changes`，「用量」页拿它算改动总数
 * 和按工具排行（见 `Usage/usageStats.ts`）。在写入侧挡掉等于顺手改了统计口径。
 * 这里只是**不显示**，台账本身仍然完整。
 */
const PANEL_HIDDEN_TOOLS = new Set(['run_shell_command'])

/**
 * 这一步能不能不单独占一行。
 *
 * **destructive 的一律占一行**，哪怕它长得像内务：漏报一次不可逆的操作，
 * 比多显示一行糟得多。判据交给风险表，将来某个工具被重新定级，这里自动跟着变。
 */
function isBookkeeping(entry: ChangeEntry): boolean {
  return entry.risk !== 'destructive' && BOOKKEEPING_TOOLS.has(entry.toolName)
}

/**
 * 扩展名 → 类型。文件类的行按它认，比按工具名准：同一个 `write_local_file`
 * 写的可能是脚本、场景，也可能是 `project.godot`。
 */
const KIND_BY_EXTENSION: Record<string, ChangeKind> = {
  tscn: 'scene',
  scn: 'scene',
  gd: 'script',
  cs: 'script',
  gdshader: 'shader',
  gdshaderinc: 'shader',
  tres: 'resource',
  res: 'resource',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  webp: 'image',
  svg: 'image',
  bmp: 'image',
  tga: 'image',
  exr: 'image',
  hdr: 'image',
  wav: 'audio',
  ogg: 'audio',
  mp3: 'audio',
  ogv: 'video',
  mp4: 'video',
  webm: 'video',
  glb: 'model',
  gltf: 'model',
  fbx: 'model',
  obj: 'model',
  blend: 'model',
  godot: 'config',
  cfg: 'config'
}

/**
 * 工具名 → 类型，扩展名认不出来（或者 target 根本不是路径）时用。
 * 按前缀匹配，第一条命中的算数。
 *
 * gen_* 和导入只在调用失败、没有返回值时才落到这里 —— 那时 target 是参数里的
 * 资产名 / 目标目录，没有扩展名可看。
 */
const KIND_RULES: ReadonlyArray<readonly [string, ChangeKind]> = [
  ['write_local_file', 'file'],
  ['edit_local_file', 'file'],
  ['gen_sprite', 'image'],
  ['gen_tileset', 'image'],
  ['gen_sfx', 'audio'],
  ['gen_music', 'audio'],
  ['gen_voice', 'audio'],
  ['import_to_project', 'folder'],
  ['art_style', 'style'],
  // AI 生成的素材存进素材库，不进工程
  ['generate_image', 'image'],
  ['generate_video', 'video'],
  ['generate_3d_model', 'model'],
  ['rig_3d_model', 'model'],
  ['annotate_asset', 'asset'],
  ['delete_assets', 'asset'],
  ['restore_assets', 'asset'],
  ['move_assets', 'asset'],
  ['create_folders', 'folder'],
  ['rename_folder', 'folder'],
  ['delete_folders', 'folder'],
  ['create_note', 'note'],
  ['update_note', 'note'],
  ['delete_note', 'note'],
  // 只有 browser_interact 会到这里 —— 打开、读取、滚动、截图是 safe，进不了台账
  ['browser_', 'web']
]

function extensionOf(target: string): string {
  const base = target.replace(/\\/g, '/').split('/').pop() || ''
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}

/**
 * 认类型：工程内路径和磁盘路径先看扩展名，再按工具名。
 *
 * 只对路径看扩展名：素材库里的资产名也可能叫 `hero.png`，但它是「素材库资产」，
 * 不是工程里的一张图。认不出来就没有类型标签 —— 一个错的类型比没有类型更误导。
 */
export function changeKindOf(toolName: string, target = ''): ChangeKind | '' {
  if (isResPath(target) || isLocalFileChange({ target })) {
    const kind = KIND_BY_EXTENSION[extensionOf(target)]
    if (kind) return kind
  }
  const rule = KIND_RULES.find(([prefix]) => toolName.startsWith(prefix))
  return rule ? rule[1] : ''
}

/**
 * shell 跑了什么我们不知道，永远标成不可回滚。网页交互同理，而且更彻底：
 * 点出去的那一下发生在别人的服务器上，盒子这边没有任何东西可以撤。
 */
const IRREVERSIBLE_TOOLS = new Set(['run_shell_command', 'browser_interact'])

export function isReversibleTool(toolName: string): boolean {
  return !IRREVERSIBLE_TOOLS.has(toolName)
}

/**
 * 这一次调用能不能撤回。
 *
 * `import_to_project` 默认不覆盖同名文件；带了 `overwrite: true` 就会把工程里
 * 原来那份（可能是用户调过的贴图）换掉，没有快照，撤不回来。
 */
function isReversibleCall(toolName: string, args: unknown): boolean {
  if (toolName === 'import_to_project' && isPlainObject(args) && args.overwrite === true) {
    return false
  }
  return isReversibleTool(toolName)
}

/**
 * detail 的长度上限。
 *
 * 它随对话记录写进 localStorage（配额只有几 MB），而风格描述、命令原文都可能
 * 很长。界面那边还会再截到 80 字显示，这里管的是**存进去多少**。
 */
const MAX_DETAIL_LENGTH = 120

/**
 * 「具体干了什么」target 装不下的那部分 —— 单独抽进 detail。
 *
 * - 命令原文不是工程里的路径，塞进 target 会被当成文件去分组
 * - 编辑器操作没有 target（见 EDITOR_ACTION_TOOLS），打开的是哪个场景、
 *   选中的是哪几个节点全在这里
 * - 美术风格：套用 / 存的是哪个预设，否则是新的风格描述
 */
const DETAIL_READERS: Record<string, (args: Record<string, unknown>) => string> = {
  run_shell_command: (args) => firstString(args, ['command']),
  editor_open_scene: (args) => firstString(args, ['path']),
  editor_play: (args) => firstString(args, ['scene']),
  editor_select: (args) => stringList(args.paths).join(', '),
  art_style: (args) => firstString(args, ['preset', 'prompt'])
}

export function extractChangeDetail(toolName: string, args: unknown): string {
  const read = DETAIL_READERS[toolName]
  if (!read || !isPlainObject(args)) return ''
  const text = read(args)
  return text.length > MAX_DETAIL_LENGTH ? `${text.slice(0, MAX_DETAIL_LENGTH)}…` : text
}

/**
 * 一次调用**实际动到的一样东西**，从工具返回值（`details`）里读出来。
 *
 * 参数说的是「想写什么」，返回值说的是「真写出了哪些文件」。两者不一样：
 * `gen_sprite` 只收一个名字，写出来的是 `res://assets/gen/sprites/hero.png` 和
 * `hero.tres` 两个文件；`import_to_project` 遇到同名文件会跳过。台账要的是后者。
 */
export interface ChangeOutcome {
  target: string
  /** 这个文件原来不存在（只有写文件工具说得出来） */
  created?: boolean
}

/**
 * 一次调用最多展开成几行。
 *
 * 清单的行数应当等于「我的工程里变了几样东西」，所以一次生成三个音效候选就该是
 * 三行。但一次导入可以放进上百个文件，那时逐行列出来只会把面板变成一堵墙 ——
 * 超过上限就退回参数那一行（目标目录），宁可粗，不要不可读。
 */
const MAX_OUTCOME_ROWS = 8

function readOutputs(list: unknown): ChangeOutcome[] {
  return stringList(list).map((target) => ({ target }))
}

/** 写 / 改文件：返回值里的 `fileChange` 带着真实路径和「原来在不在」 */
function readFileWrite(result: Record<string, unknown>): ChangeOutcome[] | null {
  const change = result.fileChange
  if (isPlainObject(change) && typeof change.path === 'string' && change.path.trim()) {
    return [{ target: change.path.trim(), ...(change.created === true ? { created: true } : {}) }]
  }
  // 文件太大或是二进制，没抓快照，但路径照样是准的
  const path = result.fileChangeUnavailable
  return typeof path === 'string' && path.trim() ? [{ target: path.trim() }] : null
}

/**
 * 工具名 → 怎么从它的返回值里读出「动了哪几样东西」。
 *
 * 返回 `null` 是「读不出来」，退回参数那一行；返回空数组是「读出来了，什么都没动」
 * （导入时全是同名跳过），这次调用就不进台账 —— 它确实什么都没改。
 */
const OUTCOME_READERS: Record<string, (result: Record<string, unknown>) => ChangeOutcome[] | null> =
  {
    write_local_file: readFileWrite,
    edit_local_file: readFileWrite,
    import_to_project: (result) =>
      Array.isArray(result.imported) ? readOutputs(result.imported) : null,
    gen_sprite: (result) => readOutputs(result.outputs),
    gen_tileset: (result) => readOutputs(result.outputs),
    gen_sfx: (result) => readOutputs(result.outputs),
    gen_music: (result) => readOutputs(result.outputs),
    // outputs 里混着「台词没变、跳过了」的那些；generated 才是这次真写出来的
    gen_voice: (result) =>
      Array.isArray(result.generated) ? readOutputs(result.generated) : readOutputs(result.outputs)
  }

/**
 * @returns 读出来的那几样东西；读不出来（没配读法、返回值不对、太多）时为 `null`
 */
export function extractChangeOutcomes(toolName: string, result: unknown): ChangeOutcome[] | null {
  const read = OUTCOME_READERS[toolName]
  if (!read || !isPlainObject(result)) return null

  const outcomes = read(result)
  if (outcomes === null) return null
  if (outcomes.length === 0) {
    // gen_* 的 outputs 是空的多半是返回值形状变了，不是「什么都没写」—— 退回参数那行
    return toolName === 'import_to_project' ? [] : null
  }
  return outcomes.length > MAX_OUTCOME_ROWS ? null : outcomes
}

const RISKS: ReadonlySet<string> = new Set<ToolRisk>(['safe', 'mutating', 'destructive'])

function readToolCall(
  item: AgentProcessItem
): { name: string; args: unknown; risk?: ToolRisk } | null {
  const data = item.data as
    | {
        function?: { name?: unknown; arguments?: unknown }
        name?: unknown
        args?: unknown
        risk?: unknown
      }
    | undefined
  if (!data) return null

  const name =
    typeof data.function?.name === 'string'
      ? data.function.name
      : typeof data.name === 'string'
        ? data.name
        : ''
  if (!name) return null

  let args: unknown = data.args
  const rawArgs = data.function?.arguments
  if (typeof rawArgs === 'string') {
    try {
      args = JSON.parse(rawArgs)
    } catch {
      args = undefined
    }
  } else if (rawArgs && typeof rawArgs === 'object') {
    args = rawArgs
  }

  const risk =
    typeof data.risk === 'string' && RISKS.has(data.risk) ? (data.risk as ToolRisk) : undefined
  return risk ? { name, args, risk } : { name, args }
}

/**
 * 从这一轮的过程日志里挑出「真的动了东西」的调用。
 *
 * 只读工具（risk === 'safe'）不算改动 —— 把三十次查询混进来，
 * 用户就看不见那一次真正改了场景的调用了。
 *
 * 调用和结果按**工具名出现的先后**配对：过程日志的结果项里没有 toolCallId，
 * 同名工具的第 n 次调用对应第 n 条结果。
 */
export function summarizeChanges(
  items: AgentProcessItem[],
  riskTable: Record<string, ToolRisk>
): ChangeEntry[] {
  // 配对时连返回值一起留着：真写出了哪几个文件，只有返回值知道
  const resultsByTool = new Map<string, Array<{ isError: boolean; result: unknown }>>()
  for (const item of items) {
    if (item.type !== 'tool-result') continue

    const data = item.data as
      | { toolName?: unknown; isError?: unknown; result?: unknown }
      | undefined
    const toolName = typeof data?.toolName === 'string' ? data.toolName : ''
    if (!toolName) continue

    const list = resultsByTool.get(toolName) || []
    list.push({ isError: data?.isError === true, result: data?.result })
    resultsByTool.set(toolName, list)
  }

  const seenByTool = new Map<string, number>()
  const entries: ChangeEntry[] = []

  for (const item of items) {
    if (item.type !== 'tool-call') continue

    const call = readToolCall(item)
    if (!call) continue

    const declared = riskTable[call.name]
    if (!declared || declared === 'safe') continue

    // 结果按「同名工具第几次调用」配对，所以序号要在下面跳过**之前**占上：
    // 跳过的调用也有自己那条结果，不占位的话后面每一次真调用都会拿到前一次的结果
    const index = seenByTool.get(call.name) ?? 0
    seenByTool.set(call.name, index + 1)

    // 主进程按这次参数算过的风险优先（`riskFor`：`art_style` 的 show / list_presets
    // 是 safe）。它只降不升，老记录里没有就退回按工具名的定级
    const risk = call.risk ?? declared
    if (risk === 'safe') continue

    const paired = resultsByTool.get(call.name)?.[index]
    const failed = paired?.isError === true
    const detail = extractChangeDetail(call.name, call.args)

    const entry: ChangeEntry = {
      toolName: call.name,
      risk,
      // 编辑器操作的 path 是「打开哪个场景」，不是改了哪个文件，见 EDITOR_ACTION_TOOLS
      target: isEditorAction(call.name) ? '' : extractChangeTarget(call.args),
      reversible: isReversibleCall(call.name, call.args),
      failed
    }
    // detail 挂在后面而不是放进字面量：历史消息里存的是没有 detail 的旧条目，
    // 两边结构要保持「可选字段缺席」一致
    if (detail) entry.detail = detail

    // 返回值是事实，参数只是意图。失败的调用没有返回值可读，退回参数那一行
    const outcomes = failed ? null : extractChangeOutcomes(call.name, paired?.result)
    if (outcomes === null) {
      entries.push(entry)
      continue
    }

    for (const outcome of outcomes) {
      entries.push({
        ...entry,
        target: outcome.target,
        ...(outcome.created ? { created: true } : {})
      })
    }
  }

  return entries
}

/** 比较用的路径：统一斜杠；盘符路径不分大小写（Windows 上 D:/A 和 d:\a 是同一个文件） */
function comparablePath(target: string): string {
  const normalized = target.replace(/\\/g, '/')
  return /^[a-z]:\//i.test(normalized) ? normalized.toLowerCase() : normalized
}

function basenameOf(target: string): string {
  return target.replace(/\\/g, '/').split('/').pop() || ''
}

function stemOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

/**
 * 同一个文件的不同写法 → 一个规范写法。
 *
 * 同一个文件在不同工具的参数里写法不一样，不合并就会在清单上占好几行：
 *
 * 1. **磁盘路径的斜杠和大小写**：`D:\game\player.gd` 和 `d:/game/player.gd`。
 * 2. **`res://` 和磁盘路径**：`gen_sprite` 报的是 `res://assets/gen/sprites/hero.tres`，
 *    模型接着用 `edit_local_file` 改它时给的是 `D:/game/assets/gen/sprites/hero.tres`。
 *    渲染层不知道工程根目录，靠「磁盘路径以 `/assets/gen/sprites/hero.tres` 结尾」认；
 *    以磁盘路径为准 —— 它带着改前改后的快照，能看对比。
 * 3. **裸名字**：gen_* 调用失败时只有参数里的 `name`（`hero`），按文件名或去掉
 *    扩展名的文件名并到完整路径上。
 *
 * **对不上唯一一个的不合并**：`res://a/icon.png` 和 `res://b/icon.png` 都叫
 * `icon.png`，`hero.png` 和 `hero.tres` 去掉扩展名都叫 `hero`。这时无法判断指的是
 * 哪个，宁可让它单独占一行，也不能把两样东西并成一个。
 */
function buildTargetAliases(entries: ChangeEntry[]): Map<string, string> {
  const aliases = new Map<string, string>()
  const targets = [...new Set(entries.map((entry) => entry.target).filter(Boolean))]

  // 1. 磁盘路径：第一次出现的写法为准
  const diskByKey = new Map<string, string>()
  for (const target of targets) {
    if (!isLocalFileChange({ target })) continue
    const key = comparablePath(target)
    const known = diskByKey.get(key)
    if (known === undefined) diskByKey.set(key, target)
    else if (known !== target) aliases.set(target, known)
  }
  const disks = [...diskByKey.values()]

  // 2. res:// → 唯一一个以它结尾的磁盘路径
  for (const target of targets) {
    if (!isResPath(target)) continue
    const suffix = `/${comparablePath(target.slice('res://'.length).replace(/^\/+/, ''))}`
    const matches = disks.filter((disk) =>
      comparablePath(disk).toLowerCase().endsWith(suffix.toLowerCase())
    )
    if (matches.length === 1) aliases.set(target, matches[0])
  }

  // 3. 裸名字 → 唯一一个文件名（或去掉扩展名后）对得上的完整路径
  const canonical = [
    ...new Set(
      targets
        .filter((target) => isResPath(target) || isLocalFileChange({ target }))
        .map((target) => aliases.get(target) ?? target)
    )
  ]
  for (const target of targets) {
    if (isResPath(target) || isLocalFileChange({ target })) continue
    const matches = canonical.filter((full) => {
      const base = basenameOf(full)
      return base === target || stemOf(base) === target
    })
    if (matches.length === 1) aliases.set(target, matches[0])
  }

  return aliases
}

/**
 * 把逐次调用的改动清单，按「动的是哪个东西」聚合成一行一个。
 *
 * ## 为什么必须聚合
 *
 * 行数是 agent 的施工步数，不是用户工程里变了几样东西 —— 而这两个数没有关系：
 * 一个脚本可能写一次再改七次，用户关心的始终是「player.gd 被改了」。
 * 聚合之后一行一个文件，行数就等于「我的工程里多了/变了几样东西」，而且
 * 天然有上限。「不爆炸」靠的是这个上限，不是靠折叠。
 *
 * ## 施工步骤没有丢
 *
 * 它们进了 `steps`，同名的合并计数（「修改文件 ×7」），由界面收在
 * 每一行的展开区里。排查问题时要看的就是它，但日常不该占着视野。
 *
 * @param input `summarizeChanges()` 的结果
 */
export function groupChanges(input: ChangeEntry[]): ChangeGroup[] {
  // 不该上面板的先滤掉（见 PANEL_HIDDEN_TOOLS）。挡在这一层而不是写入那一层：
  // 聚合放在渲染侧做，换了规则立刻对历史对话生效，落盘的台账保持完整
  const entries = input.filter((entry) => !PANEL_HIDDEN_TOOLS.has(entry.toolName))

  const canonical = buildTargetAliases(entries)
  const targetOf = (entry: ChangeEntry): string => canonical.get(entry.target) ?? entry.target
  // 取不到目标的（编辑器操作、美术风格）按工具名归一组，带 detail 的再按 detail 拆：
  // 打开两个不同的场景是两件事，并成一行「打开场景 ×2」就看不出开的是哪两个了
  const keyOf = (entry: ChangeEntry): string =>
    targetOf(entry) || (entry.detail ? `${entry.toolName}::${entry.detail}` : entry.toolName)

  // 第一遍只决定「清单上有哪几行」。内务操作不开新行，见 BOOKKEEPING_TOOLS。
  // 分成两遍是为了跟顺序无关：保存碰巧跑在第一次编辑之前，也不该凭空多出一行
  const groups = new Map<string, ChangeGroup>()
  for (const entry of entries) {
    if (isBookkeeping(entry)) continue

    const key = keyOf(entry)
    if (groups.has(key)) continue

    const target = targetOf(entry)
    groups.set(key, {
      key,
      target,
      local: isLocalFileChange({ target }),
      action: 'modified',
      kind: changeKindOf(entry.toolName, target),
      stepCount: 0,
      failedCount: 0,
      irreversibleCount: 0,
      steps: []
    })
  }

  // 第二遍把每一步归进去。对不上任何一行的内务操作就此不显示
  for (const entry of entries) {
    const group = groups.get(keyOf(entry))
    if (!group) continue

    group.stepCount += 1
    if (entry.failed) group.failedCount += 1
    // 失败的那步什么都没干，也就没什么可回滚的，不该计入「撤不回去」
    else if (!entry.reversible) group.irreversibleCount += 1

    // 新建 / 删除按**最后一次**为准：先建后删，净结果是没了；
    // 先删后建（重做一个），净结果是新建。失败的那步不改变结论。
    if (!entry.failed) {
      if (entry.created || CREATE_TOOLS.has(entry.toolName)) group.action = 'created'
      else if (DELETE_TOOLS.has(entry.toolName)) group.action = 'deleted'
    }

    const step = group.steps.find(
      (item) => item.toolName === entry.toolName && item.detail === entry.detail
    )
    if (step) {
      step.count += 1
      if (entry.failed) step.failedCount += 1
    } else {
      const step: ChangeStep = {
        toolName: entry.toolName,
        count: 1,
        failedCount: entry.failed ? 1 : 0
      }
      if (entry.detail) step.detail = entry.detail
      group.steps.push(step)
    }
  }

  return [...groups.values()]
}
