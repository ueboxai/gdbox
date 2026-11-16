import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { describe, expect, it } from 'vitest'

import { condenseMemberHistory, MEMBER_CONTEXT_CAP, memberContextWindow } from './memberMemory'

const user = (text: string): AgentMessage =>
  ({ role: 'user', content: text, timestamp: 0 }) as unknown as AgentMessage
const call = (name: string): AgentMessage =>
  ({
    role: 'assistant',
    content: [
      { type: 'text', text: '让我读一下' },
      { type: 'toolCall', id: name, name: 'read_local_file', arguments: {} }
    ],
    stopReason: 'toolUse',
    usage: { totalTokens: 700_000 },
    timestamp: 0
  }) as unknown as AgentMessage
const result = (id: string): AgentMessage =>
  ({
    role: 'toolResult',
    toolCallId: id,
    content: [{ type: 'text', text: 'x'.repeat(5000) }],
    timestamp: 0
  }) as unknown as AgentMessage
const reply = (text: string): AgentMessage =>
  ({
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: '…' },
      { type: 'text', text }
    ],
    stopReason: 'stop',
    usage: { totalTokens: 700_000 },
    timestamp: 0
  }) as unknown as AgentMessage

const job = (brief: string, report: string): AgentMessage[] => [
  user(brief),
  call(`${brief}-1`),
  result(`${brief}-1`),
  reply(report)
]

describe('condenseMemberHistory', () => {
  it('收尾的活只留派活原话和结论，去掉工具过程和厂商用量', () => {
    const out = condenseMemberHistory([...job('第一件', '做完了A'), ...job('第二件', '做完了B')])
    expect(out).toHaveLength(4)
    expect((out[0] as { content: string }).content).toBe('第一件')
    expect(out[1]).toMatchObject({
      role: 'assistant',
      content: [{ type: 'text', text: '做完了A' }]
    })
    expect(out[1]).toMatchObject({ usage: { totalTokens: 0 } })
    expect(out[3]).toMatchObject({ content: [{ type: 'text', text: '做完了B' }] })
  })

  it('最后一件没干完：那一段原样留着，好接着干', () => {
    const unfinished = [user('第二件'), call('c'), result('c')]
    const out = condenseMemberHistory([...job('第一件', '做完了A'), ...unfinished])
    expect(out).toHaveLength(5)
    expect(out.slice(2).map((m) => (m as { role: string }).role)).toEqual([
      'user',
      'assistant',
      'toolResult'
    ])
    // 用量清零（不能删字段：pi-ai 每次请求直接读 usage.totalTokens），不然压缩会以为这份短记录有 70 万
    expect(out[3]).toMatchObject({ usage: { totalTokens: 0, cost: { total: 0 } } })
  })

  it('超出预算从最旧的丢，并在开头注明省略了几件', () => {
    const history = [1, 2, 3, 4].flatMap((n) => job(`第${n}件`, 'r'.repeat(400)))
    const out = condenseMemberHistory(history, 900)
    expect(out).toHaveLength(4)
    const first = out[0] as { content: unknown }
    expect(first.content).toEqual(expect.stringContaining('更早的 2 件活'))
    expect(first.content).toEqual(expect.stringContaining('第3件'))
  })

  it('停下时没说话的旧活写明没交回结论', () => {
    const out = condenseMemberHistory([
      user('第一件'),
      call('c'),
      result('c'),
      ...job('第二件', 'ok')
    ])
    expect(out[1]).toMatchObject({ content: [{ type: 'text', text: '让我读一下' }] })
    const silent = condenseMemberHistory([
      user('第一件'),
      {
        role: 'assistant',
        content: [],
        stopReason: 'aborted',
        timestamp: 0
      } as unknown as AgentMessage,
      ...job('第二件', 'ok')
    ])
    expect(silent[1]).toMatchObject({
      content: [{ type: 'text', text: '（这件活没交回结论就停下了）' }]
    })
  })

  it('空记忆还是空', () => {
    expect(condenseMemberHistory([])).toEqual([])
  })
})

describe('memberContextWindow', () => {
  it('大窗口封顶，小窗口照旧', () => {
    expect(memberContextWindow(1_000_000)).toBe(MEMBER_CONTEXT_CAP)
    expect(memberContextWindow(64_000)).toBe(64_000)
  })
})
