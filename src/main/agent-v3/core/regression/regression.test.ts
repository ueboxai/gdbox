import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { evaluateAsserts, parseWatchSamples, seriesFingerprint } from './assert'
import { decidePromotion } from './champion'
import { runMachineGate, settleChampion, type GateDeps } from './gate'
import { admitCase, runCase, runRegression, type ReplayExecutor } from './runner'
import { createRegressionStore, type RegressionStore } from './store'
import type { ChampionEntry, RegressionAssert, RegressionCase } from './types'

const watch = (t: number, v: Record<string, string>): string =>
  `GDBOX_WATCH ${JSON.stringify({ t, v })}`
const samples = parseWatchSamples([
  'GDBOX_START scene=x',
  watch(0, { x: '0', room: '"ch01_01"' }),
  watch(0.5, { x: '40.5', room: '"ch01_01"' }),
  watch(1, { x: '96', room: '"ch01_02"' }),
  'GDBOX_WATCH {broken',
  'GDBOX_END'
])
const a = (over: Partial<RegressionAssert>): RegressionAssert => ({
  expr: 'x',
  op: '>=',
  value: 0,
  when: 'final',
  ...over
})

describe('断言求值', () => {
  it('四种 when、容差、字符串去引号', () => {
    const out = evaluateAsserts(
      [
        a({ op: '==', value: 96 }),
        a({ op: '==', value: 40, when: { at: 0.4 }, tol: 1 }),
        a({ op: '==', value: 40, when: { at: 0.4 } }),
        a({ expr: 'room', op: '==', value: 'ch01_02', when: 'ever' }),
        a({ op: '<', value: 100, when: 'always' }),
        a({ op: '<', value: 50, when: 'always' }),
        a({ expr: 'missing' })
      ],
      samples
    )
    expect(out.map((o) => o.pass)).toEqual([true, true, false, true, true, false, false])
    expect(out[5]).toMatchObject({ actual: '96', at: 1 })
    expect(out[6]!.actual).toBe('<没有采到>')
  })

  it('非数值只比相等', () => {
    expect(evaluateAsserts([a({ expr: 'room', op: '>', value: 'a' })], samples)[0]!.pass).toBe(
      false
    )
  })

  it('指纹只看断言用到的值', () => {
    const other = parseWatchSamples([
      watch(0, { x: '0', noise: '1' }),
      watch(1, { x: '96', noise: '2' })
    ])
    const same = parseWatchSamples([
      watch(0, { x: '0', noise: '9' }),
      watch(1, { x: '96', noise: '9' })
    ])
    expect(seriesFingerprint([a({})], other)).toBe(seriesFingerprint([a({})], same))
  })
})

const ok = (x: string): string[] => [watch(0, { x: '0' }), watch(1, { x }), 'GDBOX_END']
const exec = (
  outputs: Array<Partial<Awaited<ReturnType<ReplayExecutor>>>>
): ReplayExecutor & { calls: number } => {
  const fn = (async () => {
    const out = outputs[Math.min(fn.calls++, outputs.length - 1)]!
    return { lines: [], timedOut: false, errors: [], ...out }
  }) as unknown as ReplayExecutor & { calls: number }
  fn.calls = 0
  return fn
}
const draft = {
  id: 'draft',
  scene: '',
  seconds: 1,
  seed: 1,
  inputs: [],
  watch: [],
  asserts: [a({ op: '>=', value: 90 })]
}

describe('跑一条用例 / 入库', () => {
  it('隐含断言：崩溃、超时、报错、按键动作不存在', async () => {
    expect((await runCase(exec([{ lines: [watch(0, { x: '99' })] }]), draft)).failures).toContain(
      '中途结束（崩溃或退出）'
    )
    expect((await runCase(exec([{ lines: ok('99'), timedOut: true }]), draft)).failures).toContain(
      '超时没跑完'
    )
    const r = await runCase(
      exec([
        { lines: [...ok('99'), 'GDBOX_WARN unknown input action dash'], errors: ['E 1\nat x'] }
      ]),
      draft
    )
    expect(r.failures).toEqual(['按键动作不存在：dash', '运行中有 1 条报错：E 1'])
  })

  it('点击目标找不到、NaN 探针判不过；飞出世界只报不判', async () => {
    const probe = (kind: string): string =>
      `GDBOX_PROBE ${JSON.stringify({ t: 0.4, kind, node: 'Hero', prop: 'velocity', value: 'Vector2(nan, 0)' })}`
    const r = await runCase(
      exec([
        {
          lines: [
            ...ok('99'),
            'GDBOX_WARN click target not found UI/Start',
            'GDBOX_WARN unknown key Nope',
            probe('nan'),
            probe('far')
          ]
        }
      ]),
      draft
    )
    expect(r.failures).toEqual([
      '按键名不认识：Nope',
      '点击目标找不到：UI/Start',
      '0.4s Hero.velocity 成了 Vector2(nan, 0)（数值算爆了）'
    ])
  })

  it('changed() 第一次采样没有值，判定跳过那一次', () => {
    const s = parseWatchSamples([watch(0, {}), watch(0.1, { 'changed(@a:position)': '0.8' })])
    expect(
      evaluateAsserts(
        [a({ expr: 'changed(@a:position)', op: '>', value: 0.5, when: 'always' })],
        s
      )[0]!.pass
    ).toBe(true)
  })

  it('断言用到的值自动补进 watch', async () => {
    let seen: string[] = []
    await runCase(async (config) => {
      seen = config.watch
      return { lines: ok('99'), timedOut: false, errors: [] }
    }, draft)
    expect(seen).toEqual(['x'])
  })

  it('两遍都过且一致才收；第一遍不过拒收；两遍不一致标不稳定', async () => {
    expect(await admitCase(exec([{ lines: ok('99') }]), draft)).toMatchObject({ ok: true })
    expect(await admitCase(exec([{ lines: ok('10') }]), draft)).toMatchObject({
      ok: false,
      flaky: false
    })
    expect(await admitCase(exec([{ lines: ok('99') }, { lines: ok('95') }]), draft)).toMatchObject({
      ok: false,
      flaky: true
    })
  })
})

describe('用例库、回归缓存、机器门与冠军', () => {
  let dir: string
  let store: RegressionStore
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'regression-'))
    store = createRegressionStore(dir, 'H:/Game')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const add = (over: Partial<RegressionCase> = {}): Promise<RegressionCase> =>
    store.add({ ...draft, title: 't', origin: { by: 'agent', at: 0 }, ...over })

  it('编号递增；锁定只动候选；退役留档；被改的文件报出来', async () => {
    const c1 = await add()
    const c2 = await add({ status: 'flaky' })
    expect([c1.id, c2.id]).toEqual(['c0001', 'c0002'])
    await store.lock(['c0001', 'c0002'], 5)
    const { cases } = await store.list()
    expect(cases.map((c) => c.status)).toEqual(['locked', 'flaky'])
    await store.retire('c0001', 'producer', '玩法改了', 6)
    await expect(store.retire('c0001', 'producer', 'x', 7)).rejects.toThrow('已经退役')

    writeFileSync(join(dir, 'cases', 'c0002.json'), JSON.stringify({ ...c2, asserts: [] }))
    rmSync(join(dir, 'cases', 'c0001.json'))
    expect((await store.list()).tampered.sort()).toEqual(['c0001', 'c0002'])
  })

  it('同一个 tree 不重跑', async () => {
    const c = await add()
    const run = exec([{ lines: ok('99') }])
    await runRegression(run, store, [c], 'tree1')
    const again = await runRegression(run, store, [c], 'tree1')
    expect(run.calls).toBe(1)
    expect(again.results[0]!.cached).toBe(true)
    await runRegression(run, store, [c], 'tree2')
    expect(run.calls).toBe(2)
  })

  function gateDeps(
    run: ReplayExecutor,
    trees: { head: string; work: string }
  ): GateDeps & {
    pinned: string[]
  } {
    const pinned: string[] = []
    return {
      store,
      exec: run,
      check: async () => [],
      now: () => 100,
      pinned,
      snapshots: {
        save: async () => null,
        head: async () => ({ commit: `commit-${trees.head}`, tree: trees.head }),
        workTree: async () => trees.work,
        pinChampion: async (commit) => void pinned.push(commit)
      }
    }
  }

  it('锁定用例不过：机器门拦下；候选不过不拦', async () => {
    await add()
    await add()
    await store.lock(['c0001'], 1)
    const failing = exec([{ lines: ok('10') }])
    const gate = await runMachineGate(gateDeps(failing, { head: 't1', work: 't1' }))
    expect(gate.blocked).toBe(true)
    expect(gate.lockedFailures).toEqual(['c0001'])

    await store.retire('c0001', 'producer', '改了', 2)
    const gate2 = await runMachineGate(gateDeps(failing, { head: 't2', work: 't2' }))
    expect(gate2.blocked).toBe(false)
  })

  it('PASS 晋升：记冠军、锁通过的候选、钉快照；验收后又改过就不晋升', async () => {
    await add()
    const deps = gateDeps(exec([{ lines: ok('99') }]), { head: 't1', work: 't1' })
    const gate = await runMachineGate(deps)
    const pass = { kind: 'pass' as const, reason: '玩通了' }
    const { promoted, text } = await settleChampion(deps, gate, pass)
    expect(promoted?.commit).toBe('commit-t1')
    expect(text).toContain('新锁定 1 条')
    expect(deps.pinned).toEqual(['commit-t1'])
    expect((await store.list()).cases[0]!.status).toBe('locked')
    expect((await store.champion()).history).toHaveLength(1)

    const moved = gateDeps(exec([{ lines: ok('99') }]), { head: 't2', work: 't3' })
    const g2 = await runMachineGate(moved)
    const r2 = await settleChampion(moved, g2, pass)
    expect(r2.promoted).toBeNull()
    expect(r2.text).toContain('验收期间工程又被改过')
    expect((await store.champion()).current?.tree).toBe('t1')
  })
})

describe('晋升四条', () => {
  const base = {
    checkErrors: 0,
    lockedFailures: [],
    verdict: { kind: 'pass' as const, reason: '' },
    deliveredTree: 't',
    currentTree: 't',
    passedCases: 3,
    current: null
  }
  const champ = { tree: 'old', passedCases: 3 } as ChampionEntry
  it('逐条拦', () => {
    expect(decidePromotion(base)).toEqual({ promote: true })
    expect(decidePromotion({ ...base, checkErrors: 1 }).promote).toBe(false)
    expect(decidePromotion({ ...base, lockedFailures: ['c1'] }).promote).toBe(false)
    expect(decidePromotion({ ...base, verdict: { kind: 'fail', reason: '' } }).promote).toBe(false)
    expect(decidePromotion({ ...base, currentTree: 'x' }).promote).toBe(false)
    expect(decidePromotion({ ...base, current: champ, passedCases: 2 }).promote).toBe(false)
    expect(decidePromotion({ ...base, current: champ })).toEqual({ promote: true })
    expect(decidePromotion({ ...base, current: { ...champ, tree: 't' } }).promote).toBe(false)
  })
})
