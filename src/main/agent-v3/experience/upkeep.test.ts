/**
 * 修旧账（upkeep.ts）和进门不再按工具限条数（admission.ts）。旧账的形状照上游用户本机
 * 2026-10-15 的真实情况造：被容量挤掉的经验一次没出过场、没有退休原因。
 */

import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { admit, MAX_RETIRED_PER_TOOL } from './admission'
import type { ExperienceEntry } from './experienceFile'
import { emptyStats } from './lifecycle'
import { ExperienceStore } from './store'
import { repairLayer } from './upkeep'

const TOOL = 'godot_check'

function lesson(id: string, over: Partial<ExperienceEntry> = {}): ExperienceEntry {
  return {
    id,
    title: id,
    tool: TOOL,
    errorPattern: `could not find type "${id}kinematicbody2d"`,
    advice: 'a',
    expect: { param: 'path' },
    source: '2026-10-06 · session x · failed 1x, then succeeded',
    status: 'trial',
    ...over
  }
}

let root: string
let store: ExperienceStore
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'exp-upkeep-'))
  store = new ExperienceStore(join(root, 'home'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function byId(): Promise<Record<string, ExperienceEntry>> {
  return Object.fromEntries((await store.readTool(TOOL)).map((e) => [e.id, e]))
}

describe('修旧账', () => {
  it('没原因、一次没出过场的退休经验是被容量挤掉的，放回试用；出过场的和有原因的不动', async () => {
    await store.updateTool(TOOL, () => [
      lesson('squeezed', { status: 'retired' }),
      lesson('earned', { status: 'retired' }),
      lesson('failed', { status: 'retired', retiredBecause: 'failed' })
    ])
    await store.updateLedger(() => ({ earned: { ...emptyStats(), shown: 3, adoptedFail: 2 } }))

    expect(await repairLayer(store)).toBe(1)
    const entries = await byId()
    expect(entries.squeezed.status).toBe('trial')
    expect(entries.earned.status).toBe('retired')
    expect(entries.failed).toMatchObject({ status: 'retired', retiredBecause: 'failed' })
    // 幂等
    expect(await repairLayer(store)).toBe(0)
  })
})

describe('进门', () => {
  it('不再按工具限条数：第 6 条进门不挤任何一条', () => {
    const five = ['a', 'b', 'c', 'd', 'e'].map((id) => lesson(id))
    const next = admit(five, lesson('f'))!
    expect(next.filter((e) => e.status !== 'retired')).toHaveLength(6)
  })

  it('已退休的只留最近几条', () => {
    const retired = Array.from({ length: MAX_RETIRED_PER_TOOL + 1 }, (_, i) =>
      lesson(`r${i}`, { status: 'retired' as const })
    )
    const next = admit(retired, lesson('n'))!
    expect(next.filter((e) => e.status === 'retired')).toHaveLength(MAX_RETIRED_PER_TOOL)
    expect(next.some((e) => e.id === 'r0')).toBe(false)
  })
})
