import { describe, expect, it } from 'vitest'
import {
  BASELINE_VERSION,
  PROMPT_BUDGET_BYTES,
  VERSION_NOTES,
  compareVersions,
  minorVersion,
  versionHintsForErrors,
  versionNotesForPrompt,
  type VersionNote
} from './versionNotes'

const bytes = (lines: string[]): number => Buffer.byteLength(lines.join('\n'), 'utf8')

describe('版本号', () => {
  it('从工程版本和 godot --version 输出里取主次版本', () => {
    expect(minorVersion('4.7')).toBe('4.7')
    expect(minorVersion('4.7.1.stable.official.a13da4feb')).toBe('4.7')
    expect(minorVersion('4.5.beta2.mono')).toBe('4.5')
    expect(minorVersion('')).toBeNull()
    expect(minorVersion(undefined)).toBeNull()
    expect(minorVersion('stable')).toBeNull()
  })

  it('逐段按数字比，4.10 大于 4.9', () => {
    expect(compareVersions('4.10', '4.9')).toBeGreaterThan(0)
    expect(compareVersions('4.4', '4.4')).toBe(0)
    expect(compareVersions('4.3', '4.4')).toBeLessThan(0)
  })
})

describe('数据自检', () => {
  it.each(VERSION_NOTES.map((n) => [n.summary, n] as const))('%s', (_, note) => {
    expect(compareVersions(note.since, BASELINE_VERSION)).toBeGreaterThan(0)
    expect(note.summary.length).toBeLessThanOrEqual(160)
    expect(note.source).toMatch(/^https:\/\//)
    for (const p of note.patterns ?? []) expect(p.global).toBe(false)
  })

  it('summary 不重复', () => {
    const all = VERSION_NOTES.map((n) => n.summary)
    expect(new Set(all).size).toBe(all.length)
  })
})

describe('versionNotesForPrompt', () => {
  it('版本未知时不出这一段', () => {
    expect(versionNotesForPrompt(undefined)).toEqual([])
    expect(versionNotesForPrompt('stable')).toEqual([])
  })

  it('4.3 工程只列它还没有的 API，不列 4.4 以后的行为变化', () => {
    const lines = versionNotesForPrompt('4.3')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^Not available in Godot 4\.3: /)
    expect(lines[0]).toContain('typed Dictionary[K, V] (4.4)')
    expect(lines[0]).toContain('@abstract (4.5)')
    expect(lines[0]).toContain('VirtualJoystick (4.7)')
  })

  it('4.5 工程：列 4.4–4.5 的变化和 4.6 以后才有的 API，不列 4.6 以后的变化', () => {
    const text = versionNotesForPrompt('4.5').join('\n')
    expect(text).toContain('get_node_rpc_config')
    expect(text).toContain('.uid')
    expect(text).not.toContain('area_mask')
    expect(text).toContain('VirtualJoystick (4.7)')
    expect(text).not.toContain('@abstract (4.5)')
  })

  it('4.7 工程：列出 area_mask 和 4.8 才有的 API，不列 4.8 的变化', () => {
    const text = versionNotesForPrompt('4.7.1.stable').join('\n')
    expect(text).toContain('area_mask')
    expect(text).toContain('Not available in Godot 4.7: ')
    expect(text).toContain('Trail3D (4.8)')
    expect(text).not.toContain('VirtualJoystick (4.7)')
    expect(text).not.toContain('ui_toggle_fullscreen')
  })

  it('4.8 工程：列出 4.8 的变化，不再有「不可用」那一行', () => {
    const lines = versionNotesForPrompt('4.8')
    expect(lines.join('\n')).toContain('ui_toggle_fullscreen')
    expect(lines.some((l) => l.startsWith('Not available'))).toBe(false)
  })

  it.each(['4.4', '4.5', '4.6', '4.7', '4.8', '4.12'])('%s 不超过预算', (v) => {
    expect(bytes(versionNotesForPrompt(v))).toBeLessThanOrEqual(PROMPT_BUDGET_BYTES)
  })

  it('超预算时按数组顺序截断，前面的留下', () => {
    const notes: VersionNote[] = Array.from({ length: 50 }, (_, i) => ({
      since: '4.5',
      kind: 'changed',
      summary: `change number ${i} ${'x'.repeat(80)}`,
      source: 'https://example.com'
    }))
    const lines = versionNotesForPrompt('4.7', notes, 600)
    expect(bytes(lines)).toBeLessThanOrEqual(600)
    expect(lines[1]).toContain('change number 0 ')
    expect(lines.join('\n')).not.toContain('change number 49 ')
  })
})

describe('versionHintsForErrors', () => {
  // 下面几条报错原文来自本机 Godot 4.7.1
  const OVERRIDE =
    'SCRIPT ERROR: Parse Error: Not all code paths return a value.\n   at: GDScript::reload (res://child.gd:2)'
  const RPC = 'SCRIPT ERROR: Parse Error: Function "get_rpc_config()" not found in base self.'
  const SHADER =
    "SHADER ERROR: 'textureQueryLod' cannot be used within the 'vertex' processor function."

  it('4.7 引擎上的报错对上对应的差异，每条只出现一次', () => {
    const text = versionHintsForErrors('4.7.1.stable.official.a13da4feb', [
      OVERRIDE,
      RPC,
      SHADER,
      SHADER
    ])
    expect(text).toMatch(/^Godot version notes that may explain the errors above:/)
    expect(text).toContain('Changed in Godot 4.7: An override of a method with a typed return')
    expect(text).toContain('Changed in Godot 4.5: Node.get_rpc_config() was renamed')
    expect(text.match(/textureQueryLod/g)).toHaveLength(1)
  })

  it('4.7 引擎上用了 4.8 的类，说明需要 4.8', () => {
    const text = versionHintsForErrors('4.7.1.stable.official.a13da4feb', [
      'SCRIPT ERROR: Parse Error: Identifier "Trail3D" not declared in the current scope.'
    ])
    expect(text).toContain('Trail3D needs Godot 4.8+; this engine is 4.7.')
  })

  it('引擎版本早于改动时不提这条改动', () => {
    expect(versionHintsForErrors('4.6.2.stable', [OVERRIDE])).toBe('')
  })

  it('旧引擎上用了新 API，说明需要哪个版本', () => {
    const text = versionHintsForErrors('4.4.1.stable', [
      'SCRIPT ERROR: Parse Error: Unrecognized annotation: "@abstract".'
    ])
    expect(text).toContain('@abstract needs Godot 4.5+; this engine is 4.4.')
  })

  it('对不上或版本未知时返回空串', () => {
    expect(
      versionHintsForErrors('4.7', ['SCRIPT ERROR: Invalid call. Nonexistent function "foo".'])
    ).toBe('')
    expect(versionHintsForErrors(undefined, [OVERRIDE])).toBe('')
    expect(versionHintsForErrors('4.7', [])).toBe('')
  })
})
