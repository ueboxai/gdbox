import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const target = vi.hoisted(() => ({ path: undefined as string | undefined }))
vi.mock('../projectTargetContext', () => ({ getWorkingProjectPath: () => target.path }))

import { acquire, forceReleaseAll } from '../assetLock'
import { categorize, contentInventory, formatCounts } from './inventory'
import { createTeamLive } from './teamLive'
import { buildTeamStatus } from './teamStatus'
import { createTeamStore, PRODUCER, type TeamStore } from './teamStore'
import { createMessageTool } from './teamTools'

/**
 * 2026-09-26 真机反馈「多 Agent 协作对不齐真相」：制作人、两个队员各说一版现状，
 * 任务板备注过期，给空闲队员发留言当派活。这里量盒子给出的「不看视角的现状」。
 */

let dir: string
let store: TeamStore

function touch(rel: string, at: number): void {
  const full = join(dir, 'proj', rel)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, '')
  utimesSync(full, at / 1000, at / 1000)
}

const textOf = (out: { content: Array<{ type: string; text?: string }> }): string =>
  out.content.map((c) => c.text ?? '').join('')

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'team-status-'))
  store = createTeamStore({ stateDir: join(dir, 'state'), workspaceDir: join(dir, 'ws') })
  await store.ensure()
  forceReleaseAll()
  target.path = undefined
})
afterEach(() => {
  forceReleaseAll()
  rmSync(dir, { recursive: true, force: true })
})

describe('磁盘清点', () => {
  it('按扩展名分类', () => {
    expect(categorize('main.tscn')).toBe('场景')
    expect(categorize('player.gd')).toBe('脚本')
    expect(categorize('water.gdshader')).toBe('着色器')
    expect(categorize('hero_frames.tres')).toBe('资源')
    expect(categorize('hero.png')).toBe('图片')
    expect(categorize('jump.wav')).toBe('音频')
    expect(categorize('Whatever.bin')).toBe('其他')
  })

  it('数工程里的文件，跳过旁挂文件、编辑器缓存、盒子数据和我们的插件；最近改的在前', async () => {
    touch('scripts/player.gd', 1_000_000)
    touch('ui/hud.tscn', 3_000_000)
    touch('main.tscn', 2_000_000)
    touch('main.tscn.uid', 6_000_000)
    touch('art/hero.png.import', 6_000_000)
    touch('project.godot', 6_000_000)
    touch('.godot/imported/x.ctex', 4_000_000)
    touch('.gdbox/tmp/shot.png', 4_000_000)
    touch('addons/gdbox_link/plugin.cfg', 4_000_000)
    touch('raw/.gdignore', 4_000_000)
    touch('raw/huge.psd', 4_000_000)
    const inventory = await contentInventory(join(dir, 'proj'))
    expect(inventory.total).toBe(3)
    expect(inventory.recent.map((i) => i.path)).toEqual([
      'res://ui/hud.tscn',
      'res://main.tscn',
      'res://scripts/player.gd'
    ])
    expect(formatCounts(inventory)).toMatch(/^共 3 · 场景 2/)
  })

  it('工程目录不存在也不报错', async () => {
    expect((await contentInventory(join(dir, 'nope'))).total).toBe(0)
  })
})

describe('team_status', () => {
  it('一次说全：磁盘、谁在干什么、谁占着锁、最近改动、过期任务', async () => {
    target.path = join(dir, 'proj')
    touch('scripts/game_mode.gd', Date.now() - 2 * 60_000)
    await store.putMember({
      name: '美术',
      persona: 'a',
      tier: 'strong',
      readOnly: false,
      hiredAt: 1
    })
    await store.putMember({
      name: '程序',
      persona: 'b',
      tier: 'strong',
      readOnly: false,
      hiredAt: 2
    })
    const live = createTeamLive(store)
    live.setAssignment('程序', '做炮塔的开火逻辑\n细节……')
    acquire(join(dir, 'proj'), 's1:mate-程序', ['res://scripts/game_mode.gd'])
    acquire(join(dir, 'proj'), 'other-session', ['res://other.gd'])
    await store.recordActivity({ who: '美术', what: '做三张材质', writes: 'material_create ×3' })
    await store.patchBoard([{ id: 't1', title: 'HUD', owner: '美术', status: 'doing' }])

    const text = await buildTeamStatus({
      store,
      live,
      sessionId: 's1',
      now: () => Date.now() + 30 * 60_000
    })
    expect(text).toContain('共 1')
    expect(text).toContain('res://scripts/game_mode.gd')
    expect(text).toMatch(/程序：在干「做炮塔的开火逻辑」/)
    expect(text).toMatch(/美术：空闲（要它干活用 team_send）/)
    expect(text).toMatch(/game_mode\.gd.*← .*程序/)
    expect(text).toContain('另有 1 个文件被盒子里别的对话占着')
    expect(text).toMatch(/美术「做三张材质」：material_create ×3/)
    expect(text).toMatch(/很久没更新[\s\S]*t1 HUD @美术/)
  })

  it('没连工程也能出，说清没有工程', async () => {
    const text = await buildTeamStatus({ store, sessionId: 's1' })
    expect(text).toContain('这条对话还没有归属工程')
    expect(text).toContain('团队里没人占着文件')
  })

  it('最近改动只留最近的', async () => {
    // 先铺 200 条，再真记 5 条越过上限。一条一条记 205 次是 205 轮整文件读写，
    // CI 的 Windows 机器上会超 10 秒
    mkdirSync(join(dir, 'state'), { recursive: true })
    const seeded = Array.from({ length: 200 }, (_, i) => ({
      who: 'x',
      what: `${i}`,
      writes: '',
      at: i
    }))
    writeFileSync(join(dir, 'state', 'activity.json'), JSON.stringify(seeded))
    for (let i = 200; i < 205; i++)
      await store.recordActivity({ who: 'x', what: `${i}`, writes: '' })
    const all = await store.activity(1000)
    expect(all).toHaveLength(200)
    expect(all.at(-1)?.what).toBe('204')
    expect(await store.activity(3)).toHaveLength(3)
  })
})

describe('留言不是派活', () => {
  it('制作人给空闲队员留言：提醒这不会让它开工', async () => {
    await store.putMember({
      name: '美术',
      persona: 'a',
      tier: 'strong',
      readOnly: false,
      hiredAt: 1
    })
    const live = createTeamLive(store)
    const out = await createMessageTool(store, PRODUCER, live).execute('c', {
      to: '美术',
      text: '去做 HUD'
    } as never)
    expect(textOf(out)).toMatch(/美术 现在空闲.*team_send/)
  })

  it('对方在干活时插话，或队员之间留言：不提醒', async () => {
    await store.putMember({
      name: '美术',
      persona: 'a',
      tier: 'strong',
      readOnly: false,
      hiredAt: 1
    })
    await store.putMember({
      name: '程序',
      persona: 'b',
      tier: 'strong',
      readOnly: false,
      hiredAt: 2
    })
    const live = createTeamLive(store)
    live.attach('美术', { steer: () => undefined })
    const fromProducer = await createMessageTool(store, PRODUCER, live).execute('c', {
      to: '美术',
      text: '顺便改下颜色'
    } as never)
    const fromMate = await createMessageTool(store, '美术', live).execute('c', {
      to: '程序',
      text: '材质好了'
    } as never)
    expect(textOf(fromProducer)).not.toContain('空闲')
    expect(textOf(fromMate)).not.toContain('空闲')
  })
})
