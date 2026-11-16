import {
  createAssistantMessageEventStream,
  parseStreamingJson,
  type Api,
  type AssistantMessageEvent,
  type Model
} from '@earendil-works/pi-ai'
import type { StreamFn } from '@earendil-works/pi-agent-core'
import { describe, expect, it } from 'vitest'

import { toolArgsLimitStreamFn, toolArgsTooLargeMessage } from './toolArgsLimit'

/**
 * 2026-10-21 端到端测试：一次回复流回 10.7 万个工具参数片段，pi-ai 每个片段都把整段参数
 * 重新解析一遍，主进程卡死 13 分钟。这里钉住两件事：补丁后的解析是线性的；跑飞的参数被掐掉
 */

describe('parseStreamingJson（pi-ai 补丁）', () => {
  it('10 万个小片段逐个解析不再是平方复杂度，最终参数完整', () => {
    const body = 'x'.repeat(300_000)
    const full = JSON.stringify({ path: 'res://main.gd', content: body })
    const step = 3
    const started = Date.now()
    let last: unknown
    for (let end = step; end < full.length; end += step) {
      last = parseStreamingJson(full.slice(0, end))
    }
    // 补丁前同样的输入要几分钟；这里给足余量，只防退回平方
    expect(Date.now() - started).toBeLessThan(15_000)
    expect(last).toMatchObject({ path: 'res://main.gd' })
    // 完整的那一份（以 } 结尾）总是完整解析，不会拿到缓存里的旧值
    expect(parseStreamingJson(full)).toEqual({ path: 'res://main.gd', content: body })
  })

  it('小参数照旧每次都解析', () => {
    expect(parseStreamingJson('{"a":1,"b":"hel')).toEqual({ a: 1, b: 'hel' })
    expect(parseStreamingJson('{"a":1,"b":"hello"}')).toEqual({ a: 1, b: 'hello' })
  })
})

const model = { api: 'openai-responses', provider: 'test', id: 'm' } as unknown as Model<Api>

function fakeInner(events: AssistantMessageEvent[], seen: { signal?: AbortSignal }): StreamFn {
  return (async (_model, _context, options) => {
    seen.signal = options?.signal
    const out = createAssistantMessageEventStream()
    void (async () => {
      for (const event of events) {
        if (options?.signal?.aborted) break
        out.push(event)
        await Promise.resolve()
      }
      out.end()
    })()
    return out
  }) as StreamFn
}

const delta = (contentIndex: number, text: string): AssistantMessageEvent =>
  ({
    type: 'toolcall_delta',
    contentIndex,
    delta: text,
    partial: {}
  }) as unknown as AssistantMessageEvent
const done = { type: 'done', reason: 'toolUse', message: {} } as unknown as AssistantMessageEvent

async function collect(fn: StreamFn): Promise<AssistantMessageEvent[]> {
  const stream = await fn(model, { messages: [] } as never, {})
  const out: AssistantMessageEvent[] = []
  for await (const event of stream) out.push(event)
  return out
}

describe('toolArgsLimitStreamFn', () => {
  it('没超限原样转发', async () => {
    const seen: { signal?: AbortSignal } = {}
    const events = await collect(
      toolArgsLimitStreamFn(
        fakeInner([delta(0, 'a'.repeat(50)), delta(1, 'b'.repeat(50)), done], seen),
        60
      )
    )
    expect(events.map((e) => e.type)).toEqual(['toolcall_delta', 'toolcall_delta', 'done'])
    expect(seen.signal?.aborted).toBe(false)
  })

  it('同一个工具调用的参数超限：掐掉请求，回一条说清怎么做的失败', async () => {
    const seen: { signal?: AbortSignal } = {}
    const events = await collect(
      toolArgsLimitStreamFn(
        fakeInner(
          [delta(0, 'a'.repeat(40)), delta(0, 'a'.repeat(40)), delta(0, 'never'), done],
          seen
        ),
        60
      )
    )
    expect(events.map((e) => e.type)).toEqual(['toolcall_delta', 'error'])
    const last = events.at(-1) as Extract<AssistantMessageEvent, { type: 'error' }>
    expect(last.error.errorMessage).toBe(toolArgsTooLargeMessage(60))
    expect(seen.signal?.aborted).toBe(true)
  })

  it('外面停下会传进去', async () => {
    const seen: { signal?: AbortSignal } = {}
    const outer = new AbortController()
    const fn = toolArgsLimitStreamFn(fakeInner([done], seen))
    await fn(model, { messages: [] } as never, { signal: outer.signal })
    outer.abort()
    expect(seen.signal?.aborted).toBe(true)
  })
})
