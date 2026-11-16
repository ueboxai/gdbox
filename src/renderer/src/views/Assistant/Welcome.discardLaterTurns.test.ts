import { flushPromises, mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import Welcome from './Welcome.vue'
import { useChatMessagesStore, type ChatMessage } from '@renderer/store/modules/chatMessages'
import {
  installObserverStubs,
  installWindowApiStub
} from '../../../../../tests/utils/componentMount'

/**
 * 重新生成 / 编辑用户消息会把这一条之后的对话一起删掉。
 * 不是最后一轮时要先问；最后一轮直接做。
 */

const mocks = vi.hoisted(() => ({
  ask: vi.fn(),
  submitText: vi.fn(),
  restoreText: vi.fn(),
  requireAgentModel: vi.fn()
}))

vi.mock('./composables/discardLaterTurns', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./composables/discardLaterTurns')>()
  return { ...actual, askDiscardLaterTurns: mocks.ask }
})

vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {}, params: {}, path: '/', fullPath: '/', name: undefined, meta: {} }),
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    currentRoute: { value: { path: '/', query: {} } }
  })
}))

const InputComposerStub = defineComponent({
  name: 'InputComposer',
  setup(_props, { expose }) {
    expose({
      submitText: mocks.submitText,
      restoreText: mocks.restoreText,
      requireAgentModel: mocks.requireAgentModel
    })
    return () => h('div')
  }
})

const stubs = {
  ChatLog: {
    name: 'ChatLog',
    setup(_props: unknown, { expose }: { expose: (exposed: object) => void }) {
      expose({
        getScrollElement: () => null,
        scrollToBottom: () => {},
        stopAutoScroll: () => {},
        isNearBottom: () => true
      })
      return () => null
    }
  },
  TopNav: true,
  SessionProjectChip: true,
  AgentBrowserPane: true,
  BrandSphere: true,
  VoiceOrb: true,
  InputComposer: InputComposerStub,
  SuggestionCards: { name: 'SuggestionCards', props: ['items'], template: '<div />' },
  FileReviewPane: true,
  TeamBoardPanel: true,
  AppButton: true
}

const conversation: ChatMessage[] = [
  { id: 'u1', role: 'user', content: '第一问', status: 'done' },
  { id: 'a1', role: 'assistant', content: '第一答', status: 'done' },
  { id: 'u2', role: 'user', content: '第二问', status: 'done' },
  { id: 'a2', role: 'assistant', content: '第二答', status: 'done' }
]

function mountChat(): ReturnType<typeof mount> {
  useChatMessagesStore().replaceSessionMessages('chat-1', conversation)
  return mount(Welcome, {
    props: { chatSid: 'chat-1', forceChatView: true },
    global: { stubs }
  })
}

function ids(): string[] {
  return useChatMessagesStore()
    .getMessages('chat-1')
    .map((m) => m.id)
}

beforeEach(() => {
  installWindowApiStub()
  installObserverStubs()
  mocks.ask.mockReset()
  mocks.submitText.mockReset()
  mocks.restoreText.mockReset()
  mocks.requireAgentModel.mockReset()
  mocks.requireAgentModel.mockReturnValue(true)
})

describe('Welcome 重新生成 / 编辑前确认', () => {
  it('重新生成不是最后一轮的回复：先问，取消就什么都不删', async () => {
    mocks.ask.mockResolvedValue('cancel')
    const chatLog = mountChat().findComponent({ name: 'ChatLog' })
    await (chatLog.vm.$attrs.onRetry as (p: unknown) => Promise<void>)({
      id: 'a1',
      content: '第一答'
    })
    await flushPromises()

    expect(mocks.ask).toHaveBeenCalledWith(expect.objectContaining({ count: 1 }))
    expect(ids()).toEqual(['u1', 'a1', 'u2', 'a2'])
  })

  it('重新生成最后一轮的回复：不问', async () => {
    const chatLog = mountChat().findComponent({ name: 'ChatLog' })
    await (chatLog.vm.$attrs.onRetry as (p: unknown) => Promise<void>)({
      id: 'a2',
      content: '第二答'
    })
    await flushPromises()

    expect(mocks.ask).not.toHaveBeenCalled()
  })

  it('编辑不是最后一轮的提问：先问，取消就什么都不删', async () => {
    mocks.ask.mockResolvedValue('cancel')
    const chatLog = mountChat().findComponent({ name: 'ChatLog' })
    await (chatLog.vm.$attrs.onUserConfirmEdit as (p: unknown) => Promise<void>)({
      id: 'u1',
      newContent: '改过的第一问',
      originalContent: '第一问'
    })
    await flushPromises()

    expect(mocks.ask).toHaveBeenCalledWith(expect.objectContaining({ count: 1 }))
    expect(ids()).toEqual(['u1', 'a1', 'u2', 'a2'])
  })
})

describe('Welcome 没配模型时重新生成 / 编辑', () => {
  it('重新生成：输入框拦下后不问、不删', async () => {
    mocks.requireAgentModel.mockReturnValue(false)
    const chatLog = mountChat().findComponent({ name: 'ChatLog' })
    await (chatLog.vm.$attrs.onRetry as (p: unknown) => Promise<void>)({
      id: 'a1',
      content: '第一答'
    })
    await flushPromises()

    // 重新生成不碰输入框：提示里不提草稿
    expect(mocks.requireAgentModel).toHaveBeenCalledWith({ keepsDraft: false })
    expect(mocks.ask).not.toHaveBeenCalled()
    expect(ids()).toEqual(['u1', 'a1', 'u2', 'a2'])
  })

  it('编辑：输入框拦下后不问、不删，恢复编辑态', async () => {
    mocks.requireAgentModel.mockReturnValue(false)
    const reopen = vi.fn()
    const chatLog = mountChat().findComponent({ name: 'ChatLog' })
    await (chatLog.vm.$attrs.onUserConfirmEdit as (p: unknown) => Promise<void>)({
      id: 'u2',
      newContent: '改过的第二问',
      originalContent: '第二问',
      reopen
    })
    await flushPromises()

    expect(mocks.ask).not.toHaveBeenCalled()
    expect(reopen).toHaveBeenCalled()
    expect(ids()).toEqual(['u1', 'a1', 'u2', 'a2'])
  })

  it('确认按钮写明删除后做什么', async () => {
    mocks.ask.mockResolvedValue('cancel')
    const chatLog = mountChat().findComponent({ name: 'ChatLog' })
    await (chatLog.vm.$attrs.onRetry as (p: unknown) => Promise<void>)({
      id: 'a1',
      content: '第一答'
    })
    await (chatLog.vm.$attrs.onUserConfirmEdit as (p: unknown) => Promise<void>)({
      id: 'u1',
      newContent: '改',
      originalContent: '第一问'
    })
    await flushPromises()

    expect(mocks.ask.mock.calls[0][0].okText).toBe('删除并重新生成')
    expect(mocks.ask.mock.calls[1][0].okText).toBe('删除并重新发送')
  })
})

describe('Welcome 回复下的跟进建议', () => {
  it('走输入框的发送路径', async () => {
    const chatLog = mountChat().findComponent({ name: 'ChatLog' })
    ;(chatLog.vm.$attrs.onSuggest as (p: unknown) => void)({ id: 'a2', text: ' 再来一个 ' })
    await flushPromises()

    expect(mocks.submitText).toHaveBeenCalledWith('再来一个')
  })
})

describe('Welcome 建议卡片', () => {
  it('点卡片走输入框的发送路径（没选模型时由输入框拦下）', async () => {
    const wrapper = mount(Welcome, { props: { chatSid: 'chat-empty' }, global: { stubs } })
    const cards = wrapper.findComponent({ name: 'SuggestionCards' })
    const first = (cards.props('items') as Array<{ prompt?: string; title: string }>)[0]
    cards.vm.$emit('select', first)
    await flushPromises()

    expect(mocks.submitText).toHaveBeenCalledWith(String(first.prompt || first.title).trim())
  })
})

/*
 * 下面两条要先让 agent 跑起来、再排进消息，挂载骨架里做不到，钉住源码顺序。
 */
const source = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/views/Assistant/Welcome.vue'),
  'utf8'
)

describe('Welcome 停止与清空', () => {
  it('停止时排着的消息退回输入框，而不是直接丢掉', () => {
    const body = source.slice(source.indexOf('function stopAgentAndDropQueue'))
    const end = body.indexOf('\n}\n')
    const fn = body.slice(0, end)
    expect(fn).toContain('listFollowUps(')
    expect(fn).toContain('restoreText(')
    expect(fn.indexOf('clearFollowUps(')).toBeLessThan(fn.indexOf('return stopAgent()'))
  })

  it('清空对话先停掉在跑的任务，再清消息', () => {
    const body = source.slice(source.indexOf('function handleClearSession'))
    const stopAt = body.indexOf('await stopAgentAndDropQueue()')
    const clearAt = body.indexOf('clearSessionMessages(')
    expect(stopAt).toBeGreaterThan(-1)
    expect(stopAt).toBeLessThan(clearAt)
  })
})
