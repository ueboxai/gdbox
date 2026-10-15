/** @vitest-environment node */
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createSnapshotStore, snapshotMessage, type GitRunner } from './snapshots'

/**
 * 用真 git 跑：快照要证明的是「退回去之后磁盘上真的是那一份」，打桩证明不了。
 * 这台机器没有 git 就整组跳过。真 git 在 Windows 上一条命令几十到几百毫秒，
 * 一条用例要跑十几条，机器忙时轻松超过默认的 10 秒，所以整组放宽到 60 秒。
 */

const git: GitRunner = (args, cwd) =>
  new Promise((resolve) => {
    execFile('git', args, { cwd, windowsHide: true }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0
      resolve({ code, stdout: String(stdout), stderr: String(stderr) })
    })
  })

const hasGit = await git(['--version'], tmpdir()).then((r) => r.code === 0)

describe.skipIf(!hasGit)('工程快照', { timeout: 60_000 }, () => {
  let project: string
  const write = (rel: string, text: string): void => {
    const full = join(project, rel)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, text)
  }
  const read = (rel: string): string => readFileSync(join(project, rel), 'utf8')

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), 'gdbox-snap-'))
    write('project.godot', 'config_version=5')
    write('scenes/main.tscn', 'v1')
    write('scripts/player.gd', 'extends Node')
    write('.godot/imported/icon.png-abc.ctex', 'cache')
    write('.godot/editor/filesystem_cache8', 'cache')
  })
  afterEach(() => rmSync(project, { recursive: true, force: true }))

  it('存、没变化就不存、改了再存；只收源文件，不碰工程自己的 git', async () => {
    const store = createSnapshotStore(project, git)
    const first = await store.save('开工')
    // 标签说清「这一份里是什么」：谁触发的、改了几个文件
    expect(first?.message).toBe('开工｜新增 3｜共 2 · 场景 1 · 脚本 1')
    expect(await store.save('什么都没改')).toBeNull()

    write('scenes/main.tscn', 'v2')
    const second = await store.save(snapshotMessage('地编', '改关卡\n细节…'))
    expect(second?.message).toBe('地编：改关卡｜修改 1｜共 2 · 场景 1 · 脚本 1')
    expect((await store.list()).map((s) => s.message.split('｜')[0])).toEqual([
      '地编：改关卡',
      '开工'
    ])

    // 工程根目录下没有冒出一个 .git
    expect(existsSync(join(project, '.git'))).toBe(false)
    const tracked = await git(
      [`--git-dir=${join(project, '.gdbox', 'snapshots', '.git')}`, 'ls-files'],
      project
    )
    // .godot/ 缓存和快照仓库自己都不进快照
    expect(tracked.stdout.split('\n').filter(Boolean).sort()).toEqual([
      'project.godot',
      'scenes/main.tscn',
      'scripts/player.gd'
    ])
  })

  it('退回去：改过的恢复、新建的删掉、.godot 缓存原样留着', async () => {
    const store = createSnapshotStore(project, git)
    const first = await store.save('开工')
    write('scenes/main.tscn', 'broken')
    write('scenes/hero.tscn', 'new')
    write('.godot/editor/filesystem_cache8', 'later cache')
    await store.save('改坏了')

    await store.restore(first!.id)
    expect(read('scenes/main.tscn')).toBe('v1')
    expect(existsSync(join(project, 'scenes/hero.tscn'))).toBe(false)
    expect(read('.godot/editor/filesystem_cache8')).toBe('later cache')
    expect(read('.godot/imported/icon.png-abc.ctex')).toBe('cache')
  })

  it('退回之后还能反悔：之后的快照都还在，再退回去一次就回来了', async () => {
    const store = createSnapshotStore(project, git)
    const first = await store.save('开工')
    write('scenes/hero.tscn', 'new')
    const later = await store.save('加了英雄')

    const restored = await store.restore(first!.id)
    expect(existsSync(join(project, 'scenes/hero.tscn'))).toBe(false)
    expect(restored?.message).toContain('退回快照')
    // 退回是叠上去的一份，之前那份还在列表里
    expect((await store.list()).map((s) => s.id)).toContain(later!.id)

    await store.restore(later!.id)
    expect(read('scenes/hero.tscn')).toBe('new')
  })

  it('编号对不上任何一份就报错 —— 回滚前用它确认，不白关编辑器', async () => {
    const store = createSnapshotStore(project, git)
    const first = await store.save('开工')
    expect(await store.resolve(first!.id)).toMatch(/^[0-9a-f]{40}$/)
    await expect(store.resolve('abc')).rejects.toThrow(/编号不对/)
    await expect(store.resolve('deadbeef')).rejects.toThrow(/没有快照/)
  })

  it('几个队员同时交活，一起存快照不会撞 git 的锁', async () => {
    const store = createSnapshotStore(project, git)
    await store.save('开工')
    write('scenes/a.tscn', 'a')
    write('scenes/b.tscn', 'b')
    const results = await Promise.all([store.save('甲'), store.save('乙'), store.save('丙')])
    expect(results.filter(Boolean).length).toBeGreaterThanOrEqual(1)
  })

  it('快照编号不像编号就拒绝，不拿它拼命令', async () => {
    const store = createSnapshotStore(project, git)
    await store.save('开工')
    await expect(store.restore('HEAD; rm -rf /')).rejects.toThrow(/编号不对/)
  })
})
