import { describe, expect, it } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import type { TeamStateView } from '@core/shared/agentTeam'
import TeamReportPane from './TeamReportPane.vue'

describe('团队交付全文', () => {
  it('展示旧轮次交付的完整正文，记录移除后保留标题并提示', async () => {
    const body = `${'Godot 工程验证结果。\n'.repeat(300)}报告末尾`
    const team: TeamStateView = {
      objective: '检查工程',
      verdict: null,
      verdictStale: false,
      deliveries: 1,
      roundStartedAt: 100,
      members: [],
      board: [],
      mail: [],
      jobs: [
        {
          id: 'report-1',
          member: '检查员',
          brief: '检查工程',
          startedAt: 1,
          endedAt: 2,
          outcome: 'done',
          report: `# 工程报告\n\n${body}`
        }
      ]
    }
    const wrapper = shallowMount(TeamReportPane, {
      props: { team, jobId: 'report-1', title: '打开时标题' }
    })
    expect(wrapper.get('.report-title').text()).toBe('工程报告')
    expect(wrapper.getComponent({ name: 'MarkdownRenderer' }).props('content')).toBe(body)
    await wrapper.setProps({ team: { ...team, jobs: [] } })
    expect(wrapper.get('.report-title').text()).toBe('打开时标题')
    expect(wrapper.find('.report-gone').exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'MarkdownRenderer' }).exists()).toBe(false)
    wrapper.unmount()
  })
})
