/**
 * V3 工具注册表。
 *
 * 这是 V2 那 16 个 specialist 的替代品：不再按「谁负责什么」在运行时路由，
 * 而是把全部工具扁平登记在一处，由 `resolveTools` 按会话状态过滤。
 *
 * ## 名字为什么要改
 *
 * V2 里蓝图/材质/粒子等用点号命名（`blueprint.add_node`），但 OpenAI 等厂商
 * 要求工具名匹配 `^[a-zA-Z0-9_-]+$`，点号会被直接拒。所以统一转下划线。
 *
 * 光改名字不够 —— 工具描述里有大量交叉引用（「用 material.add_node 一步完成」），
 * 不一起改的话模型会去调一个不存在的工具。`rewriteCrossReferences` 负责这件事。
 *
 * ## 适配 vs 重写
 *
 * 绝大多数工具走 `adaptV2Tool`（业务逻辑与 schema 逐字保留）。
 * 需要 V3 增量能力（流式进度、图片进上下文、并发语义）的单独重写 ——
 * 材质工具集已经是重写版，所以不在这里适配。
 *
 * ## AIGC
 *
 * 生图、视频和 3D 工具通过主进程调用用户配置的模型服务。
 */

import { aigcTools } from './aigc'
import { godotEditorTools, godotRuntimeTools, reloadEditedScene } from './godot'
import { godotAssetTools } from './godot-asset'
import { taskVideoTools } from './builtin/taskVideo'
import { createWebTools } from './builtin/web'
import { createLocalFileTools } from './builtin/localFiles'
import { createLocalSearchTools } from './builtin/localSearch'
import { createAddNotebookSourceTool } from './builtin/addNotebookSource'
import { createSearchNotebookSourcesTool, type NotebookScope } from './builtin/notebookSources'
import { createBoxTools } from './builtin/box'
import { createOrganizeProjectsTool } from './adapted/project/organizeProjects'
import { createProjectListTool } from './adapted/project/listProjects'
import { createLocalWriteTools, createShellTool } from './builtin/localShell'
import { mcpTools } from './builtin/mcpConnect'
import { createBrowserTools } from './builtin/browser'
import { isDefaultResidentTool } from './builtin/toolSearch'
import { estimateTokens } from '../../../shared/tokenBudget'
import { formatSkillLint, isSkillFile, lintSkillFile } from '../capabilities/skillLint'
import type { WebContents } from 'electron'

import { onSettingsChanged } from '../../ai/store'
import { adaptV2Tool, type V2Tool } from './adaptV2Tool'
import {
  ASK_USER_TOOL_NAME,
  BROWSER_TOOL_NAMES,
  SET_SESSION_PROJECT_RISK,
  SET_SESSION_PROJECT_TOOL_NAME,
  rewriteCrossReferences
} from './toolNames'
import { effectiveRisk, type ToolRisk, type UnrealAgentTool } from './defineTool'
import { fileLockForCall, needsEditorKey } from './godotLocks'
import { acquire, describeConflicts, getLockOwner, releasePaths, sameTeam, teamRootOf } from '../core/assetLock'
import { editorKeyActive, withEditorKey } from '../core/team/editorKey'
import { effectiveConnectionId } from '../core/projectTargetContext'
import { UPDATE_PLAN_TOOL_NAME, WRAP_UP_TOOL_NAME } from '../../../shared/agentTurnReport'

// ── V2 工具工厂 ──────────────────────────────────────────────────────────
import * as noteTools from '../../agent-v3/tools/adapted/note'
import * as assetTools from '../../agent-v3/tools/adapted/asset'

/** 一条登记：V3 名字 + 命名空间 + 风险 + 怎么造出这个 V2 工具 */
interface Registration {
  name: string
  namespace: string
  risk: ToolRisk
  /** 需要 sender 的工具（会给渲染层发通知）用它拿 */
  make: (deps: { sender?: WebContents }) => V2Tool
  /**
   * 没有 sender 就造不出来。
   *
   * 无人值守场景（定时任务、以后的 MCP server）没有窗口可发通知，这类工具
   * 直接跳过 —— 强行传 undefined 会在工具执行时抛 TypeError，
   * 那比一开始就不注册难查得多。
   */
  needsSender?: boolean
  concurrency?: 'sequential' | 'parallel'
  /** 按这次的参数降风险（见 `ToolMeta.riskFor`）。工具自己带了的话这里优先 */
  riskFor?: (args: unknown) => ToolRisk
}

/**
 * 写完一个 SKILL.md 就地体检，报告贴在写入工具的返回值里。
 *
 * 挂在返回值上而不是另做一个 `check_skill` 工具：另做工具就要靠模型记得调，
 * 而它最该调的那一次，恰恰是它以为已经写完的那一次。
 *
 * 只对 SKILL.md 生效，别的文件一律原样返回 —— 写日志、写配置、写脚本
 * 都不该在返回值后面多出一段体检报告。
 */
async function lintWrittenSkill(params: Record<string, unknown>): Promise<string> {
  const path = typeof params.path === 'string' ? params.path : ''
  if (!path || !isSkillFile(path)) return ''

  return formatSkillLint(await lintSkillFile(path, allToolNames()))
}

/**
 * 全部工具名，**不看运行时条件**。
 *
 * 和 `buildAllTools()` 的差别：那个会把没绑知识库时的来源工具滤掉。
 * 体检要判的是「skill 里写的这个工具名存不存在」，不能只看当前会话清单。
 */
export function allToolNames(): Set<string> {
  const names = new Set(buildAllTools().map((t) => t.name))
  for (const reg of REGISTRATIONS) names.add(reg.name)
  names.add('search_notebook_sources')
  names.add('add_notebook_source')
  // skill 层自己的两个工具不在注册表里（`createSkillTools` 按发现结果现造）
  names.add('load_skill')
  names.add('read_skill_resource')
  names.add('task')
  names.add('search_tools')
  // 浏览器工具故意不进 `buildAllTools()`（见 `builtin/browser.ts` 的说明），
  // 但名字必须在这里 —— 否则写了浏览器步骤的 skill 会被体检误报成
  // 「引用了不存在的工具」
  for (const name of BROWSER_TOOL_NAMES) names.add(name)
  // 反问用户同理：在 `resolveTools` 里现造，不进 `buildAllTools()`
  names.add(ASK_USER_TOOL_NAME)
  // 换对话归属同理。系统提示词和 `open_project` 的返回里都写着让模型调它，
  // 名字不在这儿的话，第一个把这套流程写进 SKILL.md 的人会被体检告知
  // 「引用了不存在的工具」，然后把唯一正确的那句删掉
  names.add(SET_SESSION_PROJECT_TOOL_NAME)
  // 任务清单、收尾提问同理
  names.add(UPDATE_PLAN_TOOL_NAME)
  names.add(WRAP_UP_TOOL_NAME)
  return names
}

/**
 * 本地文件工具只造一次。
 *
 * `createLocalFileTools()` 内部会建 `NodeExecutionEnv`，每次都新建一个没有
 * 意义；而且两个工具要共用同一个 env，否则 cwd 语义会各说各话。
 */
let localFileToolsCache: UnrealAgentTool<never>[] | undefined
function getLocalFileTools(): UnrealAgentTool<never>[] {
  if (!localFileToolsCache) {
    localFileToolsCache = [
      ...createLocalFileTools(),
      ...createLocalSearchTools(),
      ...createLocalWriteTools({
        // 写完 SKILL.md 就地体检；写完编辑器开着的场景就让它从磁盘重新加载
        afterWrite: async (params) =>
          (await lintWrittenSkill(params)) + (await reloadEditedScene(params))
      }),
      // shell 工具照常造出来，由 `resolveTools` 按 `local.shell` 命名空间
      // 决定这台机器上给不给 —— 注册表本身是同步的，探测 shell 是异步的
      createShellTool()
    ]
  }
  return localFileToolsCache
}

const REGISTRATIONS: readonly Registration[] = Object.freeze([

  // ── 资产库────────────────────────────────
  {
    name: 'search_assets',
    namespace: 'asset',
    risk: 'safe',
    make: () => assetTools.createSearchAssetsTool()
  },
  // 「我库里有什么」不能靠翻页去数。几十万个资产的库里，search_assets 一页 100 个，
  // 调用方拿到的只会是按名字排在最前的那一百个，然后拿它们总结全库 —— 错得看不出来。
  // 这个工具回的是 SQL 精确算出来的分布，库多大它都只有几百 token。
  {
    name: 'library_overview',
    namespace: 'asset',
    risk: 'safe',
    make: () => assetTools.createLibraryOverviewTool()
  },
  // 读跨库、写不跨库（见 adapted/asset/vaultScope.ts）。于是「东西在另一个库里，
  // 但改动只能在活跃库做」这一幕必然会撞上，出路只有换库 —— 而换库是用户的决定：
  // 应用整个界面会跟着换。所以定成 mutating 走审批门，用户可以放行一次，
  // 也可以点「本对话内都允许」让它以后自己切。
  {
    name: 'switch_vault',
    namespace: 'asset',
    risk: 'mutating',
    make: () => assetTools.createSwitchVaultTool()
  },
  {
    name: 'annotate_asset',
    namespace: 'asset',
    risk: 'mutating',
    make: () => assetTools.createAnnotateAssetTool()
  },
  // 打标签之前得先看得见已有的标签，否则「树 / 树木 / Tree」会越攒越多
  {
    name: 'list_tags',
    namespace: 'asset',
    risk: 'safe',
    make: () => assetTools.createListTagsTool()
  },

  // ── 笔记 ──────────────────────────────────────────────────────────────
  //
  // 实现一直躺在 adapted/note/ 里没人调 —— 于是用户在输入框 @ 了一篇笔记，
  // 模型手上却没有任何能打开它的工具，只能回一句「我读不到」。
  // 笔记是盒子自己的数据，不依赖引擎连接。
  //
  // `create_note` 一度被 deep-research / knowledge-base-and-projects 两个 skill
  // 明令禁用，理由是 agent 建出来的笔记没有任何用户能打开的入口。现在的规则
  // 直接堵死了那个问题：**建笔记必须挂在一个资产或文件夹上**，挂不上就回滚。
  // 规则和话术见 agent/tools/app-control/notes/noteAttachment.ts
  {
    name: 'search_notes',
    namespace: 'note',
    risk: 'safe',
    make: () => noteTools.createSearchNotesTool()
  },
  {
    name: 'get_note',
    namespace: 'note',
    risk: 'safe',
    make: () => noteTools.createGetNoteTool()
  },
  {
    name: 'create_note',
    namespace: 'note',
    risk: 'mutating',
    needsSender: true,
    make: (deps) => noteTools.createCreateNoteTool(deps.sender!)
  },
  // 改笔记是覆盖正文，写坏了没有版本可回；但目标明确、改完用户在详情面板里
  // 立刻看得见，和「删掉」不是一个量级
  {
    name: 'update_note',
    namespace: 'note',
    risk: 'mutating',
    needsSender: true,
    make: (deps) => noteTools.createUpdateNoteTool(deps.sender!)
  },
  // 删笔记没有回收站，而且笔记里可能挂着用户贴的图和视频 —— 每次都问
  {
    name: 'delete_note',
    namespace: 'note',
    risk: 'destructive',
    needsSender: true,
    make: (deps) => noteTools.createDeleteNoteTool(deps.sender!)
  },
  // 看得见、加得上，还得改得动。annotate_asset 遇到新名字会自动建标签，
  // 也就是说 agent 有能力把标签体系搅碎却没能力收拾 —— 改名/改色是可逆的日常整理，
  // 登记成 mutating。
  {
    name: 'manage_tags',
    namespace: 'asset',
    risk: 'mutating',
    make: () => assetTools.createManageTagsTool()
  },
  // 删标签和合并标签**没有回收站**，丢掉的分类信息找不回来 —— 和改名不是一个量级，
  // 所以单独拆出来登记成 destructive，每次都问。
  {
    name: 'delete_tags',
    namespace: 'asset',
    risk: 'destructive',
    make: () => assetTools.createDeleteTagsTool()
  },
  // 软删除（进回收站、能恢复、不动磁盘文件），restore_assets 就能原样捞回来，
  // 是可撤销的改动，登记成 mutating。
  {
    name: 'delete_assets',
    namespace: 'asset',
    risk: 'mutating',
    make: () => assetTools.createDeleteAssetsTool()
  },
  // 恢复和删除必须同时存在。只给删不给恢复，等于让用户在没有撤销键的编辑器里
  // 干活 —— agent 认错一个 assetKey 删掉一条，它自己连补救都做不了。
  {
    name: 'restore_assets',
    namespace: 'asset',
    risk: 'mutating',
    make: () => assetTools.createRestoreAssetsTool()
  },
  {
    name: 'move_assets',
    namespace: 'asset',
    risk: 'mutating',
    make: () => assetTools.createMoveAssetsTool()
  },
  {
    name: 'create_folders',
    namespace: 'asset',
    risk: 'mutating',
    make: () => assetTools.createFoldersTool()
  },
  {
    name: 'rename_folder',
    namespace: 'asset',
    risk: 'mutating',
    make: () => assetTools.createRenameFolderTool()
  },
  // 删文件夹连里面的资产一起软删，restore_folders 连目录树一起恢复 —— 同样可撤销
  {
    name: 'delete_folders',
    namespace: 'asset',
    risk: 'mutating',
    make: () => assetTools.createDeleteFoldersTool()
  },
  // delete_folders 的撤销键。删文件夹连里面的资产一起带走，而 restore_assets
  // 只捞得回资产、捞不回它们原来待的那棵目录树 —— 少了这个，agent 删错一整个
  // 素材包就只能让用户自己去界面里点。不给参数时只列回收站，是只读的。
  {
    name: 'restore_folders',
    namespace: 'asset',
    risk: 'mutating',
    make: () => assetTools.createRestoreFoldersTool()
  },
  /*
   * 工程库的整理（分组、置顶）。
   *
   * 不动用户的磁盘：改的全是盒子自己数据库里的
   * 归类信息，工程文件一个字节都不碰，删合集也只是拆分组、工程照样在库里。
   * 标 destructive 会让「帮我按类型分个组」这种纯整理动作每次弹窗，
   * 用户很快就会养成无脑点确认的习惯 —— 那比不弹更危险（见 splitByRisk.ts）。
   */
  {
    name: 'project_organize',
    namespace: 'project',
    risk: 'mutating',
    make: () => createOrganizeProjectsTool()
  }

  // 旧的 note 工具不在这里注册。产品里的「笔记」早已收进知识库成为 text 来源，
  // 单独 create_note 会写进用户没有入口可见的旧表。知识库读写统一走下面按会话绑定的
  // search_notebook_sources / add_notebook_source。
])

export { rewriteCrossReferences } from './toolNames'

/**
 * 工具名 → 风险等级。
 *
 * 渲染层要靠它算「本轮改动」：哪些调用真的动了东西、哪些不可回滚。
 * 风险声明只有注册表这一份，绝不能在渲染层再抄一张表 —— 抄了必然漂移。
 * 本地文件/shell 工具不在 REGISTRATIONS 里，它们的风险写在工具自身上。
 */
export function listToolRisks(): Record<string, ToolRisk> {
  const table: Record<string, ToolRisk> = {}

  for (const reg of REGISTRATIONS) {
    table[reg.name] = reg.risk
  }

  // V3 原生工具（本地文件、生成、网页、MCP、盒子本身）的风险写在工具自身上
  for (const tool of [
    ...getLocalFileTools(),
    ...createBoxTools(),
    ...godotRuntimeTools(),
    ...godotEditorTools(),
    ...godotAssetTools(),
    createProjectListTool() as unknown as UnrealAgentTool<never>,
    ...aigcTools(),
    ...(taskVideoTools() as unknown as UnrealAgentTool<never>[]),
    ...mcpTools
  ]) {
    table[tool.name] = tool.unrealBox.risk
  }

  /*
   * 在 `resolveTools` 里现造、进不了 `REGISTRATIONS` 的那个写工具。
   * 漏了它，渲染层的「本轮改动」会把一次换工程归属完全略过。
   */
  table[SET_SESSION_PROJECT_TOOL_NAME] = SET_SESSION_PROJECT_RISK

  return table
}

/**
 * 「设置 → 工具」那一页要显示的清单。
 *
 * 和 `buildAllTools()` 的差别只在**浏览器工具**：那几个是在 `resolveCandidateTools`
 * 里按会话现造的，进不了 `buildAllTools()`。但用户在设置页找不到「浏览网页」
 * 这一摊的话，会以为盒子根本没有这个能力 —— 所以这里补上，用不带会话的实例
 * 取名字和说明（只读元数据，不会碰到任何浏览器状态）。
 *
 * 仍然不补的是 `load_skill` / `ask_user` / `task` / `search_tools` 那几个：
 * 它们在 `ALWAYS_RESIDENT_TOOL_NAMES` 里，本来就不给开关，列出来只会多几行
 * 点不动的东西。
 */
export interface ToolCatalogEntry {
  name: string
  namespace: string
  description: string
  risk: ToolRisk
  /** 没人动过设置时，工具搜索模式下它是不是常驻 */
  defaultResident: boolean
  /**
   * 这一条塞进每次请求要花多少 token（名字 + 说明 + 参数表）。
   *
   * 用运行时那个 `estimateTokens`，不是门禁里那个真 tokenizer ——
   * `gpt-tokenizer` 是 devDependency，打包进去的应用里没有它。
   * 它按「中文一字一 token」算，偏保守（往多了估），而设置页要回答的是
   * 「大概多少」，估多一点好过让用户以为前缀很便宜。
   */
  tokens: number
}

export function listToolCatalog(deps: BuildToolsDeps = {}): ToolCatalogEntry[] {
  const tools = [...buildAllTools(deps), ...createBrowserTools()]
  return tools
    .map((tool) => ({
      name: tool.name,
      namespace: tool.unrealBox.namespace,
      description: tool.description,
      risk: tool.unrealBox.risk,
      defaultResident: isDefaultResidentTool(tool),
      tokens: estimateTokens(
        JSON.stringify({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters
        })
      )
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** 工具名必须符合厂商约定，否则请求会被直接拒 */
const VALID_TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/

export interface BuildToolsDeps {
  sender?: WebContents
  /**
   * 这条对话绑着的知识库。
   *
   * 只有绑了才注册检索工具：没绑的对话给出这个工具，模型调了只能拿到
   * 一句「没有知识库」—— 那是白费一步，而且看上去像功能坏了。
   * `'all'` 是全盒子范围（外部 MCP 会话），见 `NotebookScope`。
   */
  notebook?: NotebookScope
}

let cache: UnrealAgentTool<never>[] | undefined

/*
 * 用户改了 AI 配置就把工具表作废。
 *
 * 工具**几乎都是**无状态的，唯一的例外是 `generate_3d_model`：它的入参表取决于
 * 用户给「3D 生成」绑的是哪家厂商（厂商特供开关只对绑了那一家的人暴露）。
 * 不订阅的话，用户在偏好设置里换完厂商要重启应用才生效 —— 而那种「改了没反应」
 * 最难查，因为界面上配置明明是新的。
 */
onSettingsChanged(() => {
  cache = undefined
})

/**
 * 造出全部工具。
 *
 * 结果缓存：工具是无状态的，每轮对话重造一遍要跑 60 多次 Zod→JSON Schema 转换。
 */
export function buildAllTools(deps: BuildToolsDeps = {}): UnrealAgentTool<never>[] {
  if (cache && !deps.sender && !deps.notebook) return cache

  const adapted = REGISTRATIONS.filter((reg) => !reg.needsSender || deps.sender).map((reg) => {
    if (!VALID_TOOL_NAME.test(reg.name)) {
      throw new Error(`工具名 "${reg.name}" 不符合厂商约定 ^[a-zA-Z0-9_-]{1,64}$`)
    }
    const v2 = reg.make(deps)
    return adaptV2Tool(v2, {
      name: reg.name,
      namespace: reg.namespace,
      risk: reg.risk,
      ...(reg.riskFor ? { riskFor: reg.riskFor } : {}),
      description: rewriteCrossReferences(v2.description ?? reg.name),
      ...(reg.concurrency ? { concurrency: reg.concurrency } : {})
    })
  }) as unknown as UnrealAgentTool<never>[]

  // V3 原生工具（带 risk / 并发声明）不走适配 ——
  // 再包一层 adaptV2Tool 会因为找不到 inputSchema 而直接抛
  const all = [
    ...adapted,
    // 检查、试玩、截图：起一个无头 Godot，编辑器没开也能用
    ...godotRuntimeTools(),
    // 用户开着的那个编辑器：要 GDBox Link 连着
    ...godotEditorTools(),
    // 精灵、瓦片、音效、循环音乐、配音：直接写成工程里能用的 Godot 资源
    ...godotAssetTools(),
    // 「我的项目」里登记了哪些工程（只读）；整理分组在 REGISTRATIONS 的 project_organize
    createProjectListTool() as unknown as UnrealAgentTool<never>,
    ...aigcTools(),
    ...(taskVideoTools() as unknown as UnrealAgentTool<never>[]),
    // 无头检索：只读、不开窗口、不弹审批。和 browser_* 的分工见 builtin/web.ts
    ...createWebTools(),
    // 接入第三方 MCP server。和引擎清单一样是盒子的本地能力，不依赖引擎连接 ——
    // 用户说「我装了个 MCP 你连一下」的时候，引擎往往还没开
    ...mcpTools,
    ...getLocalFileTools(),
    // 盒子本身：看盒子助手的对话、盒子状态，管技能 / 第三方 MCP / 导入 / 备份。
    // 外部 MCP 客户端靠它看见盒子，见 builtin/box.ts
    ...createBoxTools(),
    // 检索只能搜当前绑定的知识库（外部会话是全部）；存来源在未绑定时会新建知识库。
    // 两者都不进 cache —— 每条对话绑的库不一样；存来源还需要 sender 通知界面刷新。
    ...((deps.notebook
      ? [createSearchNotebookSourcesTool(deps.notebook)]
      : []) as unknown as UnrealAgentTool<never>[]),
    ...((deps.sender
      ? [createAddNotebookSourceTool(deps.notebook, deps.sender)]
      : []) as unknown as UnrealAgentTool<never>[])
  ]

  // 锁包在这里：这个数组是全部工具唯一汇合的地方，以后加的写工具不会漏。
  // 先过文件锁（同会话外拿不到立刻失败），再排编辑器钥匙（拿不到就等）
  const guarded = all.map((tool) => withFileLock(withEditorKeyGate(tool)))

  assertUniqueNames(guarded)
  if (!deps.sender && !deps.notebook) cache = guarded
  return guarded
}

/** 工作室模式撞上队友的锁时，最多等多久、多久看一次 */
const TEAM_LOCK_WAIT_MS = 90_000
const TEAM_LOCK_POLL_MS = 2_000

function sleepUnlessAborted(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error('Operation aborted'))
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(signal?.reason ?? new Error('Operation aborted'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * 写工程里的文件之前先拿这个文件的锁（见 `godotLocks.ts`）。
 *
 * 拿不到**抛异常**而不是返回 isError —— pi 判定工具失败的唯一依据是 execute 有没有抛。
 * 拿到之后不放：锁跟着一整轮 run，由 ipc 层在 finally 里统一放掉，
 * 否则同一轮里两次写之间的空窗正好够别人插进来。工作室模式的制作人例外，见函数体。
 *
 * 工作室模式撞上队友的锁先等一会儿：团队并行时撞锁是常态，立刻失败只会让模型改排任务、
 * 几轮之后再回来补。等不到再报，报的时候说清是哪个队友。
 */
function withFileLock(tool: UnrealAgentTool<never>): UnrealAgentTool<never> {
  if (tool.unrealBox.risk === 'safe') return tool
  const inner = tool.execute.bind(tool)
  return {
    ...tool,
    execute: async (toolCallId, params, signal, onUpdate) => {
      const owner = getLockOwner()
      const target = owner ? fileLockForCall(tool.name, params) : null
      if (!owner || !target || effectiveRisk(tool.unrealBox, params) === 'safe') {
        return inner(toolCallId, params, signal, onUpdate)
      }
      const team = editorKeyActive()
      let result = acquire(target.projectDir, owner, [target.resPath], { soft: true })
      const deadline = Date.now() + TEAM_LOCK_WAIT_MS
      while (
        !result.ok &&
        team &&
        Date.now() < deadline &&
        result.conflicts.every((conflict) => sameTeam(conflict.owner, owner))
      ) {
        await sleepUnlessAborted(TEAM_LOCK_POLL_MS, signal)
        result = acquire(target.projectDir, owner, [target.resPath], { soft: true })
      }
      if (!result.ok) throw new Error(describeConflicts(result.conflicts, owner))
      // 工作室模式的制作人：它那一轮就是整局，锁只占这一次调用，不然它碰过的文件队友到交付前都改不了。
      // 队员照旧占到这件活交回（`releaseAll` 在派活的 finally 里）
      const producer = team && teamRootOf(owner) === owner
      if (!producer) return inner(toolCallId, params, signal, onUpdate)
      try {
        return await inner(toolCallId, params, signal, onUpdate)
      } finally {
        releasePaths(target.projectDir, owner, [target.resPath])
      }
    }
  } as UnrealAgentTool<never>
}

/**
 * 工作室模式下，改编辑器状态的工具先拿编辑器钥匙（见 `core/team/editorKey.ts`）。
 * 不在工作室模式里就原样透传，普通会话零改变。
 */
function withEditorKeyGate(tool: UnrealAgentTool<never>): UnrealAgentTool<never> {
  if (!needsEditorKey(tool.unrealBox)) return tool
  const inner = tool.execute.bind(tool)
  return {
    ...tool,
    execute: (toolCallId, params, signal, onUpdate) =>
      editorKeyActive()
        ? withEditorKey(
            effectiveConnectionId() ?? 'default',
            () => inner(toolCallId, params, signal, onUpdate),
            signal
          )
        : inner(toolCallId, params, signal, onUpdate)
  } as UnrealAgentTool<never>
}

/** 重名会让后注册的工具静默覆盖前一个，模型看到的行为与描述对不上 */
function assertUniqueNames(tools: UnrealAgentTool<never>[]): void {
  const seen = new Set<string>()
  for (const tool of tools) {
    if (seen.has(tool.name)) throw new Error(`工具名重复：${tool.name}`)
    seen.add(tool.name)
  }
}

/** 测试用：清掉缓存 */
export function resetToolCacheForTest(): void {
  cache = undefined
}
