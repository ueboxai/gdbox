/**
 * `gdbox ask "<一句话>"` —— 把一件事交给盒子自己的 Agent，拿回结论。
 *
 * `tools call` 交出去的是零件，调用方得自己知道先调哪个、再调哪个；这一条交出去
 * 的是整个大脑，给脚本、CI、批处理用（Claude Code 的 `claude -p` 是同一个思路）。
 * 背后调的是盒子的 `task` 工具，不带历史对话（`context_mode: fresh`）。
 *
 * ## 权限：白名单，不是全开全关
 *
 * 外部会话里，子任务的每一步都是自动批准的（见主仓库 `hostSession.ts`：客户端
 * 批准了派任务，就等于批准了子任务要做的事）。CLI 没有审批界面，所以这里必须
 * 自己把范围收住：
 *
 *   - 默认只读（`read_only: true`）：写工具根本不进子任务的清单。
 *   - `--allow-write` 才放开改动，而且只放开 **Godot 工具、工程文件、素材库、
 *     工程库**这几摊。shell、浏览器、第三方 MCP、盒子自身的管理一律不给 ——
 *     没人盯着的时候，这些出了错没有回头路。
 *
 * 本地文件（`local`）这一摊要给：Godot 的脚本和场景就是工程目录里的文本文件，
 * 不让子任务读写它们，「给主角加二段跳」这种最常见的活一件都做不了。
 * 能跑任意命令的 `local.shell` 不在这一摊里，照旧不给。
 *
 * ## 模型
 *
 * `--model` 原样交给 `task` 的 `model` 参数，名单和校验都在盒子那边。盒子只配了一个
 * 模型时 `task` 没有这个参数，多给的字段会被悄悄丢掉、照样用默认模型跑，所以先看
 * 清单里的参数表，没有就直接报错。
 *
 * 命名空间从这次的工具清单里现算，不在 CLI 里抄一份：盒子加了新的 `godot.*`
 * 分组，这里自动跟上；抄一份的话，漏掉的那组就成了子任务莫名其妙做不到的事。
 *
 * ## 目标工程怎么交给子任务
 *
 * 两条一起走：
 *
 *   - 工程目录写进给子任务的那句话里。无头工具（`godot_check` 这类）和文件工具
 *     都要一个具体路径，子任务得知道是哪个目录。
 *   - 请求元数据里也带上，让编辑器类工具绑到这个工程的编辑器。元数据要求编辑器
 *     连着：没连着时盒子在**执行之前**就回 `PROJECT_NOT_CONNECTED`，这时去掉
 *     元数据再发一次是安全的 —— 头一次什么都还没做。
 */

import { success, type Envelope } from '../envelope.js'
import { GdboxError } from '../errors.js'
import type { ResolvedProject } from '../project.js'
import * as runtime from '../runtime.js'
import { DELEGATE_TOOL, type CatalogTool } from '../tools.js'

export interface AskOptions {
  prompt: string
  allowWrite: boolean
  project?: string
  /** 子任务用哪个模型，填盒子里候选名单的 id。不给就用盒子的默认模型 */
  model?: string
  configPath?: string
  timeoutSeconds?: number
  env?: NodeJS.ProcessEnv
  /** 子任务汇报进度时调。命令本身只在最后交一个结果，进度靠它实时往外送 */
  onProgress?: (message: string) => void
}

/** Godot 之外、子任务也能碰的几摊：素材库、工程库、工程文件，以及技能加载 */
const EXTRA_NAMESPACES = new Set(['asset', 'project', 'local', 'core'])

/** 这次子任务能用哪些命名空间 */
export function delegateNamespaces(catalog: CatalogTool[]): string[] {
  const namespaces = new Set<string>()
  for (const tool of catalog) {
    const ns = tool.meta.namespace
    if (ns === 'godot' || ns.startsWith('godot.') || EXTRA_NAMESPACES.has(ns)) namespaces.add(ns)
  }
  return [...namespaces].sort()
}

export async function runAsk(options: AskOptions): Promise<Envelope> {
  const prompt = options.prompt.trim()
  if (!prompt) {
    throw new GdboxError(
      'INVALID_ARGUMENT',
      'ask 需要一句话说明要做什么。',
      '例如：gdbox ask "列出主场景里所有节点和它们挂的脚本"'
    )
  }

  const rt = await runtime.open({
    ...(options.configPath ? { configPath: options.configPath } : {}),
    ...(options.timeoutSeconds ? { timeoutSeconds: options.timeoutSeconds } : {}),
    ...(options.env ? { env: options.env } : {})
  })

  try {
    const catalog = await runtime.catalog(rt)
    const delegate = catalog.find((tool) => tool.name === DELEGATE_TOOL)
    if (!delegate) {
      throw new GdboxError(
        'TOOL_UNAVAILABLE',
        `GDBox 没有开放 ${DELEGATE_TOOL}，ask 用不了。`,
        '在 GDBox 的「设置 → MCP」里确认暴露范围没有把 core 命名空间收掉。'
      )
    }

    const model = options.model?.trim()
    if (model && !acceptsModel(delegate)) {
      throw new GdboxError(
        'INVALID_ARGUMENT',
        'GDBox 里只配了一个模型，--model 没有可选的。',
        '在 GDBox 的设置里再配一个模型，或者去掉 --model。'
      )
    }

    const project = await pickProject(rt, options.project, catalog)
    const args = {
      prompt: project ? `目标 Godot 工程：${project.path}\n\n${prompt}` : prompt,
      context_mode: 'fresh',
      namespaces: delegateNamespaces(catalog),
      ...(model ? { model } : {}),
      ...(options.allowWrite ? {} : { read_only: true })
    }
    const progress = { onProgress: options.onProgress ?? ((): void => undefined) }

    const warnings: string[] = []
    let result: runtime.ToolCallResult
    try {
      result = await runtime.callTool(rt, DELEGATE_TOOL, args, project?.path, progress)
    } catch (error) {
      if (!(project && error instanceof GdboxError && error.code === 'PROJECT_NOT_CONNECTED')) {
        throw error
      }
      // 盒子在执行之前就拒了（见文件头），去掉编辑器绑定再发一次
      result = await runtime.callTool(rt, DELEGATE_TOOL, args, undefined, progress)
      warnings.push(
        '这个工程的 Godot 编辑器没连着：子任务用不了 editor_* 工具，无头工具和文件照常可用。'
      )
    }

    if (!project) {
      warnings.push(
        '没有定下目标工程：子任务只能用素材库和工程库。要它改工程，用 --project 指定或在工程目录里运行。'
      )
    }

    return success({
      ...(project ? { project: { name: project.name, path: project.path } } : {}),
      data: {
        answer: runtime.textOf(result),
        readOnly: !options.allowWrite
      },
      warnings
    })
  } finally {
    await rt.close()
  }
}

/** 盒子配了不止一个模型时，`task` 的参数表里才有 `model` */
function acceptsModel(tool: CatalogTool): boolean {
  const properties = (tool.inputSchema as { properties?: Record<string, unknown> } | undefined)
    ?.properties
  return properties !== undefined && 'model' in properties
}

/**
 * 目标工程。
 *
 * 和别的命令一样的规则，只多一条：既没点名、也没有连着的编辑器时不报错 ——
 * 「在素材库里找几张砖墙贴图」这种事本来就不需要工程。
 */
async function pickProject(
  rt: runtime.Runtime,
  explicit: string | undefined,
  catalog: CatalogTool[]
): Promise<ResolvedProject | undefined> {
  try {
    return await runtime.targetProject(rt, explicit, catalog)
  } catch (error) {
    if (error instanceof GdboxError && error.code === 'PROJECT_NOT_CONNECTED') return undefined
    throw error
  }
}
