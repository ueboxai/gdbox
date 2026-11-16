import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VNode } from 'vue'

const dialog = vi.hoisted(() => ({
  confirmDialog: vi.fn(),
  destroy: vi.fn()
}))
vi.mock('@renderer/utils/dialog', () => ({ confirmDialog: dialog.confirmDialog }))

import { askDiscardLaterTurns, countLaterTurns } from './discardLaterTurns'

const t = (key: string, params?: Record<string, unknown>): string =>
  params ? `${key}:${JSON.stringify(params)}` : key

interface CapturedOptions {
  title: string
  content: string
  footer: () => VNode
}

function lastOptions(): CapturedOptions {
  return dialog.confirmDialog.mock.calls.at(-1)![0] as CapturedOptions
}

/** footer 里的按钮，按 data-choice 找 */
function buttons(): Map<string, () => void> {
  const footer = lastOptions().footer()
  const map = new Map<string, () => void>()
  for (const child of (footer.children as VNode[]).filter(Boolean)) {
    const props = child.props as { 'data-choice': string; onClick: () => void }
    map.set(props['data-choice'], props.onClick)
  }
  return map
}

beforeEach(() => {
  dialog.confirmDialog.mockReset()
  dialog.destroy.mockReset()
  dialog.confirmDialog.mockReturnValue({ destroy: dialog.destroy })
})

describe('countLaterTurns', () => {
  const conversation = [
    { role: 'user' },
    { role: 'assistant' },
    { role: 'user' },
    { role: 'assistant' },
    { role: 'user' },
    { role: 'assistant' }
  ]

  it('最后一轮之后没有轮次', () => {
    expect(countLaterTurns(conversation, 5)).toBe(0)
    expect(countLaterTurns(conversation, 4)).toBe(0)
  })

  it('按此后的用户消息数算轮次', () => {
    expect(countLaterTurns(conversation, 1)).toBe(2)
    expect(countLaterTurns(conversation, 0)).toBe(2)
    expect(countLaterTurns(conversation, 3)).toBe(1)
  })
})

describe('askDiscardLaterTurns', () => {
  it('正文写明要删几轮', () => {
    void askDiscardLaterTurns({ title: '重新生成', count: 2, t })
    expect(lastOptions().title).toBe('重新生成')
    expect(lastOptions().content).toBe('assistant.chat.discardLaterTurns:{"count":2}')
  })

  it.each(['continue', 'cancel'] as const)('点「%s」按对应结果返回并关掉弹窗', async (choice) => {
    const result = askDiscardLaterTurns({ title: 'x', count: 1, t })
    buttons().get(choice)!()
    await expect(result).resolves.toBe(choice)
    expect(dialog.destroy).toHaveBeenCalled()
  })

  it('只有取消和继续两个按钮', () => {
    void askDiscardLaterTurns({ title: 'x', count: 1, t })
    expect([...buttons().keys()]).toEqual(['cancel', 'continue'])
  })

  it('确认按钮文字可由调用方指定', () => {
    void askDiscardLaterTurns({ title: 'x', count: 1, okText: '删除并重新生成', t })
    const footer = lastOptions().footer()
    const ok = (footer.children as VNode[]).find(
      (c) => (c.props as Record<string, unknown>)['data-choice'] === 'continue'
    )!
    expect((ok.children as { default: () => string }).default()).toBe('删除并重新生成')
  })

  it('点遮罩或 Esc 关掉弹窗算取消', async () => {
    const result = askDiscardLaterTurns({ title: 'x', count: 1, t })
    ;(lastOptions() as unknown as { afterClose: () => void }).afterClose()
    await expect(result).resolves.toBe('cancel')
  })
})
