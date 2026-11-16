import { describe, expect, it } from 'vitest'

import { MAX_REVIEW_FIX_ROUNDS, runReviewLoop, type ReviewLoopDeps } from './reviewLoop'

/** 按顺序回话的假队员；记下每次谁收到了什么 */
function team(script: Record<string, string[]>): {
  deps: ReviewLoopDeps
  calls: Array<{ name: string; message: string }>
  counts: Map<string, number>
} {
  const calls: Array<{ name: string; message: string }> = []
  const counts = new Map<string, number>()
  return {
    calls,
    counts,
    deps: {
      run: async (name, message) => {
        calls.push({ name, message })
        const next = script[name]!.shift()
        if (next === undefined) throw new Error(`${name} 没有剧本了`)
        if (next === 'THROW') throw new Error('stopped')
        return { raw: next, text: `${name} 回话：\n${next}` }
      },
      bumpFails: async (key) => {
        const n = (counts.get(key) ?? 0) + 1
        counts.set(key, n)
        return n
      },
      clearFails: async (key) => void counts.delete(key)
    }
  }
}

const input = { reviewer: '质保', author: '关卡', brief: '验第一章', task: 'ch1' }

describe('runReviewLoop', () => {
  it('一次就过：只跑评审，要求它给 VERDICT', async () => {
    const t = team({ 质保: ['VERDICT: PASS — 通关了'] })
    const out = await runReviewLoop(input, t.deps)
    expect(t.calls).toHaveLength(1)
    expect(t.calls[0]!.message).toContain('VERDICT: FAIL — <关卡 要修的具体问题>')
    expect(out).toContain('通关了')
    expect(out).not.toContain('自动返工')
  })

  it('FAIL 直接转作者返工、再让同一评审复验，通过后清零', async () => {
    const t = team({
      质保: ['VERDICT: FAIL — 房3出口卡死', 'VERDICT: PASS — 修好了'],
      关卡: ['移了出口平台']
    })
    t.counts.set('ch1', 0)
    const out = await runReviewLoop(input, t.deps)
    expect(t.calls.map((c) => c.name)).toEqual(['质保', '关卡', '质保'])
    expect(t.calls[1]!.message).toContain('房3出口卡死')
    expect(t.calls[1]!.message).toContain(`第 1/${MAX_REVIEW_FIX_ROUNDS} 轮`)
    expect(t.calls[2]!.message).toContain('移了出口平台')
    expect(t.calls[2]!.message).toContain('验第一章')
    expect(out).toContain('经 1 轮自动返工后通过')
    expect(t.counts.has('ch1')).toBe(false)
  })

  it('打回超过上限就停，交回制作人', async () => {
    const fails = Array.from(
      { length: MAX_REVIEW_FIX_ROUNDS + 1 },
      (_, i) => `VERDICT: FAIL — 第${i}次`
    )
    const t = team({ 质保: fails, 关卡: Array(MAX_REVIEW_FIX_ROUNDS).fill('改了') })
    const out = await runReviewLoop(input, t.deps)
    expect(t.calls.filter((c) => c.name === '关卡')).toHaveLength(MAX_REVIEW_FIX_ROUNDS)
    expect(out).toContain('【返工到顶】')
    expect(out).toContain(`打回 ${MAX_REVIEW_FIX_ROUNDS + 1} 次`)
  })

  it('计数跨调用累计：之前已到顶的，这次 FAIL 不再转', async () => {
    const t = team({ 质保: ['VERDICT: FAIL — 还是不行'], 关卡: [] })
    t.counts.set('ch1', MAX_REVIEW_FIX_ROUNDS)
    const out = await runReviewLoop(input, t.deps)
    expect(t.calls).toHaveLength(1)
    expect(out).toContain('【返工到顶】')
  })

  it('没给任务就按作者计', async () => {
    const t = team({ 质保: ['VERDICT: FAIL — x', 'VERDICT: PASS — y'], 关卡: ['改了'] })
    await runReviewLoop({ ...input, task: undefined }, t.deps)
    expect(t.counts.has('关卡')).toBe(false)
    expect(t.calls).toHaveLength(3)
  })

  it('没有 VERDICT、BLOCKED：不转，交回', async () => {
    const none = team({ 质保: ['看着还行'] })
    expect(await runReviewLoop(input, none.deps)).toContain('【没有自动转】')
    const blocked = team({ 质保: ['VERDICT: BLOCKED — 工程打不开'] })
    expect(await runReviewLoop(input, blocked.deps)).toContain('【评审卡住】')
  })

  it('返工或复验中途停下：带回已经发生的几轮', async () => {
    const fix = team({ 质保: ['VERDICT: FAIL — 卡死'], 关卡: ['THROW'] })
    const out = await runReviewLoop(input, fix.deps)
    expect(out).toContain('FAIL — 卡死')
    expect(out).toContain('【返工没干完】关卡 停下了：stopped')

    const recheck = team({ 质保: ['VERDICT: FAIL — 卡死', 'THROW'], 关卡: ['改了'] })
    const out2 = await runReviewLoop(input, recheck.deps)
    expect(out2).toContain('关卡 第 1 轮返工交回：\n改了')
    expect(out2).toContain('【复验没干完】')

    // 头一次评审就停：照普通派活抛出去
    const first = team({ 质保: ['THROW'] })
    await expect(runReviewLoop(input, first.deps)).rejects.toThrow('stopped')
  })
})
