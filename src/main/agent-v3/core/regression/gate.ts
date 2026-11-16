/**
 * 交付时的机器门和冠军晋升。
 *
 * `team_deliver` 先过机器门（`godot_check` + 全部回放用例），锁定用例有一条不过就直接 FAIL、
 * 不请验收员 —— 真机上最常见的浪费就是「还没跑通就叫人来验」。机器门过了再请验收员；
 * PASS 之后按 `champion.ts` 的四条判晋升，晋升时把这一版上通过的候选用例一起锁定。
 *
 * 起 Godot、碰 git 的都由调用方注入，这里能直接单测。
 */

import type { GoalVerdict } from '../goalLoop'
import type { SnapshotHead } from '../team/snapshots'
import { decidePromotion, describeChampion } from './champion'
import { formatReport, runRegression, type RegressionReport, type ReplayExecutor } from './runner'
import type { RegressionStore } from './store'
import type { ChampionEntry, RegressionCase } from './types'

export interface GateSnapshots {
  save(message: string): Promise<unknown>
  head(): Promise<SnapshotHead | null>
  workTree(): Promise<string>
  pinChampion(commit: string): Promise<void>
}

export interface GateDeps {
  store: RegressionStore
  snapshots: GateSnapshots
  exec: ReplayExecutor
  /** 跑一遍 `godot_check`，回报错列表 */
  check: (signal?: AbortSignal) => Promise<string[]>
  now?: () => number
}

export interface GateResult {
  commit: string
  tree: string
  checkErrors: string[]
  report: RegressionReport
  /** 参与这次回归的用例（候选 + 锁定） */
  cases: RegressionCase[]
  lockedFailures: string[]
  tampered: string[]
  /** 锁定用例没过或者有报错：不该请验收员 */
  blocked: boolean
  text: string
}

export async function runMachineGate(
  deps: GateDeps,
  options: { signal?: AbortSignal; onProgress?: (text: string) => void } = {}
): Promise<GateResult> {
  await deps.snapshots.save('交付前（机器门）')
  const head = await deps.snapshots.head()
  if (!head) throw new Error('工程还没有任何快照，没法过机器门')
  options.onProgress?.('机器门：godot_check…')
  const checkErrors = await deps.check(options.signal)
  const { cases: all, tampered } = await deps.store.list()
  const cases = all.filter((c) => c.status === 'locked' || c.status === 'candidate')
  const report = await runRegression(deps.exec, deps.store, cases, head.tree, options)
  const failed = new Set(report.results.filter((r) => !r.pass).map((r) => r.id))
  const lockedFailures = cases
    .filter((c) => c.status === 'locked' && failed.has(c.id))
    .map((c) => c.id)
  const blocked = checkErrors.length > 0 || lockedFailures.length > 0
  const titles = new Map(cases.map((c) => [c.id, c.title]))
  const lines = [
    checkErrors.length
      ? `godot_check：${checkErrors.length} 条报错\n${checkErrors.slice(0, 5).join('\n')}`
      : 'godot_check：零错误',
    formatReport(report, titles),
    lockedFailures.length
      ? `锁定用例没过（${lockedFailures.join('、')}）：之前验收过的东西被改坏了，先修好。`
      : '',
    tampered.length
      ? `注意：用例 ${tampered.join('、')} 的文件和盒子记下的指纹对不上（被改过或被删了），已报给用户。`
      : ''
  ].filter(Boolean)
  return {
    commit: head.commit,
    tree: head.tree,
    checkErrors,
    report,
    cases,
    lockedFailures,
    tampered,
    blocked,
    text: lines.join('\n\n')
  }
}

/** 验收有了结论之后：判晋升，晋升就记冠军、锁用例、钉快照。回一段给模型和用户看的话 */
export async function settleChampion(
  deps: GateDeps,
  gate: GateResult,
  verdict: GoalVerdict | null
): Promise<{ promoted: ChampionEntry | null; text: string }> {
  const now = deps.now?.() ?? Date.now()
  const record = await deps.store.champion()
  const passedIds = gate.report.results.filter((r) => r.pass).map((r) => r.id)
  const decision = decidePromotion({
    checkErrors: gate.checkErrors.length,
    lockedFailures: gate.lockedFailures,
    verdict,
    deliveredTree: gate.tree,
    currentTree: await deps.snapshots.workTree(),
    passedCases: passedIds.length,
    current: record.current
  })
  if (!decision.promote) {
    return {
      promoted: null,
      text: `冠军没换（${decision.reason}）。${describeChampion(record.current, now)}`
    }
  }
  const entry: ChampionEntry = {
    commit: gate.commit,
    tree: gate.tree,
    promotedAt: now,
    passedCases: passedIds.length,
    evidence: {
      check: '0 errors',
      cases: {
        locked: gate.cases.filter((c) => c.status === 'locked').length,
        passed: passedIds.length,
        total: gate.cases.length
      },
      acceptance: { verdict: 'pass', reason: verdict?.reason ?? '' }
    }
  }
  await deps.store.promote(entry)
  const toLock = gate.cases.filter((c) => c.status === 'candidate' && passedIds.includes(c.id))
  await deps.store.lock(
    toLock.map((c) => c.id),
    now
  )
  await deps.snapshots.pinChampion(gate.commit).catch(() => undefined)
  return {
    promoted: entry,
    text:
      `冠军已更新为快照 ${gate.commit.slice(0, 7)}。` +
      (toLock.length ? `新锁定 ${toLock.length} 条回放用例，之后每次交付都必须过。` : '')
  }
}
