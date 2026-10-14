import { describe, expect, it } from 'vitest'
import { digestGodotLog } from './run'

describe('digestGodotLog', () => {
  it('把 at: 行并进上一条报错，区分错误和警告', () => {
    const log = [
      'Godot Engine v4.7.1.stable.official',
      'SCRIPT ERROR: Invalid call. Nonexistent function "jump".',
      '          at: _physics_process (res://player.gd:12)',
      'WARNING: Node not found: "HUD".',
      '     at: get_node (scene/main/node.cpp:1800)',
      'some plain line'
    ].join('\n')
    const d = digestGodotLog(log)
    expect(d.errors).toEqual([
      'SCRIPT ERROR: Invalid call. Nonexistent function "jump".\nat: _physics_process (res://player.gd:12)'
    ])
    expect(d.warnings).toHaveLength(1)
    expect(d.exitLeakNotices).toBe(0)
  })

  it('退出期的泄漏报告单独计数，不算进错误', () => {
    const log = [
      'ERROR: 3 resources still in use at exit.',
      '   at: clear (core/io/resource.cpp:600)',
      'WARNING: ObjectDB instances leaked at exit (run with --verbose for details).',
      'ERROR: Real problem here.'
    ].join('\n')
    const d = digestGodotLog(log)
    expect(d.errors).toEqual(['ERROR: Real problem here.'])
    expect(d.warnings).toEqual([])
    expect(d.exitLeakNotices).toBe(2)
  })

  it('每帧重复的同一条报错合并成一条并标次数', () => {
    const line = "SCRIPT ERROR: Invalid access to property 'x' on Nil.\n   at: _process (res://a.gd:3)"
    const d = digestGodotLog([line, line, line, 'ERROR: other'].join('\n'))
    expect(d.errors).toEqual([
      "SCRIPT ERROR: Invalid access to property 'x' on Nil.\nat: _process (res://a.gd:3)\n(×3)",
      'ERROR: other'
    ])
  })
})
