import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { markImported, needsImport } from './importState'

describe('needsImport', () => {
  it('没导入过要导入；导入后没改不用；之后有新文件（比如生成的图）又要导入', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gdbox-imp-'))
    writeFileSync(join(dir, 'project.godot'), 'config_version=5\n')
    const old = new Date(Date.now() - 60_000)
    utimesSync(join(dir, 'project.godot'), old, old)
    expect(needsImport(dir)).toBe(true)
    markImported(dir)
    expect(needsImport(dir)).toBe(false)
    // 让新文件的时间明确晚于标记
    const later = new Date(Date.now() + 5000)
    mkdirSync(join(dir, 'assets', 'gen', 'sprites'), { recursive: true })
    writeFileSync(join(dir, 'assets', 'gen', 'sprites', 'fox.png'), 'x')
    utimesSync(join(dir, 'assets', 'gen', 'sprites', 'fox.png'), later, later)
    expect(needsImport(dir)).toBe(true)
  })

  it('导入进行中写进来的文件下次还会导入；导入自己写的旁挂文件不算', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gdbox-imp-'))
    writeFileSync(join(dir, 'project.godot'), 'config_version=5\n')
    const old = new Date(Date.now() - 60_000)
    utimesSync(join(dir, 'project.godot'), old, old)
    const startedAt = Date.now() - 10_000
    // 导入跑到一半，队友写进来一张图
    const during = new Date(startedAt + 5_000)
    writeFileSync(join(dir, 'bomb.png'), 'x')
    utimesSync(join(dir, 'bomb.png'), during, during)
    markImported(dir, startedAt)
    expect(needsImport(dir)).toBe(true)

    // 旁挂文件比标记新，不触发
    const dir2 = mkdtempSync(join(tmpdir(), 'gdbox-imp-'))
    writeFileSync(join(dir2, 'project.godot'), 'config_version=5\n')
    utimesSync(join(dir2, 'project.godot'), old, old)
    markImported(dir2, Date.now() - 10_000)
    writeFileSync(join(dir2, 'hero.png.import'), 'x')
    writeFileSync(join(dir2, 'player.gd.uid'), 'x')
    expect(needsImport(dir2)).toBe(false)
  })

  it('.gdbox 和带 .gdignore 的目录里的改动不触发导入', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gdbox-imp-'))
    writeFileSync(join(dir, 'project.godot'), 'config_version=5\n')
    const old = new Date(Date.now() - 60_000)
    utimesSync(join(dir, 'project.godot'), old, old)
    markImported(dir)
    mkdirSync(join(dir, '.gdbox'))
    writeFileSync(join(dir, '.gdbox', 'generations.jsonl'), '{}')
    mkdirSync(join(dir, 'docs'))
    writeFileSync(join(dir, 'docs', '.gdignore'), '')
    writeFileSync(join(dir, 'docs', 'notes.md'), 'x')
    expect(needsImport(dir)).toBe(false)
  })
})
