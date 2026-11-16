/**
 * 跑回放用例：一条一条串行跑，判过没过；按「工程 tree id + 用例指纹」缓存，工程没变不重跑。
 *
 * 起 Godot 的那一半由调用方注入（`ReplayExecutor`），这里只管判定和缓存 ——
 * 真起 Godot 的实现在 `tools/godot/regression.ts`，测试里换成假的。
 */

import {
  describeFailure,
  describeProbe,
  evaluateAsserts,
  parseProbes,
  parseWatchSamples,
  seriesFingerprint
} from './assert'
import { caseKey, type RegressionStore } from './store'
import type { CaseResult, RegressionCase } from './types'

/** 逐帧采样：`ever`/`always` 要看每一帧 */
export const REPLAY_SAMPLE_INTERVAL = 1 / 60

export interface ReplayConfig {
  scene: string
  seconds: number
  seed: number
  inputs: RegressionCase['inputs']
  watch: string[]
  sample_interval: number
  screenshots: []
  full_viewport: boolean
}

export interface ReplayOutput {
  /** 运行器打出来的全部行 */
  lines: string[]
  timedOut: boolean
  /** `digestGodotLog` 认出来的脚本 / 引擎报错 */
  errors: string[]
}

export type ReplayExecutor = (config: ReplayConfig, signal?: AbortSignal) => Promise<ReplayOutput>

export function replayConfigOf(
  c: Pick<
    RegressionCase,
    'scene' | 'seconds' | 'seed' | 'inputs' | 'watch' | 'asserts' | 'viewport'
  >
): ReplayConfig {
  return {
    scene: c.scene,
    seconds: c.seconds,
    seed: c.seed,
    inputs: c.inputs,
    // 断言用到的值一定要采：漏写进 watch 的这里补上
    watch: [...new Set([...c.watch, ...c.asserts.map((a) => a.expr)])],
    sample_interval: REPLAY_SAMPLE_INTERVAL,
    screenshots: [],
    full_viewport: c.viewport === 'project'
  }
}

/** 一条用例跑一遍。除了显式断言，还隐含三条：跑完了、没报错、按键动作都存在 */
export async function runCase(
  exec: ReplayExecutor,
  c: Pick<
    RegressionCase,
    'id' | 'scene' | 'seconds' | 'seed' | 'inputs' | 'watch' | 'asserts' | 'viewport'
  >,
  signal?: AbortSignal
): Promise<CaseResult> {
  const started = Date.now()
  const out = await exec(replayConfigOf(c), signal)
  const failures: string[] = []
  const fatal = out.lines.find((l) => l.startsWith('GDBOX_FATAL'))
  if (fatal) failures.push(`起不来：${fatal.slice('GDBOX_FATAL '.length)}`)
  if (out.timedOut) failures.push('超时没跑完')
  else if (!fatal && !out.lines.some((l) => l.startsWith('GDBOX_END'))) {
    failures.push('中途结束（崩溃或退出）')
  }
  for (const [prefix, label] of [
    ['GDBOX_WARN unknown input action ', '按键动作不存在'],
    ['GDBOX_WARN unknown key ', '按键名不认识'],
    ['GDBOX_WARN click target not found ', '点击目标找不到'],
    ['GDBOX_WARN drag target not found ', '拖拽目标找不到']
  ] as const) {
    for (const line of out.lines.filter((l) => l.startsWith(prefix))) {
      failures.push(`${label}：${line.slice(prefix.length)}`)
    }
  }
  // NaN 一定是 bug；飞出世界可能是故意的（不回收的远景），不拿来判
  for (const p of parseProbes(out.lines).filter((p) => p.kind === 'nan')) {
    failures.push(describeProbe(p))
  }
  if (out.errors.length) {
    failures.push(`运行中有 ${out.errors.length} 条报错：${out.errors[0]!.split('\n')[0]}`)
  }
  const samples = parseWatchSamples(out.lines)
  for (const outcome of evaluateAsserts(c.asserts, samples)) {
    if (!outcome.pass) failures.push(describeFailure(outcome))
  }
  return {
    id: c.id,
    pass: failures.length === 0,
    failures,
    ms: Date.now() - started,
    fingerprint: seriesFingerprint(c.asserts, samples)
  }
}

export type Admission =
  | { ok: true; result: CaseResult }
  | { ok: false; flaky: false; failures: string[] }
  | { ok: false; flaky: true; reason: string }

/**
 * 入库门槛：在当前工程上连跑两遍。第一遍不过 → 拒收（用例必须提交时就是对的）；
 * 两遍断言值的序列不一样 → 不确定，标 flaky，不进门禁
 */
export async function admitCase(
  exec: ReplayExecutor,
  c: Parameters<typeof runCase>[1],
  signal?: AbortSignal
): Promise<Admission> {
  const first = await runCase(exec, c, signal)
  if (!first.pass) return { ok: false, flaky: false, failures: first.failures }
  const second = await runCase(exec, c, signal)
  if (!second.pass || second.fingerprint !== first.fingerprint) {
    return {
      ok: false,
      flaky: true,
      reason: second.pass
        ? '同一串输入两遍跑出来的值不一样（常见原因：工程里调了 randomize()、按真实时间计时、读了存档）'
        : `第二遍没过：${second.failures.join('；')}`
    }
  }
  return { ok: true, result: first }
}

export interface RegressionReport {
  tree: string
  results: Array<CaseResult & { cached: boolean }>
  passed: number
  failed: number
}

export async function runRegression(
  exec: ReplayExecutor,
  store: RegressionStore,
  cases: RegressionCase[],
  tree: string,
  options: { signal?: AbortSignal; onProgress?: (text: string) => void } = {}
): Promise<RegressionReport> {
  const results: RegressionReport['results'] = []
  for (const [i, c] of cases.entries()) {
    options.signal?.throwIfAborted()
    const key = caseKey(c)
    const cached = await store.cachedResult<CaseResult>(tree, key)
    if (cached) {
      results.push({ ...cached, cached: true })
      continue
    }
    options.onProgress?.(`回归 ${i + 1}/${cases.length}：${c.title}`)
    const result = await runCase(exec, c, options.signal)
    await store.cacheResult(tree, key, result)
    results.push({ ...result, cached: false })
  }
  const passed = results.filter((r) => r.pass).length
  return { tree, results, passed, failed: results.length - passed }
}

/** 给模型看的：一行汇总 + 每条失败。不带采样表，免得撑大调用方的上下文 */
export function formatReport(report: RegressionReport, titles: Map<string, string>): string {
  if (report.results.length === 0) return '没有可跑的回放用例。'
  const fresh = report.results.filter((r) => !r.cached).length
  const head = `回放回归：${report.passed} 过 / ${report.failed} 不过（共 ${report.results.length} 条，${fresh} 条新跑，其余工程没变直接用上次结果）`
  const fails = report.results
    .filter((r) => !r.pass)
    .map((r) => `- ${r.id} ${titles.get(r.id) ?? ''}\n  ${r.failures.join('\n  ')}`)
  return [head, ...fails].join('\n')
}
