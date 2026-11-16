/**
 * 队员的记忆怎么带进下一件活，以及它干活时上下文最多涨到多大。
 *
 * ## 为什么要管
 *
 * 2026-10-20《缝天旅人》一局花了 12.95 亿 token，其中 11.9 亿是缓存重读：队员每走一步
 * 都要把整段记忆重发一遍，平均每步 15–25 万、最高 92 万。记忆是之前所有活的完整过程
 * —— 读过的文件、跑过的试玩、截图回执 —— 新活几乎用不上，却每一步都在付钱。
 *
 * ## 两件事
 *
 * - **每件新活从交接记录起步**（`condenseMemberHistory`）：以前的活只留「派活原话 +
 *   它交回的结论」，中间的工具调用和结果全丢。上一件没干完（被停下、出错）的那段原样留着，
 *   制作人说「接着上次的干」时它还知道干到哪了。交接记录本身也有上限，超了从最旧的丢。
 * - **干活时的压缩线封顶**（`memberContextWindow`）：压缩线原来按模型窗口的比例算，
 *   1M 窗口要涨到 60 万才开始写摘要。队员的一件活用不着那么长的工作记忆。
 */

import type { AgentMessage } from '@earendil-works/pi-agent-core'

/**
 * 队员压缩按多大的窗口算。按 `compaction.ts` 的比例，60% 起写摘要、85% 换上。
 * 模型窗口比这个小就按模型的来
 */
export const MEMBER_CONTEXT_CAP = 160_000

export function memberContextWindow(modelWindow: number): number {
  return Math.min(modelWindow, MEMBER_CONTEXT_CAP)
}

/** 交接记录最多带多少字（派活原话 + 结论）。中文大致 1–1.5 字一个 token */
export const MEMBER_MEMORY_CHARS = 60_000

type Msg = { role?: string; content?: unknown; stopReason?: string; usage?: unknown }

function textOf(message: AgentMessage): string {
  const content = (message as Msg).content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((b): b is { type: 'text'; text: string } => {
      const block = b as { type?: string; text?: unknown }
      return block.type === 'text' && typeof block.text === 'string'
    })
    .map((b) => b.text)
    .join('')
}

/** 一件活收了尾：最后一条是正常结束的 assistant，并且说了话 */
function finished(messages: AgentMessage[]): boolean {
  const last = messages.at(-1) as Msg | undefined
  return last?.role === 'assistant' && last.stopReason === 'stop' && textOf(messages.at(-1)!) !== ''
}

/**
 * 厂商用量换成全零。不能留原值：它描述的是当时那份长上下文，留着的话压缩会以为这份
 * 短记录也有几十万，一开工就去压（见 `estimateOutgoingTokens`）。也不能删掉字段：
 * pi-ai 每次请求都会直接读 `usage.totalTokens`，缺了当场崩 —— 2026-10-21 端到端测试
 * 里三件活一派出去就是 `Cannot read properties of undefined (reading 'totalTokens')`。
 * 同 `transcriptStore.ts` 的 `NO_PROVIDER_USAGE`；全零时 pi 会跳过它按文字估算
 */
const NO_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
}

function withoutUsage(message: AgentMessage): AgentMessage {
  return {
    ...(message as Msg),
    usage: { ...NO_USAGE, cost: { ...NO_USAGE.cost } }
  } as unknown as AgentMessage
}

/** 只留文字、用量清零 */
function bare(message: AgentMessage, text: string): AgentMessage {
  return {
    ...(withoutUsage(message) as Msg),
    content: [{ type: 'text', text }]
  } as unknown as AgentMessage
}

function prepend(message: AgentMessage, note: string): AgentMessage {
  const content = (message as Msg).content
  return {
    ...(message as Msg),
    content:
      typeof content === 'string'
        ? `${note}\n\n${content}`
        : [{ type: 'text', text: note }, ...(Array.isArray(content) ? content : [])]
  } as unknown as AgentMessage
}

/**
 * 把队员的记忆压成交接记录。
 *
 * 按非 assistant、非 toolResult 的消息（派活原话、队友留言、旧摘要）切段：
 * 每段留开头那条，再留这一段最后一条 assistant 的文字当结论。
 * 最后一段没收尾就原样留下。
 */
export function condenseMemberHistory(
  messages: AgentMessage[],
  budgetChars: number = MEMBER_MEMORY_CHARS
): AgentMessage[] {
  const segments: AgentMessage[][] = []
  for (const message of messages) {
    const role = (message as Msg).role
    if ((role !== 'assistant' && role !== 'toolResult') || segments.length === 0) {
      segments.push([message])
    } else {
      segments[segments.length - 1]!.push(message)
    }
  }
  if (segments.length === 0) return []

  const tail = finished(messages)
    ? []
    : segments.pop()!.map((m) => ((m as Msg).role === 'assistant' ? withoutUsage(m) : m))

  const condensed = segments.map((segment) => {
    const [head, ...rest] = segment
    const reply = rest.findLast((m) => (m as Msg).role === 'assistant')
    if (!reply) return [head!]
    const text = textOf(reply).trim() || '（这件活没交回结论就停下了）'
    return [head!, bare(reply, text)]
  })

  // 从最新往前装，装不下的旧活整段丢；最新一段再长也留
  const kept: AgentMessage[][] = []
  let used = 0
  for (let i = condensed.length - 1; i >= 0; i--) {
    const size = condensed[i]!.reduce((sum, m) => sum + textOf(m).length, 0)
    if (kept.length > 0 && used + size > budgetChars) break
    kept.unshift(condensed[i]!)
    used += size
  }
  const dropped = condensed.length - kept.length
  const out = kept.flat()
  if (dropped > 0) {
    const note = `[GDBox] 更早的 ${dropped} 件活的往来已省略；需要的话看任务板、工作区和工程里的文件。`
    if (out.length > 0) out[0] = prepend(out[0]!, note)
  }
  return [...out, ...tail]
}
