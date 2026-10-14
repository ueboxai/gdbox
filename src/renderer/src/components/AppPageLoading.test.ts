import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import AppPageLoading from './AppPageLoading.vue'
import AppPageSkeleton from './AppPageSkeleton.vue'

describe('destination-shaped page loading', () => {
  beforeEach(() => localStorage.clear())

  it('shows project covers without a banner', () => {
    const wrapper = mount(AppPageLoading, { props: { path: '/' } })
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.findAllComponents(AppPageSkeleton).map((item) => item.props('variant'))).toEqual(
      ['projects']
    )
    expect(wrapper.find('.asset-tree').exists()).toBe(false)
  })

  it('uses saved asset widths and details visibility without overwriting them', () => {
    localStorage.setItem('assetManagement.treePanelWidth', '410')
    localStorage.setItem('assetManagement.displaySize', '180')
    localStorage.setItem('assetManagement.detailsPanel.visible', 'false')
    const wrapper = mount(AppPageLoading, { props: { path: '/asset-management' } })
    expect(wrapper.get('.asset-tree').attributes('style')).toContain('410px')
    expect(wrapper.get('.asset-main').attributes('style')).toContain('180px')
    expect(wrapper.find('.asset-details').exists()).toBe(false)
    expect(wrapper.findAllComponents(AppPageSkeleton).map((item) => item.props('variant'))).toEqual(
      ['folders', 'assets']
    )
    expect(localStorage.getItem('assetManagement.detailsPanel.visible')).toBe('false')
  })

  it('shows three studio columns without inventing a preview image', () => {
    const wrapper = mount(AppPageLoading, { props: { path: '/aigc-studio' } })
    expect(wrapper.find('.workspace-input').exists()).toBe(true)
    expect(wrapper.find('.workspace-preview').exists()).toBe(true)
    expect(wrapper.find('.workspace-history').exists()).toBe(true)
    expect(wrapper.find('img').exists()).toBe(false)
  })

  it('replaces the pending layout when the destination changes', async () => {
    const wrapper = mount(AppPageLoading, { props: { path: '/' } })
    await wrapper.setProps({ path: '/notebooks' })
    expect(wrapper.find('.project-banner').exists()).toBe(false)
    expect(wrapper.getComponent(AppPageSkeleton).props('variant')).toBe('notebooks')
    await wrapper.setProps({ path: '/notebooks/item-1' })
    expect(wrapper.find('.workspace-preview').exists()).toBe(true)
  })
})
