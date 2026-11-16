import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '', getPath: () => '' } }))

import {
  buildCheckReport,
  collectProjectScripts,
  summarizeLoadCheck,
  type LoadCheckResult
} from './runtime'

describe('脚本加载检查', () => {
  it('收集工程里的 .gd，跳过引擎缓存、带 .gdignore 的目录和装进来的编辑器插件', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gdbox-loadcheck-'))
    try {
      for (const d of [
        'src/enemies',
        'addons/gdUnit4',
        'addons/my_inventory',
        '.godot',
        '.gdbox/tmp',
        'raw'
      ]) {
        mkdirSync(join(dir, d), { recursive: true })
      }
      writeFileSync(join(dir, 'main.gd'), '')
      writeFileSync(join(dir, 'src/enemies/slime.gd'), '')
      writeFileSync(join(dir, 'src/enemies/slime.tscn'), '')
      writeFileSync(join(dir, 'addons/gdUnit4/plugin.cfg'), '')
      writeFileSync(join(dir, 'addons/gdUnit4/plugin.gd'), '')
      writeFileSync(join(dir, 'addons/my_inventory/inventory.gd'), '')
      writeFileSync(join(dir, '.godot/x.gd'), '')
      writeFileSync(join(dir, '.gdbox/tmp/run.gd'), '')
      writeFileSync(join(dir, 'raw/.gdignore'), '')
      writeFileSync(join(dir, 'raw/old.gd'), '')
      const scripts = await collectProjectScripts(dir)
      expect(scripts.map((s) => s.path)).toEqual([
        'res://addons/my_inventory/inventory.gd',
        'res://main.gd',
        'res://src/enemies/slime.gd'
      ])
      expect(scripts.every((s) => s.stamp !== '')).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('读不了的目录不让检查失败', async () => {
    expect(await collectProjectScripts(join(tmpdir(), 'gdbox-no-such-project'))).toEqual([])
  })

  it('从检查器输出里挑出坏脚本，去掉指向检查器的回溯和重复的 Failed to load', () => {
    // Godot 4.7.1 的真实输出
    const output = [
      'SCRIPT ERROR: Parse Error: Expected expression as the function argument.',
      '   at: GDScript::reload (res://src/enemy.gd:5)',
      '   GDScript backtrace (most recent call first):',
      '       [0] _initialize (res://.gdbox/tmp/check-1/gdbox_load_check.gd:27)',
      'ERROR: Failed to load script "res://src/enemy.gd" with error "Parse error".',
      '   at: load (modules/gdscript/gdscript_resource_format.cpp:46)',
      '   GDScript backtrace (most recent call first):',
      '       [0] _initialize (res://.gdbox/tmp/check-1/gdbox_load_check.gd:27)',
      'GDBOX_LOADFAIL res://src/enemy.gd',
      'GDBOX_LOADCHECK 3 1'
    ].join('\n')
    expect(summarizeLoadCheck(output)).toEqual({
      checked: 3,
      failed: ['res://src/enemy.gd'],
      errors: [
        'SCRIPT ERROR: Parse Error: Expected expression as the function argument.\nat: GDScript::reload (res://src/enemy.gd:5)'
      ]
    })
  })

  it('没有对应 SCRIPT ERROR 的 Failed to load 是唯一的原因，留着', () => {
    const output = [
      'ERROR: Failed to load script "res://src/shop.gd" with error "File not found".',
      '   at: load (modules/gdscript/gdscript_resource_format.cpp:46)',
      'GDBOX_LOADFAIL res://src/shop.gd',
      'GDBOX_LOADCHECK 2 1'
    ].join('\n')
    expect(summarizeLoadCheck(output).errors).toEqual([
      'ERROR: Failed to load script "res://src/shop.gd" with error "File not found".\nat: load (modules/gdscript/gdscript_resource_format.cpp:46)'
    ])
  })

  it('检查器没跑完就报 null，不当成全部通过', () => {
    expect(summarizeLoadCheck('Godot Engine v4.7.1\n').checked).toBeNull()
  })
})

describe('godot_check 的汇报', () => {
  const ok = { code: 0, timedOut: false }
  const noDigest = { errors: [], warnings: [], exitLeakNotices: 0 }
  const clean: LoadCheckResult = { checked: 4, failed: [], errors: [] }

  it('同一条消息出在不同脚本里不算重复，同一处才去重', () => {
    const msg = 'SCRIPT ERROR: Parse Error: Expected expression as the function argument.'
    const enemy = `${msg}\nat: GDScript::reload (res://src/enemy.gd:5)`
    const hud = `${msg}\nat: GDScript::reload (res://ui/hud.gd:9)`
    const report = buildCheckReport({
      loaded: { checked: 4, failed: ['res://src/enemy.gd'], errors: [enemy] },
      imported: ok,
      ran: ok,
      digest: { ...noDigest, errors: [enemy, hud] },
      frames: 120
    })
    expect(report.errors).toEqual([enemy, hud])
  })

  it('加载检查没跑完时最后一行不说 No errors', () => {
    const report = buildCheckReport({
      loaded: { checked: null, failed: [], errors: [] },
      imported: ok,
      ran: ok,
      digest: noDigest,
      frames: 120
    })
    expect(report.text).toContain('NOT checked')
    expect(report.text).not.toContain('No errors.')
    expect(report.text.endsWith('No error messages were printed.')).toBe(true)
  })

  it('全部干净时报出检查了几个脚本', () => {
    const report = buildCheckReport({
      loaded: clean,
      imported: ok,
      ran: ok,
      digest: noDigest,
      frames: 60
    })
    expect(report.text).toBe('No errors. Loaded 4 script(s), ran 60 frames.')
  })
})
