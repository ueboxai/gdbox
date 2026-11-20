import { describe, expect, it, vi } from 'vitest'
import type { AssistantMessage, Context, Model, Models } from '@earendil-works/pi-ai'
import { generateSummary } from './compaction'

const model = { contextWindow: 8192, maxTokens: 8192 } as Model<string>
const history = [
  { role: 'user' as const, content: '第一段'.repeat(4000) + '最后的待办', timestamp: 1 }
]
const overflow = {
  stopReason: 'error',
  errorMessage: 'prompt is too long: 1092720 tokens > 1048576 maximum'
}
function success(text: string): Pick<AssistantMessage, 'stopReason' | 'content'> & {
  usage: { input: number; cacheRead: number }
} {
  return {
    stopReason: 'stop',
    content: [{ type: 'text', text }],
    usage: { input: 500, cacheRead: 0 }
  }
}

describe('oversized summary requests', () => {
  it('covers every character in order and carries each successful summary into the next request', async () => {
    const chunks: string[] = []
    const completeSimple = vi.fn((_model, context: Context) => {
      const message = context.messages[0]
      if (message.role !== 'user' || typeof message.content === 'string')
        throw new Error('unexpected prompt')
      const block = message.content[0]
      if (block.type !== 'text') throw new Error('expected text')
      const chunk = block.text.split('<conversation>\n')[1].split('\n</conversation>')[0]
      if (chunk.length > 4000) return overflow
      expect(block.text).toContain(
        `<previous-summary>\nsummary ${chunks.length}\n</previous-summary>`
      )
      chunks.push(chunk)
      return success(`summary ${chunks.length}`)
    })
    const result = await generateSummary(
      history,
      { completeSimple } as unknown as Models,
      model,
      16000,
      undefined,
      undefined,
      'summary 0'
    )
    expect(chunks.join('')).toBe('[User]: ' + history[0].content)
    expect(result).toEqual({ ok: true, value: `summary ${chunks.length}` })
    expect(chunks.length).toBeGreaterThan(1)
  })

  it.each(['length', 'toolUse', 'pending', 'deferred', 'aborted'])(
    'rejects incomplete output even with text (%s)',
    async (stopReason) => {
      const completeSimple = vi.fn().mockResolvedValue({ ...success('partial'), stopReason })
      const result = await generateSummary(
        history,
        { completeSimple } as unknown as Models,
        model,
        16000
      )
      expect(result.ok).toBe(false)
      expect(completeSimple).toHaveBeenCalledTimes(1)
    }
  )

  it('does not request a summary for a prefix containing only an image', async () => {
    const completeSimple = vi.fn()
    const result = await generateSummary(
      [
        {
          role: 'user',
          content: [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }],
          timestamp: 1
        }
      ],
      { completeSimple } as unknown as Models,
      model,
      16000
    )
    expect(result.ok).toBe(false)
    expect(completeSimple).not.toHaveBeenCalled()
  })

  it('stops splitting when the provider rejects even a short chunk', async () => {
    const completeSimple = vi.fn().mockResolvedValue(overflow)
    const result = await generateSummary(
      history,
      { completeSimple } as unknown as Models,
      model,
      16000
    )
    expect(result.ok).toBe(false)
    expect(completeSimple).toHaveBeenCalledTimes(5)
  })

  it('drops an in-flight partial result on cancellation', async () => {
    const controller = new AbortController()
    const completeSimple = vi
      .fn()
      .mockResolvedValueOnce(overflow)
      .mockImplementationOnce(() => {
        controller.abort()
        return success('partial')
      })
    const result = await generateSummary(
      history,
      { completeSimple } as unknown as Models,
      model,
      16000,
      controller.signal
    )
    expect(result).toMatchObject({ ok: false, error: { code: 'aborted' } })
    expect(completeSimple).toHaveBeenCalledTimes(2)
  })

  it('does not return a partial summary if a later chunk fails', async () => {
    const completeSimple = vi
      .fn()
      .mockResolvedValueOnce(overflow)
      .mockResolvedValueOnce(success('partial'))
      .mockResolvedValue({ stopReason: 'error', errorMessage: 'unauthorized', content: [] })
    const result = await generateSummary(
      history,
      { completeSimple } as unknown as Models,
      model,
      16000
    )
    expect(result.ok).toBe(false)
    expect(completeSimple).toHaveBeenCalledTimes(3)
  })
})
