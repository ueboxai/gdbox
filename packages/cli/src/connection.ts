/**
 * 连到盒子的 MCP 服务。
 *
 * ## 一条命令一条会话
 *
 * 每个 CLI 进程建立自己的会话，跑完主动结束它、关掉传输。不复用、不留后台。
 * 结束会话这件事要**显式做**（`terminateSession()`）—— 只关传输的话，服务端
 * 那条会话要等空闲超时才回收，连着跑十条命令就在盒子里留十条残骸。
 *
 * ## 先读契约再干活
 *
 * 不认这套契约的服务没有 `capabilities.experimental.unrealBox`（协议字段名沿用
 * 虚幻盒子时期的命名，两边一致即可）。这时候连通性是好的，
 * 但 `--project` 发过去会被**静默忽略** —— 命令看起来成功了，只是发给了
 * 另一个工程。所以除了纯连通性检查（doctor 的第一段），任何要干活的命令
 * 都必须先确认契约在。
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

import type { HostConnection } from './config.js'
import { GdboxError } from './errors.js'

/** 本 CLI 实现的契约版本。和服务端 `externalTarget.ts` 的常量必须一致 */
export const CLI_CONTRACT_VERSION = 1

/** 连接阶段的期限。本机回环连不上就是连不上，等再久也一样 */
export const CONNECT_TIMEOUT_MS = 5_000

/** 服务连不上时的下一步。服务默认开着，只有用户自己关过才需要去开 */
const SERVICE_HINT =
  '确认 GDBox 正在运行。对外服务默认开着，' +
  '只有你自己在「设置 → MCP → 共享引擎能力」里关过才需要重新打开。'

/** 整条命令的默认期限（秒）。`--timeout` 覆盖它 */
export const DEFAULT_TIMEOUT_SECONDS = 120

export interface GDBoxCapability {
  cliContractVersion: number
  projectTargeting: boolean
  publicResults: boolean
}

export interface Session {
  client: Client
  /** 服务端声明的能力。旧盒子上是 undefined */
  capability?: GDBoxCapability
  close(): Promise<void>
}

/**
 * 连上去。
 *
 * 失败一律翻成带码的 `GdboxError`：调用方要靠退出码区分「服务没开」和
 * 「令牌不对」，这两件事的下一步完全不同。
 */
export async function connect(host: HostConnection): Promise<Session> {
  const client = new Client({ name: 'gdbox-cli', version: '0.1.0' }, { capabilities: {} })
  const transport = new StreamableHTTPClientTransport(new URL(host.url), {
    requestInit: { headers: { Authorization: `Bearer ${host.token}` } }
  })

  try {
    await withDeadline(
      client.connect(transport),
      CONNECT_TIMEOUT_MS,
      () => new GdboxError('SERVICE_UNAVAILABLE', `连接 GDBox 超时（${host.url}）。`, SERVICE_HINT)
    )
  } catch (error) {
    await transport.close().catch(() => undefined)
    throw describeConnectError(error, host)
  }

  const raw = client.getServerCapabilities()?.experimental?.unrealBox
  const capability = parseCapability(raw)

  return {
    client,
    ...(capability ? { capability } : {}),
    close: async () => {
      // 先主动结束服务端那条会话，再关传输。反过来的话 DELETE 发不出去。
      await transport.terminateSession().catch(() => undefined)
      await client.close().catch(() => undefined)
    }
  }
}

/**
 * 干活之前确认契约在。
 *
 * @throws {GdboxError} `INCOMPATIBLE_SERVER` —— 旧盒子，或者版本对不上
 */
export function requireContract(session: Session): GDBoxCapability {
  if (!session.capability) {
    throw new GdboxError(
      'INCOMPATIBLE_SERVER',
      '这个 GDBox 还不支持 CLI 契约（没有声明 unrealBox 能力）。',
      '升级 GDBox。当前版本能连上，但它会忽略 --project —— 命令会看起来成功，' +
        '实际可能发给了别的工程。'
    )
  }

  if (session.capability.cliContractVersion !== CLI_CONTRACT_VERSION) {
    throw new GdboxError(
      'INCOMPATIBLE_SERVER',
      `契约版本不匹配：盒子是 ${session.capability.cliContractVersion}，本 CLI 是 ${CLI_CONTRACT_VERSION}。`,
      '把 GDBox 和 gdbox 升到同一批版本。'
    )
  }

  return session.capability
}

function parseCapability(raw: unknown): GDBoxCapability | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const value = raw as Record<string, unknown>
  if (typeof value.cliContractVersion !== 'number') return undefined

  return {
    cliContractVersion: value.cliContractVersion,
    projectTargeting: value.projectTargeting === true,
    publicResults: value.publicResults === true
  }
}

/**
 * 把底层的连接错误翻成用户能照着做的一句话。
 *
 * 401 和「端口没人监听」都会以 `Error` 的形式冒出来，但它们是两件事：
 * 前者是令牌对不上（手里那把过期了，或者连错了盒子），后者要去把服务打开。
 */
function describeConnectError(error: unknown, host: HostConnection): GdboxError {
  if (error instanceof GdboxError) return error

  const message = error instanceof Error ? error.message : String(error)

  if (/\b401\b|unauthorized/i.test(message)) {
    return new GdboxError(
      'AUTH_FAILED',
      `GDBox 拒绝了这个访问令牌（${host.url}）。`,
      '用 GDBOX_TOKEN 的话，换成 GDBox 里现在的令牌；否则多半是连错了盒子 —— ' +
        'gdbox doctor 会显示这次读的是哪份配置。'
    )
  }

  if (/ECONNREFUSED|ECONNRESET|EHOSTUNREACH|fetch failed|socket hang up/i.test(message)) {
    return new GdboxError(
      'SERVICE_UNAVAILABLE',
      `连不上 GDBox（${host.url}）：${message}`,
      SERVICE_HINT
    )
  }

  return new GdboxError('SERVICE_UNAVAILABLE', `连接 GDBox 失败：${message}`)
}

/**
 * 给一个 promise 加期限。
 *
 * 超时**不取消**底层请求 —— 底层不一定支持取消，而假装取消了比超时更糟：
 * 调用方会以为引擎那边什么都没发生。执行状态由调用点保守报成 `unknown`。
 */
export async function withDeadline<T>(
  promise: Promise<T>,
  ms: number,
  onTimeout: () => GdboxError
): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(onTimeout()), ms)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
