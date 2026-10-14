import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PreferencesSidebar from './PreferencesSidebar.vue'

/**
 * 「项目设置」这一项以前被删过一次 —— 那时它是个空壳，点进去只有一句
 * 「设置搬到插件设置去了」。现在它重新出现，是因为里面真的有设置项
 * （打开工程后隐藏主界面）。这条测试守的是「入口在」，不是「入口不在」。
 */
describe('PreferencesSidebar', () => {
  it('列出项目入口，不再有引擎插件入口', () => {
    const wrapper = mount(PreferencesSidebar, {
      props: { activeKey: 'general' }
    })

    expect(wrapper.text()).toContain('项目')
    expect(wrapper.findAll('.nav-item').some((item) => item.text() === '插件')).toBe(false)
  })

  it('点项目会把 key 交给外面', async () => {
    const wrapper = mount(PreferencesSidebar, {
      props: { activeKey: 'general' }
    })

    const entry = wrapper.findAll('.nav-item').find((item) => item.text() === '项目库')!
    await entry.trigger('click')

    expect(wrapper.emitted('change')?.[0]).toEqual(['project'])
  })
})
