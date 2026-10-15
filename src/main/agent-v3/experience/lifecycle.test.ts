import { describe, expect, it } from 'vitest'

import type { ExperienceEntry } from './experienceFile'
import {
  applyOutcome,
  emptyStats,
  evictionScore,
  lift,
  type EntryStats,
  type Outcome
} from './lifecycle'

const shown = (adopted: boolean, ok: boolean | undefined): Outcome => ({
  arm: 'shown',
  adopted,
  ok
})
const holdout = (ok: boolean): Outcome => ({ arm: 'holdout', adopted: false, ok })

function run(
  outcomes: Outcome[],
  status: 'trial' | 'proven' = 'trial',
  pinned = false
): { stats: EntryStats; status: 'trial' | 'proven' | 'retired' } {
  let stats: EntryStats = emptyStats()
  let current: 'trial' | 'proven' | 'retired' = status
  for (const outcome of outcomes) {
    const next = applyOutcome({ status: current, pinned }, stats, outcome)
    stats = next.stats
    current = next.status
  }
  return { stats, status: current }
}

describe('lifecycle', () => {
  it('只给被采纳且随后成功的记功：没被采纳的成功不算', () => {
    const { stats, status } = run([shown(false, true), shown(false, true), shown(false, true)])
    expect(stats.adoptedOk).toBe(0)
    expect(status).toBe('trial')
  })

  it('对照样本不够时，采纳后成功 3 次且成功率达标就转正', () => {
    expect(run([shown(true, true), shown(true, true), shown(true, true)]).status).toBe('proven')
  })

  it('有对照时看提升：出场不比不出场好就不转正', () => {
    const { status, stats } = run([
      holdout(true),
      holdout(true),
      holdout(true),
      shown(true, true),
      shown(true, true),
      shown(true, false),
      shown(true, true)
    ])
    expect(lift(stats)).toBeLessThan(0)
    expect(status).not.toBe('proven')
  })

  it('照着做了还是同一个错：转正的当场降回试用，试用的错两次退休', () => {
    expect(run([shown(true, false)], 'proven').status).toBe('trial')
    expect(run([shown(true, false), shown(true, false)]).status).toBe('retired')
  })

  it('连续被忽略 5 次退休；钉住的不退休', () => {
    const ignored = Array.from({ length: 5 }, () => shown(false, undefined))
    expect(run(ignored).status).toBe('retired')
    expect(run(ignored, 'trial', true).status).toBe('trial')
  })

  it('样本够了、提升不为正就退休', () => {
    const outcomes = [
      ...Array.from({ length: 5 }, () => holdout(true)),
      ...Array.from({ length: 5 }, () => shown(true, undefined))
    ]
    expect(run(outcomes).status).toBe('retired')
  })

  it('退休时说得出原因', () => {
    const once = (before: EntryStats, outcome: Outcome): string | undefined =>
      applyOutcome({ status: 'trial' }, before, outcome).retiredBecause
    expect(once({ ...emptyStats(), adoptedFail: 1 }, shown(true, false))).toBe('failed')
    expect(once({ ...emptyStats(), ignoredStreak: 4 }, shown(false, undefined))).toBe('ignored')
    expect(once(emptyStats(), shown(true, true))).toBeUndefined()
  })
})

describe('淘汰顺序', () => {
  const entry = (status: 'trial' | 'proven'): ExperienceEntry => ({
    id: 'e',
    title: 't',
    tool: 'godot_check',
    errorPattern: 'p',
    advice: 'a',
    expect: {},
    source: '',
    status
  })

  it('没出过场的试用排在「出过场却没成」的后面、「成过」的前面', () => {
    const untested = evictionScore(entry('trial'), emptyStats())
    const failedOnce = evictionScore(entry('trial'), { ...emptyStats(), shown: 1 })
    const workedOnce = evictionScore(entry('trial'), { ...emptyStats(), shown: 1, adoptedOk: 1 })
    expect(failedOnce).toBeLessThan(untested)
    expect(untested).toBeLessThan(workedOnce)
    expect(workedOnce).toBeLessThan(evictionScore(entry('proven'), emptyStats()))
  })
})
