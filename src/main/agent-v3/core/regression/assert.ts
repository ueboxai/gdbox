/**
 * 断言求值：拿运行器打出来的 `GDBOX_WATCH` 原始采样，判每条断言过没过。
 *
 * 判定放在 TS 这一侧、不放进 `gdbox_run.gd`：运行器只观察不判断，`godot_run` 和回放共用
 * 一个运行器；判定逻辑能单测，不用起 Godot。
 */

import { createHash } from 'crypto'

import type { AssertOutcome, RegressionAssert } from './types'

export interface WatchSample {
  t: number
  v: Record<string, string>
}

export function parseWatchSamples(lines: string[]): WatchSample[] {
  const out: WatchSample[] = []
  for (const line of lines) {
    if (!line.startsWith('GDBOX_WATCH ')) continue
    try {
      out.push(JSON.parse(line.slice('GDBOX_WATCH '.length)) as WatchSample)
    } catch {
      // 一行被别的输出截断了：跳过，不让整次判定失败
    }
  }
  return out
}

/** 运行器的自动探针：坐标或速度成了 NaN/inf（`nan`），物体飞到几百万像素外（`far`） */
export interface ProbeHit {
  t: number
  kind: 'nan' | 'far'
  node: string
  prop: string
  value: string
}

export function parseProbes(lines: string[]): ProbeHit[] {
  const out: ProbeHit[] = []
  for (const line of lines) {
    if (!line.startsWith('GDBOX_PROBE ')) continue
    try {
      out.push(JSON.parse(line.slice('GDBOX_PROBE '.length)) as ProbeHit)
    } catch {
      // 同 parseWatchSamples
    }
  }
  return out
}

export function describeProbe(p: ProbeHit): string {
  return p.kind === 'nan'
    ? `${p.t}s ${p.node}.${p.prop} 成了 ${p.value}（数值算爆了）`
    : `${p.t}s ${p.node}.${p.prop} = ${p.value}（飞出世界，没被回收）`
}

/** 断言里用到、但 watch 里没有的表达式：入库前就该拒 */
export function missingWatches(asserts: RegressionAssert[], watch: string[]): string[] {
  return [...new Set(asserts.map((a) => a.expr))].filter((e) => !watch.includes(e))
}

function asNumber(text: string): number | null {
  if (!/^\s*-?\d+(\.\d+)?([eE][-+]?\d+)?\s*$/.test(text)) return null
  return Number(text)
}

function compare(actual: string, a: RegressionAssert): boolean {
  const tol = a.tol ?? 0
  const want = String(a.value)
  const x = asNumber(actual)
  const y = asNumber(want)
  if (x !== null && y !== null) {
    switch (a.op) {
      case '==':
        return Math.abs(x - y) <= tol
      case '!=':
        return Math.abs(x - y) > tol
      case '<':
        return x < y + tol
      case '<=':
        return x <= y + tol
      case '>':
        return x > y - tol
      case '>=':
        return x >= y - tol
    }
  }
  // 不是数：只能比相等。字符串两边的引号（var_to_str 给 String 加的）去掉再比
  const norm = (s: string): string => s.trim().replace(/^"(.*)"$/, '$1')
  if (a.op === '==') return norm(actual) === norm(want)
  if (a.op === '!=') return norm(actual) !== norm(want)
  return false
}

export function evaluateAsserts(
  asserts: RegressionAssert[],
  samples: WatchSample[]
): AssertOutcome[] {
  return asserts.map((assert) => {
    const series = samples
      .filter((s) => assert.expr in s.v)
      .map((s) => ({ t: s.t, value: s.v[assert.expr]! }))
    if (series.length === 0) return { assert, pass: false, actual: '<没有采到>' }
    const when = assert.when
    if (when === 'final' || typeof when === 'object') {
      const pick =
        when === 'final'
          ? series[series.length - 1]!
          : series.reduce((best, s) =>
              Math.abs(s.t - when.at) < Math.abs(best.t - when.at) ? s : best
            )
      return { assert, pass: compare(pick.value, assert), actual: pick.value, at: pick.t }
    }
    if (when === 'ever') {
      const hit = series.find((s) => compare(s.value, assert))
      const last = series[series.length - 1]!
      return hit
        ? { assert, pass: true, actual: hit.value, at: hit.t }
        : { assert, pass: false, actual: last.value, at: last.t }
    }
    const miss = series.find((s) => !compare(s.value, assert))
    return miss
      ? { assert, pass: false, actual: miss.value, at: miss.t }
      : { assert, pass: true, actual: series[series.length - 1]!.value }
  })
}

export function describeAssert(a: RegressionAssert): string {
  const when =
    typeof a.when === 'object'
      ? `在 ${a.when.at}s`
      : { final: '结束时', ever: '某一刻', always: '始终' }[a.when]
  return `${when} ${a.expr} ${a.op} ${a.value}${a.tol ? `（±${a.tol}）` : ''}`
}

export function describeFailure(o: AssertOutcome): string {
  return `${describeAssert(o.assert)}：实际 ${o.actual ?? '?'}${o.at !== undefined ? `（${o.at}s）` : ''}`
}

/**
 * 断言涉及的那几个值的逐帧序列指纹。两遍跑出来不同 = 不确定，不进门禁。
 * 只比断言用到的值：watch 里其它看热闹的值（比如动画帧）不拿来判
 */
export function seriesFingerprint(asserts: RegressionAssert[], samples: WatchSample[]): string {
  const exprs = [...new Set(asserts.map((a) => a.expr))].sort()
  const hash = createHash('sha256')
  for (const s of samples) hash.update(`${s.t}|${exprs.map((e) => s.v[e] ?? '').join('|')}\n`)
  return hash.digest('hex').slice(0, 16)
}
