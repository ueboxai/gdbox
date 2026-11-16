import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount, type VueWrapper } from '@vue/test-utils'
import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import type { RealtimeVoiceState } from '../composables/useRealtimeVoice'
import type { SettingsView } from '@core/shared/aiProvider'
import { useAIConfigStore } from '@renderer/store/modules/aiConfig'

const mocks = vi.hoisted(() => ({ settings: vi.fn(), push: vi.fn(), info: vi.fn() }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: mocks.push }) }))
vi.mock('@/api/aiProvider', () => ({ aiProviderAPI: { getSettings: mocks.settings } }))
vi.mock('@/api/agentV3', () => ({
  agentV3API: { thinkingLevels: async () => null, listSkills: async () => ({ skills: [] }) }
}))
vi.mock('@/utils/messageManager', () => ({ message: { info: mocks.info } }))
vi.mock('../composables/voiceAssistant', () => ({ startVoiceIn: vi.fn() }))

import InputComposer from './InputComposer.vue'

const ready: SettingsView = {
  providers: [
    {
      id: 'local',
      displayName: 'Local',
      kind: 'chat',
      protocol: 'openai-completions',
      baseUrl: 'http://localhost/v1',
      apiKey: { kind: 'none' },
      models: [{ id: 'test' }]
    }
  ],
  roles: { agent: { providerId: 'local', modelId: 'test' } },
  configured: true,
  encryptionAvailable: true,
  path: ''
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.settings.mockResolvedValue(ready)
  setActivePinia(createPinia())
})

async function composer(props: Record<string, unknown> = {}): Promise<VueWrapper> {
  const wrapper = shallowMount(InputComposer, {
    attachTo: document.body,
    props: {
      isAgentMode: true,
      voice: {
        active: ref(false),
        connecting: ref(false),
        phase: ref('idle'),
        outputLevel: ref(0)
      } as RealtimeVoiceState,
      ...props
    },
    global: {
      stubs: {
        'a-textarea': {
          props: ['value'],
          emits: ['update:value'],
          template:
            '<textarea :value="value" @input="$emit(\'update:value\', $event.target.value)" />'
        },
        AppButton: { template: '<button><slot /></button>' },
        AppTooltip: { template: '<span><slot /></span>' }
      }
    }
  })
  await flushPromises()
  return wrapper
}

describe('运行中的停止键', () => {
  it('输入框为空时只有停止键', async () => {
    const wrapper = await composer({ isGenerating: true })
    expect(wrapper.find('.stop-btn').exists()).toBe(true)
    expect(wrapper.find('.send-btn').exists()).toBe(false)
    wrapper.unmount()
  })

  it('输入框有字时停止键仍在，排在发送键左边', async () => {
    const wrapper = await composer({ isGenerating: true })
    await wrapper.get('textarea').setValue('接着做这个')
    const buttons = wrapper.findAll('.stop-btn, .send-btn').map((b) => b.classes())
    expect(buttons).toHaveLength(2)
    expect(buttons[0]).toContain('stop-btn')
    expect(buttons[1]).toContain('send-btn')
    wrapper.unmount()
  })

  it('空闲时没有停止键', async () => {
    const wrapper = await composer()
    expect(wrapper.find('.stop-btn').exists()).toBe(false)
    expect(wrapper.find('.send-btn').exists()).toBe(true)
    wrapper.unmount()
  })

  it('运行中在输入框按 Esc 停止', async () => {
    const wrapper = await composer({ isGenerating: true })
    await wrapper.get('textarea').trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('stop')).toHaveLength(1)
    wrapper.unmount()
  })

  it('空闲时按 Esc 不发停止', async () => {
    const wrapper = await composer()
    await wrapper.get('textarea').trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('stop')).toBeUndefined()
    wrapper.unmount()
  })
})

describe('中文输入法选字', () => {
  it.each([
    ['isComposing', { key: 'Enter', isComposing: true }],
    ['keyCode 229', { key: 'Enter', keyCode: 229 }]
  ])('%s 时回车不发送', async (_label, init) => {
    const wrapper = await composer()
    await wrapper.get('textarea').setValue('nihao')
    wrapper.get('textarea').element.dispatchEvent(new KeyboardEvent('keydown', init))
    await flushPromises()
    expect(wrapper.emitted('send')).toBeUndefined()
    wrapper.unmount()
  })

  it('选完字的回车照常发送', async () => {
    const wrapper = await composer()
    await wrapper.get('textarea').setValue('你好')
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('send')?.[0]?.[0]).toMatchObject({ content: '你好' })
    wrapper.unmount()
  })
})

describe('运行中的占位符', () => {
  it('排队档：本轮结束后发送', async () => {
    useAIConfigStore().setFollowUpBehavior('queue')
    const wrapper = await composer({ isGenerating: true })
    expect(wrapper.get('textarea').attributes('placeholder')).toBe('本轮结束后发送')
    wrapper.unmount()
  })

  it('插话档：发送后插入当前任务', async () => {
    useAIConfigStore().setFollowUpBehavior('steer')
    const wrapper = await composer({ isGenerating: true })
    expect(wrapper.get('textarea').attributes('placeholder')).toBe('发送后插入当前任务')
    wrapper.unmount()
  })
})

describe('页面调用的输入方法', () => {
  it('restoreText 把字接在已有草稿前面', async () => {
    const wrapper = await composer()
    await wrapper.get('textarea').setValue('正在写的')
    ;(wrapper.vm as unknown as { restoreText: (text: string) => void }).restoreText('排着的')
    await flushPromises()
    expect(wrapper.get('textarea').element.value).toBe('排着的\n\n正在写的')
    wrapper.unmount()
  })

  it('submitText 走同一条发送路径', async () => {
    vi.useFakeTimers()
    const wrapper = await composer()
    ;(wrapper.vm as unknown as { submitText: (text: string) => void }).submitText('建议卡片')
    vi.runAllTimers()
    vi.useRealTimers()
    expect(wrapper.emitted('send')?.[0]?.[0]).toMatchObject({ content: '建议卡片' })
    wrapper.unmount()
  })

  it('submitText 在没选模型时保留草稿、不发送', async () => {
    mocks.settings.mockResolvedValue({ ...ready, configured: false, providers: [], roles: {} })
    vi.useFakeTimers()
    const wrapper = await composer()
    ;(wrapper.vm as unknown as { submitText: (text: string) => void }).submitText('建议卡片')
    vi.runAllTimers()
    vi.useRealTimers()
    await flushPromises()
    expect(wrapper.emitted('send')).toBeUndefined()
    expect(wrapper.get('textarea').element.value).toBe('建议卡片')
    wrapper.unmount()
  })

  it('submitText 遇到已有草稿时不发送、不覆盖，接到草稿前面', async () => {
    vi.useFakeTimers()
    const wrapper = await composer()
    await wrapper.get('textarea').setValue('正在写的')
    ;(wrapper.vm as unknown as { submitText: (text: string) => void }).submitText('建议卡片')
    vi.runAllTimers()
    vi.useRealTimers()
    await flushPromises()
    expect(wrapper.emitted('send')).toBeUndefined()
    expect(wrapper.get('textarea').element.value).toBe('建议卡片\n\n正在写的')
    wrapper.unmount()
  })
})
