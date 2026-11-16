import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount, type VueWrapper } from '@vue/test-utils'
import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import type { RealtimeVoiceState } from '../composables/useRealtimeVoice'
import type { SettingsView } from '@core/shared/aiProvider'

const mocks = vi.hoisted(() => ({ settings: vi.fn(), push: vi.fn(), info: vi.fn() }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: mocks.push }) }))
vi.mock('@/api/aiProvider', () => ({ aiProviderAPI: { getSettings: mocks.settings } }))
vi.mock('@/api/agentV3', () => ({
  agentV3API: { thinkingLevels: async () => null, listSkills: async () => ({ skills: [] }) }
}))
vi.mock('@/utils/messageManager', () => ({ message: { info: mocks.info } }))
vi.mock('../composables/voiceAssistant', () => ({ startVoiceIn: vi.fn() }))

import InputComposer from './InputComposer.vue'

const empty: SettingsView = {
  providers: [],
  roles: {},
  configured: false,
  encryptionAvailable: true,
  path: ''
}
const ready: SettingsView = {
  ...empty,
  configured: true,
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
  roles: { agent: { providerId: 'local', modelId: 'test' } }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.settings.mockResolvedValue(empty)
  setActivePinia(createPinia())
})

async function composer(): Promise<VueWrapper> {
  const wrapper = shallowMount(InputComposer, {
    attachTo: document.body,
    props: {
      voice: {
        active: ref(false),
        connecting: ref(false),
        phase: ref('idle'),
        outputLevel: ref(0)
      } as RealtimeVoiceState
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

describe('输入框首次发送与恢复', () => {
  it('权限与思考选项可聚焦，Escape 关闭面板并归还焦点', async () => {
    const wrapper = await composer()
    for (const selector of ['approval', 'thinking']) {
      const trigger = wrapper.get(`.${selector}-selector button.mode-trigger`)
      ;(trigger.element as HTMLButtonElement).focus()
      await trigger.trigger('click')
      const option = wrapper.get(`.${selector}-dropdown button`)
      ;(option.element as HTMLButtonElement).focus()
      expect(document.activeElement).toBe(option.element)
      await option.trigger('keydown', { key: 'Escape' })
      expect(wrapper.find(`.${selector}-dropdown`).exists()).toBe(false)
      expect(document.activeElement).toBe(trigger.element)
    }
    wrapper.unmount()
  })

  it('没有可用模型时保留草稿，不创建失败会话，提供直接设置入口', async () => {
    const wrapper = await composer()
    await wrapper.get('textarea').setValue('不要丢掉这份草稿')
    await wrapper.get('.send-btn').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('send')).toBeUndefined()
    expect(wrapper.get('textarea').element.value).toBe('不要丢掉这份草稿')
    await wrapper.get('.agent-model-settings').trigger('click')
    expect(mocks.push).toHaveBeenCalledWith({ path: '/preferences', query: { tab: 'models' } })
    wrapper.unmount()
  })

  it('模型设置有效时正常发送并清空草稿', async () => {
    mocks.settings.mockResolvedValue(ready)
    const wrapper = await composer()
    await wrapper.get('textarea').setValue('继续我的任务')
    await wrapper.get('.send-btn').trigger('click')
    expect(wrapper.emitted('send')?.[0]?.[0]).toMatchObject({ content: '继续我的任务' })
    expect(wrapper.get('textarea').element.value).toBe('')
    wrapper.unmount()
  })

  it('重新生成、编辑重发前的模型检查：没模型时拦下并打开模型选择，有模型时放行', async () => {
    vi.useFakeTimers()
    try {
      const wrapper = await composer()
      const vm = wrapper.vm as unknown as { requireAgentModel: () => boolean }
      expect(vm.requireAgentModel()).toBe(false)
      vi.runAllTimers()
      await flushPromises()
      expect(mocks.info).toHaveBeenCalled()
      expect(wrapper.find('.agent-model-settings').exists()).toBe(true)
      wrapper.unmount()

      mocks.settings.mockResolvedValue(ready)
      const readyWrapper = await composer()
      expect(
        (readyWrapper.vm as unknown as { requireAgentModel: () => boolean }).requireAgentModel()
      ).toBe(true)
      readyWrapper.unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('输入框空着按退格：去掉目标模式标签', async () => {
    const wrapper = await composer()
    await wrapper.get('textarea').setValue('/goal ')
    expect(wrapper.find('.goal-mode').exists()).toBe(true)
    await wrapper.get('textarea').trigger('keydown', { key: 'Backspace' })
    expect(wrapper.find('.goal-mode').exists()).toBe(false)
    wrapper.unmount()
  })

  it('输入框空着按退格：生图模式下请求退出生图', async () => {
    const wrapper = await composer()
    await wrapper.setProps({ isImageGenerationMode: true })
    await wrapper.get('textarea').trigger('keydown', { key: 'Backspace' })
    expect(wrapper.emitted('cancel-image-generation')).toHaveLength(1)
    wrapper.unmount()
  })

  it('「+」面板开着、焦点不在输入框时，Esc 也能关掉', async () => {
    const wrapper = await composer()
    await wrapper.get('.plus-btn').trigger('click')
    expect(wrapper.get('.plus-btn').attributes('aria-expanded')).toBe('true')
    ;(document.activeElement as HTMLElement | null)?.blur()
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(wrapper.get('.plus-btn').attributes('aria-expanded')).toBe('false')
    wrapper.unmount()
  })

  it('没有模型仍可使用本地压缩命令，不被模型设置挡住', async () => {
    const wrapper = await composer()
    await wrapper.get('textarea').setValue('/compact')
    await wrapper.get('.send-btn').trigger('click')
    expect(wrapper.emitted('run-command')?.[0]).toEqual(['compact'])
    expect(wrapper.emitted('send')).toBeUndefined()
    wrapper.unmount()
  })
})

describe('输入框复验修复', () => {
  type ComposerVm = {
    requireAgentModel: (options?: { keepsDraft?: boolean }) => boolean
    submitText: (text: string) => void
  }

  it('重新生成、编辑重发被拦时只提示选模型，不提草稿', async () => {
    vi.useFakeTimers()
    try {
      const wrapper = await composer()
      const vm = wrapper.vm as unknown as ComposerVm
      expect(vm.requireAgentModel({ keepsDraft: false })).toBe(false)
      vi.runAllTimers()
      expect(mocks.info).toHaveBeenLastCalledWith('请先选择可用模型')
      expect(vm.requireAgentModel()).toBe(false)
      vi.runAllTimers()
      expect(mocks.info).toHaveBeenLastCalledWith('请先选择可用模型，草稿和附件已保留')
      wrapper.unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('同一张建议卡片点两次，文字只插到草稿前面一次', async () => {
    const wrapper = await composer()
    const vm = wrapper.vm as unknown as ComposerVm
    await wrapper.get('textarea').setValue('我自己的草稿')
    vm.submitText('撤销这次替换')
    vm.submitText('撤销这次替换')
    await flushPromises()
    expect(wrapper.get('textarea').element.value).toBe('撤销这次替换\n\n我自己的草稿')
    wrapper.unmount()
  })

  it('输入为空按回车什么都不做，不弹模型选择', async () => {
    const wrapper = await composer()
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(wrapper.find('.agent-model-dropdown').exists()).toBe(false)
    expect(mocks.info).not.toHaveBeenCalled()
    expect(wrapper.emitted('send')).toBeUndefined()
    wrapper.unmount()
  })

  it('模型面板被拦截自动打开后，Esc 能关掉', async () => {
    vi.useFakeTimers()
    try {
      const wrapper = await composer()
      ;(wrapper.vm as unknown as ComposerVm).requireAgentModel({ keepsDraft: false })
      vi.runAllTimers()
      await flushPromises()
      expect(wrapper.find('.agent-model-dropdown').exists()).toBe(true)
      ;(document.activeElement as HTMLElement | null)?.blur()
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await flushPromises()
      expect(wrapper.find('.agent-model-dropdown').exists()).toBe(false)

      // 焦点在输入框里时同样先关面板
      ;(wrapper.vm as unknown as ComposerVm).requireAgentModel({ keepsDraft: false })
      vi.runAllTimers()
      await flushPromises()
      expect(wrapper.find('.agent-model-dropdown').exists()).toBe(true)
      await wrapper.get('textarea').trigger('keydown', { key: 'Escape' })
      expect(wrapper.find('.agent-model-dropdown').exists()).toBe(false)

      // 焦点在别处的输入框（正在编辑的历史消息）：Esc 只关面板，不传给那个输入框
      const editBox = document.createElement('textarea')
      const editEsc = vi.fn()
      editBox.addEventListener('keydown', editEsc)
      document.body.appendChild(editBox)
      ;(wrapper.vm as unknown as ComposerVm).requireAgentModel({ keepsDraft: false })
      vi.runAllTimers()
      await flushPromises()
      editBox.focus()
      editBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await flushPromises()
      expect(wrapper.find('.agent-model-dropdown').exists()).toBe(false)
      expect(editEsc).not.toHaveBeenCalled()
      editBox.remove()
      wrapper.unmount()
    } finally {
      vi.useRealTimers()
    }
  })
})
