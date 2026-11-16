import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/layout/components/SideMenu.vue'),
  'utf8'
)

describe('侧栏「更多」', () => {
  it('点击打开，弹层是可键盘操作的菜单', () => {
    expect(source).toMatch(
      /<AppDropdown[^>]*v-model:open="morePopupOpen"[^>]*:trigger="\['click'\]"/
    )
    expect(source).toMatch(/<button[\s\S]*?class="more-trigger"/)
    expect(source).toMatch(/<AppMenu ref="moreMenuRef"[\s\S]*?<AppMenuItem/)
    expect(source).not.toContain('<Popover')
  })

  // 共创市场没有路由，这块空壳每次都渲染出一条多余的分隔线
  it('不再渲染共创市场空壳和它的分隔线', () => {
    expect(source).not.toContain('coCreateMarketItem')
    expect(source).not.toContain('<Menu.Divider />')
  })
})
