import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

import BridgeUnavailableBanner from './BridgeUnavailableBanner.vue'

type Status = {
  state: string
  port: number
  startError?: string
  startErrorCode?: 'EADDRINUSE' | 'EACCES' | 'UNKNOWN'
}

function stubBridge(status: Status): { start: ReturnType<typeof vi.fn> } {
  const start = vi.fn().mockResolvedValue({ success: false })
  Object.defineProperty(window, 'api', {
    configurable: true,
    writable: true,
    value: {
      websocket: {
        getStatus: vi.fn().mockResolvedValue(status),
        onStatusChanged: vi.fn(() => () => undefined),
        start
      }
    }
  })
  return { start }
}

afterEach(() => {
  delete (window as { api?: unknown }).api
})

describe('BridgeUnavailableBanner', () => {
  it('端口被占时按界面语言显示端口，不显示主进程那句中文原文', async () => {
    stubBridge({
      state: 'error',
      port: 17860,
      startError: '主进程原文',
      startErrorCode: 'EADDRINUSE'
    })
    const wrapper = mount(BridgeUnavailableBanner)
    await flushPromises()

    expect(wrapper.text()).toContain('Godot 编辑器连接服务未能启动')
    expect(wrapper.text()).toContain('端口 17860 已被占用')
    expect(wrapper.text()).not.toContain('主进程原文')
  })

  it('认不出类别时退回显示原文', async () => {
    stubBridge({ state: 'error', port: 17860, startError: '一些没见过的错误' })
    const wrapper = mount(BridgeUnavailableBanner)
    await flushPromises()

    expect(wrapper.text()).toContain('一些没见过的错误')
  })

  it('点「重试」再启动一次桥接', async () => {
    const { start } = stubBridge({
      state: 'error',
      port: 17860,
      startError: 'x',
      startErrorCode: 'EADDRINUSE'
    })
    const wrapper = mount(BridgeUnavailableBanner)
    await flushPromises()

    const retry = wrapper.findAll('button').find((b) => b.text() === '重试')
    expect(retry).toBeTruthy()
    await retry!.trigger('click')
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('桥接正常时不显示', async () => {
    stubBridge({ state: 'listening', port: 17860 })
    const wrapper = mount(BridgeUnavailableBanner)
    await flushPromises()

    expect(wrapper.find('.bridge-banner').exists()).toBe(false)
  })
})
