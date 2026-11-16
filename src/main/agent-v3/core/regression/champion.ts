/**
 * 冠军晋升判定（纯函数）。
 *
 * 候选快照晋升为冠军，必须同时满足：
 * 1. `godot_check` 零错误；
 * 2. 全部锁定用例在它上面通过；
 * 3. 独立验收在它上面给了 PASS，并且验收之后工程没再改过（tree id 不变）；
 * 4. 已经有冠军的话，它通过的用例数不少于冠军的。
 *
 * 第 4 条是 P1 的「更好」。P3 再加主观项的盲评成对比较。
 */

import type { GoalVerdict } from '../goalLoop'
import type { ChampionEntry } from './types'

export interface PromotionInput {
  checkErrors: number
  /** 锁定用例里没过的 id */
  lockedFailures: string[]
  verdict: GoalVerdict | null
  /** 验收开始时的 tree */
  deliveredTree: string
  /** 现在的 tree */
  currentTree: string
  /** candidate + locked 里通过的条数 */
  passedCases: number
  current: ChampionEntry | null
}

export type PromotionDecision = { promote: true } | { promote: false; reason: string }

export function decidePromotion(input: PromotionInput): PromotionDecision {
  if (input.checkErrors > 0) {
    return { promote: false, reason: `godot_check 有 ${input.checkErrors} 条报错` }
  }
  if (input.lockedFailures.length > 0) {
    return { promote: false, reason: `锁定用例没过：${input.lockedFailures.join('、')}` }
  }
  if (input.verdict?.kind !== 'pass') {
    return { promote: false, reason: '验收没给 PASS' }
  }
  if (input.deliveredTree !== input.currentTree) {
    return { promote: false, reason: '验收期间工程又被改过，验的不是现在这一版' }
  }
  if (input.current && input.passedCases < input.current.passedCases) {
    return {
      promote: false,
      reason: `通过的回放用例从冠军的 ${input.current.passedCases} 条降到 ${input.passedCases} 条`
    }
  }
  if (input.current && input.current.tree === input.currentTree) {
    return { promote: false, reason: '和现任冠军是同一版' }
  }
  return { promote: true }
}

export function describeChampion(entry: ChampionEntry | null, now: number = Date.now()): string {
  if (!entry) return '还没有冠军（没有任何一版同时过了机器门和验收）。'
  const mins = Math.round((now - entry.promotedAt) / 60_000)
  const ago = mins < 60 ? `${mins} 分钟前` : `${Math.round(mins / 60)} 小时前`
  return (
    `冠军：快照 ${entry.commit.slice(0, 7)}（${ago}晋升），回放用例 ` +
    `${entry.evidence.cases.passed}/${entry.evidence.cases.total} 过，验收：${entry.evidence.acceptance.reason || 'PASS'}`
  )
}
