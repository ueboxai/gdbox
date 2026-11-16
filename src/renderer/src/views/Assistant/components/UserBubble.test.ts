import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PhCopy, PhPencilSimple, PhTarget, PhUsersThree } from '@phosphor-icons/vue'
import type { ChatMessageContent } from '@renderer/store/modules/chatMessages'
import UserBubble from './UserBubble.vue'

vi.mock('@renderer/services/imageViewer', () => ({ openImageViewer: vi.fn() }))

const modes = [
  { command: 'team', label: '团队', icon: PhUsersThree },
  { command: 'goal', label: '目标', icon: PhTarget }
] as const

afterEach(() => {
  vi.useRealTimers()
})

describe('UserBubble command modes', () => {
  it.each(modes)('renders /$command as the composer icon and label', ({ command, label, icon }) => {
    const body = '做一扇门\n  保留缩进和 /team 正文'
    const wrapper = mount(UserBubble, {
      props: { id: 'sent-message', content: `/${command} ${body}` }
    })

    expect(wrapper.get('.command-mode').text()).toBe(label)
    expect(wrapper.findComponent(icon).exists()).toBe(true)
    expect(wrapper.get('.text-content').element.textContent).toBe(body)
    wrapper.unmount()
  })

  it.each(modes)('restores /$command badges with images and attachments', ({ command, label }) => {
    const content: ChatMessageContent = [
      { type: 'text', text: `/${command} 按参考图制作` },
      { type: 'image_url', image_url: { url: 'local-resource://reference.png' } },
      { type: 'text', text: '保留第二段文字' }
    ]
    const wrapper = mount(UserBubble, {
      props: {
        id: 'saved-message',
        content: JSON.parse(JSON.stringify(content)),
        mentionedSources: [{ id: 'source-1', title: '设计说明', type: 'file' }],
        excelFiles: [{ fileName: '需求.xlsx', rowCount: 3 }]
      }
    })

    expect(wrapper.get('.command-mode').text()).toBe(label)
    expect(wrapper.get('.text-content').text()).toBe('按参考图制作\n保留第二段文字')
    expect(wrapper.get('.user-image').attributes('src')).toBe('local-resource://reference.png')
    expect(wrapper.get('.source-title').text()).toBe('设计说明')
    expect(wrapper.get('.attachment-name').text()).toBe('需求.xlsx')
    expect(wrapper.props('content')).toEqual(content)
    wrapper.unmount()
  })

  it.each([
    '普通消息',
    '解释 /team 的用法',
    '/teams 做一扇门',
    '/goals 做一扇门',
    '/team',
    '/goal',
    '/team ',
    '/goal '
  ])('keeps non-mode text unchanged: %s', (content) => {
    const wrapper = mount(UserBubble, { props: { id: 'plain-message', content } })
    expect(wrapper.find('.command-mode').exists()).toBe(false)
    expect(wrapper.get('.text-content').element.textContent).toBe(content)
    wrapper.unmount()
  })

  it.each(modes)('preserves /$command when copying and editing', async ({ command }) => {
    vi.useFakeTimers()
    const content = `/${command} 做一扇门`
    const wrapper = mount(UserBubble, { props: { id: 'editable-message', content } })

    await wrapper.getComponent(PhCopy).trigger('click')
    expect(wrapper.emitted('copy')).toEqual([[{ id: 'editable-message', content }]])
    await wrapper.getComponent(PhPencilSimple).trigger('click')
    expect(wrapper.get('textarea').element.value).toBe(content)
    await wrapper.get('textarea').setValue(`/${command} 做两扇门`)
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter', ctrlKey: true })
    const emitted = wrapper.emitted('confirm-edit')
    expect(emitted).toHaveLength(1)
    const payload = emitted![0][0] as { reopen: () => void }
    expect(payload).toMatchObject({
      id: 'editable-message',
      newContent: `/${command} 做两扇门`,
      originalContent: content
    })
    // 确认框里取消：回到编辑态，改好的文字还在
    expect(wrapper.find('textarea').exists()).toBe(false)
    payload.reopen()
    await nextTick()
    expect(wrapper.get('textarea').element.value).toBe(`/${command} 做两扇门`)
    vi.runOnlyPendingTimers()
    wrapper.unmount()
  })

  it('updates the badge when message content changes', async () => {
    const wrapper = mount(UserBubble, {
      props: { id: 'updated-message', content: '/team 做一扇门' }
    })
    await wrapper.setProps({ content: '/goal 做两扇门' })
    expect(wrapper.get('.command-mode').text()).toBe('目标')
    expect(wrapper.findComponent(PhUsersThree).exists()).toBe(false)
    await wrapper.setProps({ content: '普通消息' })
    expect(wrapper.find('.command-mode').exists()).toBe(false)
    expect(wrapper.get('.text-content').text()).toBe('普通消息')
    wrapper.unmount()
  })
})

describe('UserBubble edit and toolbar', () => {
  it('keeps the edit draft when the parent reopens synchronously', async () => {
    const wrapper = mount(UserBubble, {
      props: { id: 'blocked-edit', content: '原来的话' },
      // 父组件在 emit 里同步重开（没选模型被拦下）
      attrs: { onConfirmEdit: (payload: { reopen: () => void }) => payload.reopen() },
      attachTo: document.body
    })
    const editButton = wrapper
      .findAll('button')
      .find((button) => button.findComponent(PhPencilSimple).exists())
    await editButton!.trigger('click')
    await wrapper.get('textarea').setValue('改过的话')
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter', ctrlKey: true })
    await nextTick()
    await nextTick()

    const textarea = wrapper.get('textarea').element as HTMLTextAreaElement
    expect(textarea.value).toBe('改过的话')
    expect(document.activeElement).toBe(textarea)
    expect(textarea.selectionStart).toBe('改过的话'.length)
    wrapper.unmount()
  })

  it('renders copy and edit as focusable buttons with accessible names', () => {
    const wrapper = mount(UserBubble, { props: { id: 'toolbar', content: '一句话' } })
    const buttons = wrapper.findAll('.tools button')
    expect(buttons).toHaveLength(2)
    for (const button of buttons) {
      expect(button.attributes('aria-label')).toBeTruthy()
    }
    wrapper.unmount()
  })
})
