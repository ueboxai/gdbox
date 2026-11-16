import { describe, expect, it } from 'vitest'

import { createUpdatePlanTool, PLAN_REMINDER_EVERY, planReminder } from './turnReport'

function step(...calls: { id: string; name: string }[]): {
  content: { type: string; id: string; name: string }[]
} {
  return {
    content: [{ type: 'text', id: '', name: '' }, ...calls.map((c) => ({ type: 'toolCall', ...c }))]
  }
}

async function planWith(statuses: ('pending' | 'in_progress' | 'completed')[]): Promise<object> {
  const tool = createUpdatePlanTool()
  await tool.execute('p', {
    items: statuses.map((status, i) => ({ content: `第${i + 1}步`, status }))
  })
  return tool
}

describe('planReminder', () => {
  it('清单没走完：连续几步没碰清单才挂一次，挂在那一步最后一个调用上', async () => {
    const tools = [await planWith(['completed', 'in_progress', 'pending'])]
    const message = step({ id: 'a', name: 'read_local_file' }, { id: 'b', name: 'team_message' })
    for (let i = 1; i < PLAN_REMINDER_EVERY; i++) {
      expect(planReminder(tools, message, 'a')).toBeUndefined()
      expect(planReminder(tools, message, 'b')).toBeUndefined()
    }
    expect(planReminder(tools, message, 'a')).toBeUndefined()
    expect(planReminder(tools, message, 'b')).toContain('第 2/3 步「第2步」')
    expect(planReminder(tools, message, 'b')).toBeUndefined()
  })

  it('推进过清单就重新计数', async () => {
    const plan = await planWith(['in_progress', 'pending', 'pending'])
    const message = step({ id: 'a', name: 'read_local_file' })
    for (let i = 1; i < PLAN_REMINDER_EVERY; i++) planReminder([plan], message, 'a')
    await (plan as ReturnType<typeof createUpdatePlanTool>).execute('p2', { advance: true })
    expect(planReminder([plan], message, 'a')).toBeUndefined()
  })

  it('这一步自己调了 update_plan 就不挂', async () => {
    const tools = [await planWith(['in_progress', 'pending'])]
    const message = step({ id: 'a', name: 'update_plan' }, { id: 'b', name: 'read_local_file' })
    expect(planReminder(tools, message, 'b')).toBeUndefined()
  })

  it('没建清单、或者全打完勾，都不挂', async () => {
    const message = step({ id: 'a', name: 'read_local_file' })
    expect(planReminder([createUpdatePlanTool()], message, 'a')).toBeUndefined()
    expect(planReminder([await planWith(['completed', 'completed'])], message, 'a')).toBeUndefined()
    expect(planReminder([], message, 'a')).toBeUndefined()
  })
})
