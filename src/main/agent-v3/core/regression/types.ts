/**
 * 回放回归与冠军指针的数据形状。设计见 `docs/P1-回放回归与冠军指针设计-2026-10-21.md`。
 */

import type { z } from 'zod'

import type { runInputSchema } from './inputSchema'

export type AssertOp = '==' | '!=' | '<' | '<=' | '>' | '>='

/**
 * 什么时候判：最后一次采样、离某时刻最近的一次、任意一次、每一次。
 * `{ at: 秒 }` 用对象，免得和三个字面量混在一个字符串里解析
 */
export type AssertWhen = 'final' | 'ever' | 'always' | { at: number }

export interface RegressionAssert {
  /** 和 `godot_run` 的 watch 同一种写法，如 `Player:global_position:x` */
  expr: string
  op: AssertOp
  value: string | number | boolean
  when: AssertWhen
  /** 数值比较的容差 */
  tol?: number
}

/** 一次输入：动作、按键、点击、拖拽四选一 */
export type RegressionInput = z.infer<typeof runInputSchema>

/**
 * - `candidate`：入库时连跑两遍都过，等下一次冠军晋升时锁定
 * - `locked`：冠军晋升时通过了，之后每次交付都必须过，模型删不掉、改不动
 * - `flaky`：两遍跑出来不一样，不进门禁
 * - `retired`：制作人用 `regression_retire` 退役的（玩法真改了），留档不删
 */
export type CaseStatus = 'candidate' | 'locked' | 'flaky' | 'retired'

export interface RegressionCase {
  id: string
  title: string
  /** res:// 场景；空 = 主场景 */
  scene: string
  seconds: number
  seed: number
  inputs: RegressionInput[]
  /**
   * `project`：无头运行时窗口撑到工程分辨率（点鼠标、看可见区域都要它）。
   * 早先的用例没有这一项，按无头默认的 64×64 跑，结果才和录的时候一样
   */
  viewport?: 'project'
  watch: string[]
  asserts: RegressionAssert[]
  status: CaseStatus
  origin: { by: string; at: number; tree?: string }
  lockedAt?: number
  retired?: { by: string; at: number; reason: string }
  /** flaky 的原因：哪个值两遍不一样 */
  flakyReason?: string
}

export interface AssertOutcome {
  assert: RegressionAssert
  pass: boolean
  /** 判定用到的实际值（`ever`/`always` 给最能说明问题的那一个） */
  actual?: string
  at?: number
}

export interface CaseResult {
  id: string
  pass: boolean
  /** 不过的原因，一行一条：崩溃、报错、断言没过（带实际值） */
  failures: string[]
  ms: number
  /** 断言涉及的值的逐帧序列指纹，两遍比对用 */
  fingerprint: string
}

export interface ChampionEvidence {
  check: string
  cases: { locked: number; passed: number; total: number }
  acceptance: { verdict: 'pass'; reason: string }
}

export interface ChampionEntry {
  /** 快照仓库里的完整提交号 */
  commit: string
  /** 工程源文件的 tree id：判「验收之后改没改过」用 */
  tree: string
  promotedAt: number
  /** 通过的用例数（candidate + locked），下一任必须不少于它 */
  passedCases: number
  evidence: ChampionEvidence
}

export interface ChampionRecord {
  current: ChampionEntry | null
  history: ChampionEntry[]
}
