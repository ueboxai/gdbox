import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { acquire, forceReleaseAll } from '../core/assetLock'
import { fileLockFor, fileLockForCall, needsEditorKey } from './godotLocks'

let root: string
let project: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'gdbox-locks-'))
  project = join(root, 'game')
  mkdirSync(join(project, 'scripts'), { recursive: true })
  writeFileSync(join(project, 'project.godot'), 'config_version=5')
  forceReleaseAll()
})
afterEach(() => {
  forceReleaseAll()
  rmSync(root, { recursive: true, force: true })
})

describe('文件锁锁哪一个', () => {
  it('工程里的文件按 res:// 锁，归属是工程目录', () => {
    expect(fileLockFor(join(project, 'scripts', 'player.gd'))).toEqual({
      projectDir: project,
      resPath: 'res://scripts/player.gd'
    })
  })

  it('工程外的文件、编辑器缓存、盒子数据、相对路径都不锁', () => {
    expect(fileLockFor(join(root, 'notes.md'))).toBeNull()
    expect(fileLockFor(join(project, '.godot', 'x.cfg'))).toBeNull()
    expect(fileLockFor(join(project, '.gdbox', 'tmp', 'a.png'))).toBeNull()
    expect(fileLockFor('scripts/player.gd')).toBeNull()
    expect(fileLockFor(undefined)).toBeNull()
  })

  it('只有写文件的工具才锁', () => {
    const path = join(project, 'main.tscn')
    expect(fileLockForCall('write_local_file', { path })?.resPath).toBe('res://main.tscn')
    expect(fileLockForCall('edit_local_file', { path })?.resPath).toBe('res://main.tscn')
    expect(fileLockForCall('read_local_file', { path })).toBeNull()
  })

  it('同名不同扩展名是两个文件，不互相挡', () => {
    expect(acquire(project, 'a', ['res://player.gd']).ok).toBe(true)
    expect(acquire(project, 'b', ['res://player.tscn']).ok).toBe(true)
    expect(acquire(project, 'b', ['res://player.gd']).ok).toBe(false)
    // 另一个工程里的同名文件不相干
    expect(acquire(join(root, 'other'), 'b', ['res://player.gd']).ok).toBe(true)
  })
})

describe('编辑器钥匙', () => {
  it('只套编辑器里会改状态的工具', () => {
    expect(needsEditorKey({ namespace: 'godot.editor', risk: 'mutating' })).toBe(true)
    expect(needsEditorKey({ namespace: 'godot.editor', risk: 'safe' })).toBe(false)
    expect(needsEditorKey({ namespace: 'godot', risk: 'mutating' })).toBe(false)
  })
})
