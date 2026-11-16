/**
 * 命令共用的运行时：连上、拿清单、定工程、调工具、收尾。
 *
 * 每条命令都要走同一串动作，散在各命令里写会各写各的 —— 而其中最容易写歪的
 * 恰恰是「结束会话」和「超时之后怎么报执行状态」这两件不显眼的事。
 */

import type { Client } from '@modelcontextprotocol/sdk/client/index.js'

import { resolveConnection, type HostConnection } from './config.js'
import {
  connect,
  DEFAULT_TIMEOUT_SECONDS,
  requireContract,
  withDeadline,
  type Session
} from './connection.js'
import { GdboxError } from './errors.js'
import { interruptSignal } from './interrupt.js'
import {
  localProject,
  pickConnected,
  type RegisteredProject,
  type ResolvedProject
} from './project.js'
import { fetchCatalog, type CatalogTool } from './tools.js'

/** 「我的项目」清单工具。`projects list`、`doctor` 和第 3 级工程解析都靠它 */
export const PROJECT_LIST_TOOL = 'project_list'

export interface RuntimeOptions {
  configPath?: string
  timeoutSeconds?: number
  env?: NodeJS.ProcessEnv
}

export interface Runtime {
  host: HostConnection
  session: Session
  client: Client
  /** 剩余期限内跑一个 promise，超时抛 TIMEOUT */
  deadline<T>(promise: Promise<T>, what: string): Promise<T>
  /** 期限还剩多少毫秒 */
  remainingMs(): number
  /** 期限是多少秒（报超时用） */
  timeoutSeconds: number
  close(): Promise<void>
}

/**
 * 连上并准备好一条命令的运行环境。
 *
 * `--timeout` 从**开始连接**算起，不是从工具调用算起（§7）：用户关心的是
 * 「这条命令多久能返回」，而不是它内部哪一段花了多久。
 */
export async function open(options: RuntimeOptions = {}): Promise<Runtime> {
  const startedAt = Date.now()
  const budgetMs = (options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1000

  const host = await resolveConnection({
    ...(options.configPath ? { configPath: options.configPath } : {}),
    ...(options.env ? { env: options.env } : {})
  })
  const session = await connect(host)

  return {
    host,
    session,
    client: session.client,
    remainingMs: () => budgetMs - (Date.now() - startedAt),
    timeoutSeconds: options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS,
    deadline: <T>(promise: Promise<T>, what: string): Promise<T> => {
      const remaining = budgetMs - (Date.now() - startedAt)
      if (remaining <= 0) {
        return Promise.reject(timeoutError(what, options.timeoutSeconds))
      }
      return withDeadline(promise, remaining, () => timeoutError(what, options.timeoutSeconds))
    },
    close: () => session.close()
  }
}

/**
 * 超时。
 *
 * 执行状态一律 `unknown` —— 请求已经发出去了，我们只是不再等。说成 `failed`
 * 等于替引擎宣布一件没看见的事；调用方据此重发，就可能把一个已经成功的操作
 * 做第二遍。
 */
function timeoutError(what: string, seconds: number | undefined): GdboxError {
  const limit = seconds ?? DEFAULT_TIMEOUT_SECONDS
  return new GdboxError(
    'TIMEOUT',
    `等待「${what}」超过 ${limit} 秒。`,
    '请求可能已经发到引擎了，结果无法确认。先去核实现场，不要直接重发；' +
      '本来就需要长时间等待的调用（比如等编辑器重启）请显式加大 --timeout。',
    'unknown'
  )
}

/** MCP SDK 的请求超时（`ErrorCode.RequestTimeout`） */
function isSdkTimeout(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === -32001
}

/** 取工具清单（先确认契约在） */
export async function catalog(runtime: Runtime): Promise<CatalogTool[]> {
  requireContract(runtime.session)
  return runtime.deadline(fetchCatalog(runtime.client), '读取工具清单')
}

/**
 * 调一个工具。
 *
 * `projectPath` 走请求元数据，不动工具自己的业务参数 —— 那些 schema 是既有的，
 * 往里塞一个 CLI 专用字段会让所有工具的参数校验都要跟着改。
 */
export async function callTool(
  runtime: Runtime,
  name: string,
  args: Record<string, unknown>,
  projectPath?: string,
  /**
   * 给了就改成「多久没有进度算超时」：每收到一条进度，计时从头算。
   * 给一跑几分钟、一直在汇报的 `task` 用 —— 按整条命令的期限算，它必死无疑。
   */
  progress?: { onProgress: (message: string) => void }
): Promise<ToolCallResult> {
  const request = {
    name,
    arguments: args,
    _meta: {
      unrealBox: {
        cliContractVersion: 1,
        ...(projectPath ? { projectPath } : {})
      }
    }
  }

  let raw: unknown
  if (progress) {
    try {
      raw = await runtime.client.callTool(request, undefined, {
        timeout: runtime.timeoutSeconds * 1000,
        resetTimeoutOnProgress: true,
        signal: interruptSignal(),
        onprogress: (update) => {
          if (update.message) progress.onProgress(update.message)
        }
      })
    } catch (error) {
      throw isSdkTimeout(error)
        ? new GdboxError(
            'TIMEOUT',
            `${name} 超过 ${runtime.timeoutSeconds} 秒没有任何进度。`,
            '子任务可能还在盒子里跑，也可能已经做了一部分。先去核实现场，不要直接重发；' +
              '本来就会长时间不出声的任务请加大 --timeout。',
            'unknown'
          )
        : error
    }
  } else {
    // SDK 自己还有一道 60 秒的请求超时，比整条命令的期限先到 —— 那样超时会以一个
    // 普通异常冒出来，被当成「工具失败」（退出码 8），调用方据此重发就可能做第二遍。
    // 把它放到期限之外，让期限说了算，超时一律按「结局不明」报
    raw = await runtime.deadline(
      runtime.client.callTool(request, undefined, {
        timeout: Math.max(runtime.remainingMs(), 0) + 5_000,
        signal: interruptSignal()
      }),
      `调用 ${name}`
    )
  }

  const result = raw as ToolCallResult

  // HTTP 200 和 MCP 请求成功都不等于工具成功（§6.2）。isError 必须查。
  if (result.isError) {
    const code = (result._meta?.unrealBox as { errorCode?: string } | undefined)?.errorCode
    throw toolFailure(name, result, code)
  }

  return result
}

export interface ToolCallResult {
  content?: Array<Record<string, unknown>>
  structuredContent?: Record<string, unknown>
  isError?: boolean
  _meta?: Record<string, unknown>
}

/**
 * 把工具失败翻成带码的错误。
 *
 * 服务端在 `_meta.unrealBox.errorCode` 里给了机器可读的码，用它。
 * 认不出来的一律归 `TOOL_FAILED` 并**保留原始诊断** —— 不去按中文字符串
 * 猜更精细的类别，那是在编造分类（§6.2）。
 */
function toolFailure(name: string, result: ToolCallResult, code: string | undefined): GdboxError {
  const message = textOf(result) || `${name} 执行失败`

  // 「按这个条件没查到」不是故障。归成一个专用码，让调用点自己决定怎么读它
  if (code === 'ENGINE_NOT_FOUND') {
    return new GdboxError('ENGINE_NOT_FOUND', message, undefined, 'not_started')
  }

  // 引擎那侧等超时了。**这不是失败**：请求已经到引擎，操作可能已经生效。
  //
  // 外部评审抓到的：写工具内部等 60 秒，比 CLI 默认的 120 秒先到，所以真机上
  // 超时几乎总是走这条路。原来它掉进下面的 default 被标成 `failed`，
  // 调用方据此重试就可能把同一件事做第二遍 —— §12 整套规则要防的正是这个。
  if (code === 'ENGINE_TIMEOUT') {
    return new GdboxError(
      'TIMEOUT',
      message,
      '引擎在超时前没有回话，操作可能已经生效。先去核实，不要直接重发。',
      'unknown'
    )
  }

  switch (code) {
    case 'PROJECT_NOT_CONNECTED':
    case 'PROJECT_AMBIGUOUS':
    case 'TOOL_UNAVAILABLE':
    case 'INVALID_ARGUMENT':
      return new GdboxError(code, message, undefined, 'not_started')
    default:
      // 引擎那侧明确回了失败，所以是 failed 而不是 unknown。
      // 但 failed **不承诺副作用已经回滚**。
      return new GdboxError('TOOL_FAILED', message, undefined, 'failed')
  }
}

/** 把结果里的文本块拼起来。图片块不进来 —— 终端不打印 base64（§6.3） */
export function textOf(result: ToolCallResult): string {
  return (result.content ?? [])
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('\n')
}

/**
 * 「我的项目」里登记着哪些工程，以及哪些工程的编辑器连着。
 *
 * 复用 `project_list` 而不是另开一个网络接口：那份数据盒子已经有了，
 * 再做一个只会多一处会漂移的真相。
 *
 * **只读结构化结果**，不去拆它那段给模型看的文字 —— 那是今天能跑、
 * 改一个标点就静默失效的接口。
 *
 * @returns 盒子没开放这个工具、或者没给结构化结果时为 undefined（由调用方决定怎么报）
 */
export async function listProjects(
  runtime: Runtime,
  tools?: CatalogTool[]
): Promise<RegisteredProject[] | undefined> {
  const all = tools ?? (await catalog(runtime))
  if (!all.some((tool) => tool.name === PROJECT_LIST_TOOL)) return undefined

  const result = await callTool(runtime, PROJECT_LIST_TOOL, {})
  const projects = result.structuredContent?.projects
  if (!Array.isArray(projects)) return undefined

  return projects
    .map((entry) => entry as Record<string, unknown>)
    .filter((entry) => typeof entry.path === 'string' && entry.path !== '')
    .map((entry) => ({
      name: typeof entry.name === 'string' && entry.name ? entry.name : '(未命名工程)',
      path: entry.path as string,
      godotVersion:
        typeof entry.godotVersion === 'string' && entry.godotVersion ? entry.godotVersion : null,
      onDisk: typeof entry.onDisk === 'boolean' ? entry.onDisk : null,
      editorConnected: entry.editorConnected === true,
      projectKey: typeof entry.projectKey === 'string' ? entry.projectKey : null
    }))
}

/** `listProjects` 拿不到结构化清单时的报错，`projects list` 和 `doctor` 共用 */
export function projectListUnavailable(): GdboxError {
  return new GdboxError(
    'INCOMPATIBLE_SERVER',
    'GDBox 没有返回结构化的工程清单（project_list）。',
    '升级 GDBox。在那之前用 --project 指定工程目录，其余命令照常可用。'
  )
}

/**
 * 定下这一条命令的目标工程（三级顺序见 `project.ts`）。
 *
 * @returns 前两级没有线索、而盒子又给不出结构化清单时为 undefined ——
 *   这时候不猜，由调用方决定是不带目标发出去（让盒子自己判），还是报错
 */
export async function targetProject(
  runtime: Runtime,
  explicit: string | undefined,
  tools?: CatalogTool[]
): Promise<ResolvedProject | undefined> {
  const local = await localProject(explicit)
  if (local) return local

  const registered = await listProjects(runtime, tools)
  return registered ? pickConnected(registered) : undefined
}
