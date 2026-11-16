import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

/**
 * 冠军区：摘要、原地确认后才恢复、跑着时不能恢复、用例列表和被改过的用例
 */
import TeamChampionCard from './TeamChampionCard.vue'
import type { TeamChampionView } from '@core/shared/agentTeam'

const champion: TeamChampionView = {
  current: {
    snapshot: 'a1b2c3d',
    promotedAt: Date.now() - 5 * 60_000,
    passed: 3,
    total: 4,
    reason: '从标题玩到通关再重开'
  },
  promotions: 2,
  cases: [
    { id: 'c0001', title: '首房能到出口', status: 'locked' },
    { id: 'c0002', title: '死亡复位', status: 'retired', note: '改成检查点复活' }
  ],
  tampered: ['c0003']
}

describe('TeamChampionCard', () => {
  it('摘要、验收理由和被改过的用例都显示', () => {
    const w = mount(TeamChampionCard, { props: { champion } })
    expect(w.text()).toContain('a1b2c3d')
    expect(w.text()).toContain('3/4')
    expect(w.text()).toContain('从标题玩到通关再重开')
    expect(w.text()).toContain('c0003')
  })

  it('恢复要先在原地确认；取消不发', async () => {
    const w = mount(TeamChampionCard, { props: { champion } })
    const restoreButton = (): ReturnType<typeof w.findAll>[number] =>
      w.findAll('button').find((b) => /恢复到冠军|Restore champion/.test(b.text()))!
    await restoreButton().trigger('click')
    expect(w.find('[role="alertdialog"]').exists()).toBe(true)
    const cancel = w.findAll('[role="alertdialog"] button').at(-1)!
    await cancel.trigger('click')
    expect(w.emitted('restore')).toBeUndefined()

    await restoreButton().trigger('click')
    await w.findAll('[role="alertdialog"] button')[0]!.trigger('click')
    expect(w.emitted('restore')).toHaveLength(1)
  })

  it('团队在跑：恢复按钮禁用；没有冠军时不给按钮', () => {
    const running = mount(TeamChampionCard, { props: { champion, running: true } })
    const button = running
      .findAll('button')
      .find((b) => /恢复到冠军|Restore champion/.test(b.text()))!
    expect(button.attributes('disabled')).toBeDefined()

    const none = mount(TeamChampionCard, { props: { champion: { ...champion, current: null } } })
    expect(none.findAll('button').some((b) => /恢复到冠军|Restore champion/.test(b.text()))).toBe(
      false
    )
  })

  it('用例列表折叠，点开看状态和退役理由', async () => {
    const w = mount(TeamChampionCard, { props: { champion } })
    expect(w.find('.cases').exists()).toBe(false)
    await w.find('.fold').trigger('click')
    expect(w.findAll('.case')).toHaveLength(2)
    expect(w.text()).toContain('改成检查点复活')
  })
})
