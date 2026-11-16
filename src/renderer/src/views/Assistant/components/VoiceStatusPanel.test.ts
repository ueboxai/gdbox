import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import VoiceStatusPanel from './VoiceStatusPanel.vue'
import type { RealtimeVoiceErrorCode, RealtimeVoiceState } from '../composables/useRealtimeVoice'

const push = vi.hoisted(() => vi.fn())
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))

function voiceState(error: string, code: RealtimeVoiceErrorCode | null): RealtimeVoiceState {
  const errorRef = ref<string | null>(error)
  const codeRef = ref<RealtimeVoiceErrorCode | null>(code)
  return {
    active: ref(false),
    connecting: ref(false),
    muted: ref(false),
    error: errorRef,
    errorCode: codeRef,
    clearError: () => {
      errorRef.value = null
      codeRef.value = null
    }
  } as unknown as RealtimeVoiceState
}

function mountPanel(voice: RealtimeVoiceState): ReturnType<typeof mount> {
  return mount(VoiceStatusPanel, {
    props: { voice, statusText: '聆听中', boundTitle: '' },
    global: { stubs: { AppButton: { template: '<button><slot /></button>' } } }
  })
}

describe('VoiceStatusPanel 报错', () => {
  it('没配实时语音：一句话 + 打开模型设置 + 关闭，不给重试，不铺主进程原文', async () => {
    const voice = voiceState(
      '还没有配置「实时语音」模型。请到 偏好设置 → 模型 → 默认模型……',
      'unconfigured'
    )
    const wrapper = mountPanel(voice)

    expect(wrapper.get('[role="status"]').text()).toBe('未配置实时语音模型')
    const labels = wrapper.findAll('button').map((b) => b.text())
    expect(labels).toEqual(['打开模型设置', '关闭'])

    await wrapper.findAll('button')[0].trigger('click')
    expect(push).toHaveBeenCalledWith({ path: '/preferences', query: { tab: 'models' } })
    expect(voice.error.value).toBeNull()
  })

  it('其他错误：显示原文，给重试和关闭；关闭后回到状态文字', async () => {
    const voice = voiceState('连接被拒绝', null)
    const wrapper = mountPanel(voice)

    expect(wrapper.get('[role="status"]').text()).toBe('连接被拒绝')
    expect(wrapper.findAll('button').map((b) => b.text())).toEqual(['重试连接', '关闭'])

    await wrapper.findAll('button')[1].trigger('click')
    expect(wrapper.get('[role="status"]').text()).toBe('聆听中')
    expect(wrapper.findAll('button')).toHaveLength(0)
  })
})
