import { describe, expect, it } from 'vitest'

import type { ChangeGroup } from './changeSummary'
import { AUTO_REVIEW_MAX_TARGETS, reviewTargetsFrom, shouldAutoReview } from './reviewTargets'

function group(patch: Partial<ChangeGroup>): ChangeGroup {
  return {
    key: patch.target ?? 'k',
    target: '',
    local: false,
    action: 'modified',
    kind: '',
    stepCount: 1,
    failedCount: 0,
    irreversibleCount: 0,
    steps: [],
    ...patch
  }
}

describe('reviewTargetsFrom', () => {
  it('工程内的资源带着动作和类别送去审查', () => {
    const targets = reviewTargetsFrom([
      group({ target: 'res://art/wood.tres', action: 'created', kind: 'resource' })
    ])

    expect(targets).toEqual([{ path: 'res://art/wood.tres', action: 'created', kind: 'resource' }])
  })

  it('硬盘上的文件不送 —— 审查只认 res:// 路径，只会换回一条假的「资源不存在」', () => {
    expect(
      reviewTargetsFrom([group({ target: 'D:/proj/说明.html', local: true, kind: 'file' })])
    ).toEqual([])
  })

  it('素材库资产和取不到目标的调用都不送', () => {
    expect(
      reviewTargetsFrom([
        group({ target: 'hero', kind: 'asset' }),
        group({ target: '', key: 'editor_play' })
      ])
    ).toEqual([])
  })

  it('失败的步骤照送 —— 该不该报警由工程的实际状态说了算', () => {
    const targets = reviewTargetsFrom([
      group({ target: 'res://player.gd', action: 'created', kind: 'script', failedCount: 3 })
    ])

    expect(targets).toHaveLength(1)
  })
})

describe('shouldAutoReview', () => {
  const targets = (count: number): ReturnType<typeof reviewTargetsFrom> =>
    Array.from({ length: count }, (_, i) => ({
      path: `res://art/m_${i}.tres`,
      action: 'modified' as const
    }))

  it('没改引擎资产就不跑 —— 引擎那边一个问题都答不上来', () => {
    expect(shouldAutoReview([])).toBe(false)
  })

  it('改动不多时自动跑', () => {
    expect(shouldAutoReview(targets(1))).toBe(true)
    expect(shouldAutoReview(targets(AUTO_REVIEW_MAX_TARGETS))).toBe(true)
  })

  it('超过上限留给用户点 —— 每个资产都要在游戏线程上 load 一遍', () => {
    expect(shouldAutoReview(targets(AUTO_REVIEW_MAX_TARGETS + 1))).toBe(false)
  })
})
