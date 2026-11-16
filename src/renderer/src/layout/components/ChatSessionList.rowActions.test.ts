import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import ChatSessionList from './ChatSessionList.vue'
import { useChatSessionsStore } from '@renderer/store/modules/chatSessions'
import { usePendingApprovalsStore } from '@renderer/store/modules/pendingApprovals'

vi.mock('@floating-ui/dom', () => ({
  computePosition: vi.fn().mockResolvedValue({ x: 0, y: 0 }),
  autoUpdate: vi.fn(() => vi.fn()),
  offset: vi.fn(),
  flip: vi.fn(),
  shift: vi.fn()
}))

const mounted: VueWrapper[] = []

function mountList(): VueWrapper {
  const wrapper = mount(ChatSessionList, {
    props: { collapsed: false, activeChatSid: '' },
    global: {
      stubs: { SidebarSectionHeader: { template: '<div><slot /><slot name="actions" /></div>' } }
    }
  }) as VueWrapper
  mounted.push(wrapper)
  return wrapper
}

beforeEach(() => {
  setActivePinia(createPinia())
  ;(window as unknown as { api: unknown }).api = {
    on: vi.fn(),
    off: vi.fn(),
    agentV3: { externalTeams: vi.fn().mockResolvedValue({ success: true, teams: [] }) },
    websocket: { getProjects: vi.fn().mockResolvedValue([]), onProjectsChanged: vi.fn() }
  }
})

afterEach(() => {
  while (mounted.length) mounted.pop()?.unmount()
  document.body.innerHTML = ''
})

/**
 * 行尾的置顶 / 归档按钮，和整行的右键菜单。
 *
 * 这两样在迁移之后一起失灵过。它们的共同点是都被 `<AppDropdown>` 包着 ——
 * 一个组件把整行包进去，很容易在事件链路上出岔子，而这类问题
 * typecheck 和快照都发现不了，只有真的点一下才知道。
 */
describe('ChatSessionList 行内操作', () => {
  it('点置顶按钮真的会把会话置顶', async () => {
    const store = useChatSessionsStore()
    store.ensureSession('s1', '一个会话')

    const wrapper = mountList()
    await wrapper.vm.$nextTick()

    const row = wrapper.find('.chat-item')
    expect(row.exists()).toBe(true)

    const pin = row.findAll('.chat-icon-btn')[0]
    expect(pin, '行尾应该有置顶按钮').toBeTruthy()
    await pin.trigger('click')

    expect(store.sessionById('s1')?.pinned).toBe(true)
  })

  it('点归档按钮真的会归档', async () => {
    const store = useChatSessionsStore()
    store.ensureSession('s1', '一个会话')

    const wrapper = mountList()
    await wrapper.vm.$nextTick()

    const archive = wrapper.find('.chat-item').findAll('.chat-icon-btn')[1]
    await archive.trigger('click')

    expect(store.sessionById('s1')?.archived).toBe(true)
  })

  it('在行上右键会弹出菜单', async () => {
    const store = useChatSessionsStore()
    store.ensureSession('s1', '一个会话')

    const wrapper = mountList()
    await wrapper.vm.$nextTick()

    expect(document.querySelector('[role="menu"]')).toBeNull()

    await wrapper.find('.chat-item').trigger('contextmenu')
    await wrapper.vm.$nextTick()

    expect(document.querySelector('[role="menu"]')).not.toBeNull()
  })

  it('会话行自己接住右键，不依赖下拉壳转接事件', async () => {
    const store = useChatSessionsStore()
    store.ensureSession('s1', '一个会话')

    const wrapper = mount(ChatSessionList, {
      props: { collapsed: false, activeChatSid: '' },
      global: {
        stubs: {
          SidebarSectionHeader: { template: '<div><slot /><slot name="actions" /></div>' },
          AppDropdown: {
            props: ['open', 'anchorPoint', 'placement'],
            template:
              '<div class="passive-dropdown" :data-anchor-x="anchorPoint?.x" :data-anchor-y="anchorPoint?.y" :data-placement="placement"><slot /><div v-if="open" class="passive-dropdown-overlay"><slot name="overlay" /></div></div>'
          }
        }
      }
    }) as VueWrapper
    mounted.push(wrapper)
    await wrapper.vm.$nextTick()

    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    const prevented = vi.spyOn(event, 'preventDefault')
    wrapper.find('.chat-item').element.dispatchEvent(event)

    expect(prevented).toHaveBeenCalled()
    await vi.waitFor(() => expect(wrapper.find('.passive-dropdown-overlay').exists()).toBe(true))
  })

  it('会话右键菜单以鼠标位置为锚点，从鼠标右侧展开', async () => {
    const store = useChatSessionsStore()
    store.ensureSession('s1', '一个会话')

    const wrapper = mount(ChatSessionList, {
      props: { collapsed: false, activeChatSid: '' },
      global: {
        stubs: {
          SidebarSectionHeader: { template: '<div><slot /><slot name="actions" /></div>' },
          AppDropdown: {
            props: ['open', 'anchorPoint', 'placement'],
            template:
              '<div class="passive-dropdown" :data-anchor-x="anchorPoint?.x" :data-anchor-y="anchorPoint?.y" :data-placement="placement"><slot /><div v-if="open"><slot name="overlay" /></div></div>'
          }
        }
      }
    }) as VueWrapper
    mounted.push(wrapper)
    await wrapper.vm.$nextTick()

    await wrapper.find('.chat-item').trigger('contextmenu', { clientX: 188, clientY: 74 })
    await vi.waitFor(() =>
      expect(
        wrapper.find('.passive-dropdown[data-placement="rightStart"]').attributes()
      ).toMatchObject({
        'data-anchor-x': '188',
        'data-anchor-y': '74'
      })
    )
  })

  it('右键菜单里的归属项目使用自建子菜单，不依赖 antd Menu 上下文', async () => {
    vi.mocked(window.api.websocket.getProjects).mockResolvedValue([
      {
        connectionId: 'connection-a',
        projectName: '项目 A',
        projectPath: 'C:/Projects/A',
        isConnected: true
      }
    ])
    const store = useChatSessionsStore()
    store.ensureSession('s1', '一个会话')

    const wrapper = mountList()
    await vi.waitFor(() => expect(window.api.websocket.getProjects).toHaveBeenCalled())
    await wrapper.find('.chat-item').trigger('contextmenu')
    await wrapper.vm.$nextTick()

    const submenu = document.querySelector<HTMLElement>('.app-menu-submenu')
    expect(submenu).not.toBeNull()
    submenu?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }))
    await wrapper.vm.$nextTick()

    expect(document.querySelector('.app-menu-submenu__popup')?.textContent).toContain('项目 A')
  })
})

describe('ChatSessionList 归档提示与重命名', () => {
  it('归档后提示「已归档」，点撤销放回原处（含置顶）', async () => {
    const { message } = await import('@renderer/utils/messageManager')
    const success = vi.spyOn(message, 'success')
    const store = useChatSessionsStore()
    store.ensureSession('s1', '一个会话')
    store.togglePinned('s1')

    const wrapper = mountList()
    await wrapper.vm.$nextTick()
    await wrapper.find('.chat-item').findAll('.chat-icon-btn')[1].trigger('click')

    expect(store.sessionById('s1')?.archived).toBe(true)
    const config = success.mock.calls.at(-1)![0] as {
      content: string
      action: { label: string; onClick: () => void }
    }
    expect(config.content).toBe('已归档')
    expect(config.action.label).toBe('撤销')

    config.action.onClick()
    expect(store.sessionById('s1')?.archived).toBe(false)
    expect(store.sessionById('s1')?.pinned).toBe(true)
    success.mockRestore()
  })

  it('右键重命名：输入框获得焦点并全选原名', async () => {
    const store = useChatSessionsStore()
    store.ensureSession('s1', '一个会话')

    const { Input } = await import('ant-design-vue')
    const wrapper = mount(ChatSessionList, {
      attachTo: document.body,
      props: { collapsed: false, activeChatSid: '' },
      global: {
        components: { 'a-input': Input },
        stubs: { SidebarSectionHeader: { template: '<div><slot /><slot name="actions" /></div>' } }
      }
    }) as VueWrapper
    mounted.push(wrapper)
    await wrapper.vm.$nextTick()
    await wrapper.find('.chat-item').trigger('contextmenu')
    await wrapper.vm.$nextTick()

    const rename = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((el) =>
      el.textContent?.includes('重命名')
    )
    expect(rename).toBeTruthy()
    rename!.click()

    await vi.waitFor(() => {
      const input = document.activeElement as HTMLInputElement
      expect(input?.tagName).toBe('INPUT')
      expect(input.value).toBe('一个会话')
      expect(input.selectionStart).toBe(0)
      expect(input.selectionEnd).toBe('一个会话'.length)
    })
  })
})

/** 审批卡在等用户表态的对话，侧栏按「等你处理」显示，和等用户回答一样 */
describe('ChatSessionList 待审批状态', () => {
  it('队列里有这条对话的审批时显示为 waiting', async () => {
    const store = useChatSessionsStore()
    store.ensureSession('s1', '一个会话')
    store.setAgentSessionId('s1', 'engine-1')

    const wrapper = mountList()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.chat-item-waiting').exists()).toBe(false)

    usePendingApprovalsStore().enqueue({
      sessionId: 'engine-1',
      toolCallId: 'call-1',
      toolName: 'delete_asset',
      namespace: 'asset',
      risk: 'destructive',
      args: {},
      allowAlways: true
    })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.chat-item-waiting').exists()).toBe(true)
  })
})
