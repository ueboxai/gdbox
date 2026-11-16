import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'

import AppMenu from './AppMenu.vue'
import AppMenuItem from './AppMenuItem.vue'
import AppMenuSubmenu from './AppMenuSubmenu.vue'

const mounted: VueWrapper[] = []

afterEach(() => {
  while (mounted.length) mounted.pop()?.unmount()
  document.body.innerHTML = ''
})

function mountMenu(onChoose = vi.fn()): VueWrapper {
  const wrapper = mount(
    {
      components: { AppMenu, AppMenuItem, AppMenuSubmenu },
      setup: () => ({ onChoose }),
      template: `
      <AppMenu>
        <AppMenuSubmenu>
          <template #title>归属项目</template>
          <AppMenuItem item-key="project-a" @click="onChoose">项目 A</AppMenuItem>
        </AppMenuSubmenu>
      </AppMenu>
    `
    },
    { attachTo: document.body }
  ) as VueWrapper
  mounted.push(wrapper)
  return wrapper
}

describe('AppMenuSubmenu', () => {
  it('鼠标移到父项时显示子菜单，并可点击其中的操作', async () => {
    const onChoose = vi.fn()
    const wrapper = mountMenu(onChoose)

    expect(
      wrapper.find('[role="menuitem"][aria-haspopup="menu"]').attributes('aria-expanded')
    ).toBe('false')

    await wrapper.get('.app-menu-submenu').trigger('mouseenter')
    expect(wrapper.find('.app-menu-submenu__popup').exists()).toBe(true)

    await wrapper.get('.app-menu-submenu__popup [role="menuitem"]').trigger('click')
    expect(onChoose).toHaveBeenCalledOnce()
  })

  it('键盘打开后把焦点送进第一项', async () => {
    const wrapper = mountMenu()
    const trigger = wrapper.get('[role="menuitem"][aria-haspopup="menu"]')

    await trigger.trigger('keydown', { key: 'ArrowRight' })
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.app-menu-submenu__popup').exists()).toBe(true)
    expect(document.activeElement).toBe(
      wrapper.get('.app-menu-submenu__popup [role="menuitem"]').element
    )
  })

  it('子菜单超出窗口底边时上移，超出右边界时向左展开', async () => {
    const wrapper = mountMenu()
    const rect = (r: Partial<DOMRect>): DOMRect =>
      ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, ...r }) as DOMRect
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(600)
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(800)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement
    ) {
      if (this.classList.contains('app-menu-submenu__popup')) {
        return rect({ top: 500, bottom: 700, width: 160, height: 200 })
      }
      return rect({ left: 600, right: 760, width: 160 })
    })

    await wrapper.get('.app-menu-submenu').trigger('mouseenter')
    await wrapper.vm.$nextTick()

    const popup = wrapper.get('.app-menu-submenu__popup')
    // 底边 700 超出 600-8，上移 108px
    expect((popup.element as HTMLElement).style.transform).toBe('translateY(-108px)')
    expect(wrapper.get('.app-menu-submenu').classes()).toContain('app-menu-submenu--left')
    vi.restoreAllMocks()
  })
})
