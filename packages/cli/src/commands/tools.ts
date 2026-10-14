/**
 * `gdbox tools list / show / call`。
 *
 * ## list 只给名字和简述，show 才给完整 schema
 *
 * 清单有五十来个工具，每个的完整 JSON Schema 加起来是几万 token。列表那一步
 * 调用方要的是「有没有我想要的那个」，把 schema 全塞进去只会让它更难找。
 *
 * ## 不为没验证过的工具编示例
 *
 * `show` 回的是服务端给的真实描述和参数定义。**不根据工具名字自动生成
 * 「示例参数」** —— 那种示例看着能直接抄，但没有人验证过它能跑，
 * 抄了跑不通比没有示例更浪费时间。只有维护并验证过的快捷命令才带固定示例。
 */

import { success, type Envelope } from '../envelope.js'
import { GdboxError } from '../errors.js'
import * as runtime from '../runtime.js'
import { localProject, type ResolvedProject } from '../project.js'
import { readToolArgs } from '../toolArgs.js'
import {
  acceptsProjectPath,
  requireSupported,
  search,
  supportedTools,
  type CatalogTool
} from '../tools.js'

export interface ToolsOptions {
  configPath?: string
  timeoutSeconds?: number
  env?: NodeJS.ProcessEnv
  /** 这次允许调用会改动工程的工具 */
  allowWrite?: boolean
}

function openOptions(options: ToolsOptions): runtime.RuntimeOptions {
  return {
    ...(options.configPath ? { configPath: options.configPath } : {}),
    ...(options.timeoutSeconds ? { timeoutSeconds: options.timeoutSeconds } : {}),
    ...(options.env ? { env: options.env } : {})
  }
}

/** 描述截断到一行，给列表用。完整描述去 `show` 拿 */
function brief(tool: CatalogTool): string {
  const firstLine = tool.description.split('\n')[0]?.trim() ?? ''
  return firstLine.length > 120 ? `${firstLine.slice(0, 117)}…` : firstLine
}

export async function runToolsList(options: ToolsOptions & { search?: string }): Promise<Envelope> {
  const allowWrite = options.allowWrite === true

  const rt = await runtime.open(openOptions(options))
  try {
    const all = await runtime.catalog(rt)
    const inScope = supportedTools(all, allowWrite)
    const usable = search(inScope, options.search)
    const writable = all.filter((tool) => tool.write)

    return success({
      data: {
        tools: usable.map((tool) => ({
          name: tool.name,
          brief: brief(tool),
          namespace: tool.meta.namespace,
          risk: tool.meta.risk,
          projectScoped: tool.meta.projectScoped,
          // 调用方要能分辨哪些会改东西。写工具一律要 --allow-write
          mutatesProject: tool.write
        })),
        returnedCount: usable.length,
        // 服务端开放的总数，和 CLI 能调的那部分不是一回事 —— 说清楚，
        // 免得用户以为盒子里只有这几个工具
        exposedByHost: all.length,
        // 「够不着」和「这次没开」是两回事，分开报：前者没有下一步，
        // 后者加一个开关就有。混在一个数字里，调用方读不出该干什么
        outOfScope: all.filter((tool) => !tool.readOnly && !tool.write).length,
        writeToolCount: writable.length
      },
      warnings: [
        ...(usable.length === 0 && options.search
          ? [`没有匹配「${options.search}」的工具。去掉 --search 看完整清单。`]
          : []),
        /*
         * 不说的话，用户会以为盒子只开了只读工具，而实际上是 CLI 这头没开。
         *
         * 只报个数不再逐个列名：放开范围之后写工具是几十个量级，列出来会把
         * 这条提示变成一屏刷不完的噪音，而调用方真要看清单，加上开关重跑一次
         * 就有 —— 那才是它下一步该做的事。
         */
        ...(!allowWrite && writable.length > 0
          ? [
              `另有 ${writable.length} 个会改动东西的工具没有列出来。` +
                '加 --allow-write 才会列出并允许调用。'
            ]
          : [])
      ]
    })
  } finally {
    await rt.close()
  }
}

export async function runToolsShow(options: ToolsOptions & { name: string }): Promise<Envelope> {
  const rt = await runtime.open(openOptions(options))
  try {
    const all = await runtime.catalog(rt)
    /*
     * 看参数定义不需要 `--allow-write`。
     *
     * 这里原来跟着 call 一起判开关，于是「我想知道这个工具怎么调」也会被
     * 一句「这条命令没有开写操作」挡回去 —— 而调用方正是要先看懂 schema
     * 才拼得出那条带开关的命令。放开范围之后这道坎会落在几十个工具上，
     * 等于把发现能力一起关掉了。真正会改东西的是 call，开关留在那一步。
     */
    const tool = requireSupported(all, options.name, true)

    return success({
      data: {
        name: tool.name,
        // 原文照给，不做翻译 —— 这些描述是给模型看的，转述一手只会丢信息
        description: tool.description,
        inputSchema: tool.inputSchema,
        namespace: tool.meta.namespace,
        risk: tool.meta.risk,
        projectScoped: tool.meta.projectScoped,
        requiresAllowWrite: tool.write,
        ...(tool.meta.projectScoped
          ? {
              projectRequirement:
                '这个工具操作用户开着的 Godot 编辑器，调用时要能定下目标工程，且那个工程的编辑器连着。'
            }
          : acceptsProjectPath(tool)
            ? {
                projectRequirement:
                  '参数里没给 project_path 时，CLI 用 --project 或当前目录所在的工程补上。'
              }
            : {})
      },
      warnings: tool.write ? ['这个工具会改动东西，调用时要加 --allow-write。'] : []
    })
  } finally {
    await rt.close()
  }
}

export async function runToolsCall(
  options: ToolsOptions & {
    name: string
    args?: string
    argsFile?: string
    project?: string
  }
): Promise<Envelope> {
  // 参数在连接之前就解析好：写错 JSON 不该先去打扰盒子
  const args = await readToolArgs({
    ...(options.args !== undefined ? { args: options.args } : {}),
    ...(options.argsFile !== undefined ? { argsFile: options.argsFile } : {})
  })

  const rt = await runtime.open(openOptions(options))
  try {
    const all = await runtime.catalog(rt)
    const tool = requireSupported(all, options.name, options.allowWrite === true)

    /*
     * 目标工程怎么交过去，看工具要什么：
     *
     *   - 编辑器类（projectScoped）：走请求元数据，由盒子核对那个工程的编辑器
     *     连没连着。定不下来（前两级没线索、盒子又给不出清单）就不带，让盒子
     *     按「恰好一个连接」自己判 —— 它同样不猜。
     *   - 参数里有 `project_path` 的（godot_check 这类无头工具）：调用方没填就
     *     用 --project / 当前目录补上。**不走元数据**：元数据要求编辑器连着，
     *     而无头工具本来就不需要编辑器。
     *   - 其余工具与工程无关，不强绑（§5）。
     */
    let project: ResolvedProject | undefined
    if (tool.meta.projectScoped) {
      project = await runtime.targetProject(rt, options.project, all)
    } else if (acceptsProjectPath(tool) && args.project_path === undefined) {
      project = await localProject(options.project)
      if (project) args.project_path = project.path
    }

    /*
     * `tools call` 一律原样转发，不按工具名收窄参数。
     *
     * 收窄会让 `tools call` 比盒子自己的 agent **更窄**：完全正常的调用被 CLI
     * 挡在半路，而挡它的理由（CLI 写不出每个工具的回读判据）是 CLI 的局限，
     * 不是用户的问题。
     *
     * 所以 `tools call` 是对等入口，转发什么就发什么，核实由工具自己的返回值
     * 负责（这个仓库的硬规矩：工具不回读就不许报 success）。
     *
     * ## 超时
     *
     * CLI 给不出一条具体的回读命令 —— 它不知道「这次动的是哪个东西」，
     * 那是工具自己的语义。所以只说清楚两件事：
     * **别直接重发**，以及**该去问谁**。编一句「查到 = 已生效」比不给更坏。
     */
    let result: runtime.ToolCallResult
    try {
      result = await runtime.callTool(
        rt,
        tool.name,
        args,
        tool.meta.projectScoped ? project?.path : undefined
      )
    } catch (error) {
      throw error instanceof GdboxError && error.code === 'TIMEOUT' && tool.write
        ? new GdboxError(
            'TIMEOUT',
            `${tool.name} 的执行结局不明（请求已发出，未收到结果）。`,
            '不要直接重发 —— 先用只读工具查一遍它到底做了没有' +
              '（场景结构用 editor_scene_tree，脚本和资源用 godot_check，' +
              '工程库用 project_list）。确认没做才重发。',
            'unknown'
          )
        : error
    }

    return success({
      ...(project ? { project: { name: project.name, path: project.path } } : {}),
      data: {
        // 有公共 serializer 就给结构化的，没有就是 null 并保留原文（§6.3）。
        // 不把中文摘要硬拆成业务字段。
        structured: result.structuredContent ?? null,
        content: result.content ?? []
      }
    })
  } finally {
    await rt.close()
  }
}
