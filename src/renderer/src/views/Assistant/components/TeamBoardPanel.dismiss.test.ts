import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'

/**
 * 任务板上的辞退：入口、对话框、档案列表。和 TeamBoardPanel.test.ts 同一份团队样例
 */
import TeamBoardPanel from './TeamBoardPanel.vue'
import { setOfficeStyle } from './teamOffice/officeStyle'
import type { TeamStateView } from '@core/shared/agentTeam'

const now = Date.now()
const min = (n: number): number => now - n * 60_000

const team: TeamStateView = {
  objective: '统计一下当前项目的信息',
  verdict: 'pass',
  verdictAt: min(90),
  verdictStale: false,
  deliveries: 1,
  roundStartedAt: min(60),
  members: [
    { name: '资产统计员', persona: '统计资产', tier: 'strong', readOnly: true, hiredAt: 1 },
    { name: '配置统计员', persona: '统计配置', tier: 'strong', readOnly: true, hiredAt: 2 }
  ],
  board: [
    { id: 't1', title: '统计配置', owner: '配置统计员', status: 'done', updatedAt: min(30) },
    {
      id: 't2',
      title: '核对重定向器',
      owner: '资产统计员',
      status: 'blocked',
      note: '等你确认删不删',
      updatedAt: min(5)
    }
  ],
  mail: [
    { id: 'm1', from: '配置统计员', to: '资产统计员', text: '你好，我是配置统计员。', at: min(20) },
    {
      id: 'm2',
      from: 'producer',
      to: '资产统计员',
      text: '提醒：编辑器崩溃过一次，已重启。',
      at: min(3),
      readAt: min(2)
    },
    {
      id: 'm3',
      from: 'producer',
      to: '配置统计员',
      text: '提醒：编辑器崩溃过一次，已重启。',
      at: min(3)
    }
  ],
  jobs: [
    {
      id: 'j1',
      member: '配置统计员',
      brief: '统计引擎配置和插件',
      startedAt: min(50),
      endedAt: min(30),
      outcome: 'done',
      report:
        '任务已完成，报告全文如下。\n\n# 配置统计报告\n\n- 引擎 5.7\n- 插件 23 个\n\n## 模块\n\n- NeonHarbor'
    },
    { id: 'j2', member: '资产统计员', brief: '统计全部资产', startedAt: min(10) }
  ],
  events: [{ kind: 'crashed', at: min(4), detail: 'Assertion failed' }],
  live: {
    running: ['producer', '资产统计员'],
    waiting: [],
    awaited: [],
    assignments: [{ member: '资产统计员', text: '统计全部资产', since: min(10) }],
    recent: []
  }
}

/** 正文渲染器、办公室换成小壳：这里只测任务板 */
const stubs = {
  MarkdownRenderer: { props: ['content'], template: '<div class="md-stub">{{ content }}</div>' },
  TeamOffice: { template: '<div class="office-stub" />' },
  // 辞退对话框里的输入框（antd），换成原生的
  'a-textarea': {
    props: ['value'],
    emits: ['update:value'],
    template: `<textarea :value="value" @input="$emit('update:value', $event.target.value)" />`
  }
}

describe('辞退队员', () => {
  function mountWith(props: Record<string, unknown> = {}): VueWrapper {
    return mount(TeamBoardPanel, {
      props: { team, docked: true, ...props },
      global: { stubs },
      attachTo: document.body
    })
  }
  async function openCard(wrapper: VueWrapper, name: string): Promise<void> {
    await wrapper
      .findAll('.crew-card')
      .find((card) => card.text().includes(name))!
      .trigger('click')
  }
  const okButton = (): HTMLButtonElement =>
    [...document.querySelectorAll<HTMLButtonElement>('.app-modal__footer button')].at(-1)!

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('手上有活的灰掉；空着的点开写了理由才能确认，确认后报给外面', async () => {
    setOfficeStyle('v2')
    const wrapper = mountWith()
    await openCard(wrapper, '资产统计员')
    expect(wrapper.find('.member-dismiss').attributes('disabled')).toBeDefined()

    await openCard(wrapper, '配置统计员')
    const button = wrapper.find('.member-dismiss')
    expect(button.attributes('disabled')).toBeUndefined()
    await button.trigger('click')
    // 事实和档案同一份：配置统计员交回过 1 件
    expect(document.body.textContent).toContain('已交回 1 项任务，中途停止 0 项')
    expect(okButton().disabled).toBe(true)

    const field = document.querySelector('textarea')!
    field.value = '统计口径不对'
    field.dispatchEvent(new Event('input'))
    await wrapper.vm.$nextTick()
    expect(okButton().disabled).toBe(false)
    okButton().click()
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('dismiss')).toEqual([['配置统计员', '统计口径不对']])
  })

  it('外部团队不给辞退入口', async () => {
    setOfficeStyle('v2')
    const wrapper = mountWith({ team: { ...team, external: true } })
    await openCard(wrapper, '配置统计员')
    expect(wrapper.find('.member-dismiss').exists()).toBe(false)
  })

  it('辞退档案默认收着，点开看谁辞的、理由、事实和交接', async () => {
    setOfficeStyle('v1')
    const wrapper = mountWith({
      team: {
        ...team,
        dismissals: [
          {
            name: '美术',
            at: min(10),
            by: 'producer',
            grounds: 'quality',
            reason: '贴图两次被打回',
            evidence: [{ kind: 'job', id: 'j7', text: '画主角（交回）' }],
            facts: {
              jobsDone: 2,
              jobsStopped: 1,
              tasks: { todo: 0, doing: 1, done: 2, blocked: 0 }
            },
            member: { name: '美术', persona: '画', tier: 'strong', readOnly: false, hiredAt: 1 },
            handover: { tasks: ['t9'] },
            memoryArchive: 'members/dismissed/美术-1.json'
          }
        ]
      }
    })
    const section = wrapper.find('.dismissals')
    expect(section.text()).toContain('已辞退 1 人')
    expect(section.find('.record').exists()).toBe(false)
    await section.find('.fold').trigger('click')
    const text = section.text()
    expect(text).toContain('由制作人辞退')
    expect(text).toContain('交付不达标')
    expect(text).toContain('贴图两次被打回')
    expect(text).toContain('已交回 2 项任务，中途停止 1 项')
    expect(text).toContain('j7 画主角（交回）')
    expect(text).toContain('未完成的任务已清除负责人：t9')
  })
})
