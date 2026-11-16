/** @vitest-environment node */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { admit, weakest } from './admission'
import type { ExperienceEntry } from './experienceFile'
import { applyOutcome, emptyStats } from './lifecycle'
import { ExperienceStore } from './store'
import { repairLayer } from './upkeep'

const entry = (id: string): ExperienceEntry => ({
  id,
  title: id,
  tool: 'godot_headless_check',
  errorPattern: 'Parse Error',
  advice: 'Fix the script and check again',
  expect: {},
  source: '',
  status: 'trial'
})
const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('通用经验规则保留 Godot 记录', () => {
  it('同一工具超过五条仍保留已有经验，容量淘汰优先选出过场但没有成功的条目', () => {
    const before = Array.from({ length: 6 }, (_, i) => entry(String(i)))
    const all = admit(before, entry('new'))
    expect(all).toHaveLength(7)
    expect(all.every((e) => e.status === 'trial')).toBe(true)
    expect(weakest(all, { '1': { ...emptyStats(), shown: 1 } })?.id).toBe('1')
    expect(weakest([{ ...entry('pinned'), pinned: true }, entry('other')], {})?.id).toBe('other')
  })

  it('退休写出证据原因，钉住的经验不退休', () => {
    const stats = { ...emptyStats(), adoptedFail: 1 }
    const outcome = { arm: 'shown' as const, adopted: true, ok: false }
    expect(applyOutcome(entry('failed'), stats, outcome)).toMatchObject({
      status: 'retired',
      retiredBecause: 'failed'
    })
    expect(applyOutcome({ ...entry('pinned'), pinned: true }, stats, outcome).status).toBe('trial')
    expect(
      applyOutcome(
        entry('ignored'),
        { ...emptyStats(), ignoredStreak: 4 },
        { ...outcome, adopted: false }
      )
    ).toMatchObject({ retiredBecause: 'ignored' })
  })

  it('只恢复没有原因、从未出场的旧退休记录；重复维护不改动', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gdbox-upkeep-'))
    dirs.push(dir)
    const store = new ExperienceStore(dir)
    await store.updateTool('godot_headless_check', () => [
      { ...entry('old'), status: 'retired' },
      { ...entry('failed'), status: 'retired', retiredBecause: 'failed' },
      { ...entry('shown'), status: 'retired' },
      { ...entry('holdout'), status: 'retired' }
    ])
    await store.updateLedger(() => ({
      shown: { ...emptyStats(), shown: 1 },
      holdout: { ...emptyStats(), holdout: 1 }
    }))
    expect(await repairLayer(store)).toBe(1)
    expect((await store.readAll()).map((e) => [e.id, e.status])).toEqual([
      ['old', 'trial'],
      ['failed', 'retired'],
      ['shown', 'retired'],
      ['holdout', 'retired']
    ])
    expect(await repairLayer(store)).toBe(0)
  })
})
