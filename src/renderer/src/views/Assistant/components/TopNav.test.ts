import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import zhCN from '@renderer/i18n/locales/zh-CN'
import TopNav from './TopNav.vue'

const passthrough = { template: '<div><slot /><slot name="overlay" /></div>' }
const menuItem = {
  props: { disabled: Boolean },
  emits: ['click'],
  template:
    '<button class="menu-item" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>'
}

function mountTopNav(props: Record<string, unknown> = {}): ReturnType<typeof mount> {
  return mount(TopNav, {
    props,
    global: {
      stubs: {
        SessionProjectChip: true,
        AppDropdown: passthrough,
        AppMenu: passthrough,
        AppMenuItem: menuItem,
        AppMenuDivider: true
      }
    }
  })
}

describe('TopNav exports', () => {
  it('「更多」是带名字的按钮', () => {
    const more = mountTopNav().get('.more-btn')
    expect(more.element.tagName).toBe('BUTTON')
    expect(more.attributes('aria-label')).toBe('更多')
    expect(more.attributes('title')).toBe('更多')
  })

  it('还没有消息时，侧边提问、清空和导出都置灰', () => {
    const items = mountTopNav({ empty: true }).findAll('.menu-item')
    expect(items.length).toBeGreaterThan(0)
    expect(items.every((item) => item.attributes('disabled') !== undefined)).toBe(true)
  })

  it('点击“导出图片”会触发图片导出', async () => {
    const wrapper = mountTopNav()
    const exportImage = wrapper.findAll('.menu-item').find((item) => item.text() === '导出图片')

    expect(exportImage).toBeDefined()
    await exportImage!.trigger('click')
    expect(wrapper.emitted('export-image')).toHaveLength(1)
  })

  it('点击「侧边问一句」会发出 side-question', async () => {
    const wrapper = mountTopNav()
    const sideQuestion = wrapper
      .findAll('.menu-item')
      .find((item) => item.text() === zhCN.assistant.sideQuestion.open)

    expect(sideQuestion).toBeDefined()
    await sideQuestion!.trigger('click')
    expect(wrapper.emitted('side-question')).toHaveLength(1)
  })

  it('把 chatSid 透传给 SessionProjectChip', () => {
    const chipStub = {
      name: 'SessionProjectChip',
      props: { chatSid: { type: String, default: '' } },
      template: '<div />'
    }
    const wrapper = mount(TopNav, {
      props: { chatSid: 'chat-7' },
      global: {
        stubs: {
          SessionProjectChip: chipStub,
          AppDropdown: passthrough,
          AppMenu: passthrough,
          AppMenuItem: menuItem,
          AppMenuDivider: true
        }
      }
    })

    expect(wrapper.findComponent(chipStub).props('chatSid')).toBe('chat-7')
  })
})
