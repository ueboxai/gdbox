import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

import { useFilePathMenu } from './useFilePathMenu'

describe('路径菜单里的「在内置浏览器中打开」', () => {
  it('浏览器显示得了的文件才有这一项，点了交给对话的浏览器', async () => {
    const path = ref('C:/out/报告.html')
    const openInBrowser = vi.fn(async () => undefined)
    const { menuItems, runFilePathAction } = useFilePathMenu({ path, openInBrowser })

    expect(menuItems.value[0]).toMatchObject({ key: 'openInBrowser' })
    await runFilePathAction('openInBrowser', path.value)
    expect(openInBrowser).toHaveBeenCalledWith('C:/out/报告.html')

    path.value = 'C:/out/model.uasset'
    expect(menuItems.value.some((item) => item.key === 'openInBrowser')).toBe(false)
  })

  it('不在对话里（没给打开方式）就没有这一项', () => {
    const { menuItems } = useFilePathMenu({ path: ref('C:/out/a.pdf') })
    expect(menuItems.value.some((item) => item.key === 'openInBrowser')).toBe(false)
  })
})
