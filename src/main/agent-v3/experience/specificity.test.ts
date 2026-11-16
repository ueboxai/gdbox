import { describe, expect, it } from 'vitest'

import { findLessonCandidates, validateLesson } from './curator'
import { normalizeError } from './errorSignature'
import type { ExperienceEntry } from './experienceFile'
import { matchEntries, type LayeredEntry } from './recall'
import { patternProblem } from './specificity'
import type { TrailCall } from './trail'

// 报错样本照 Godot 4 的原文写，经 godot_check 交回的形状
const gd = (message: string): string =>
  normalizeError(`SCRIPT ERROR: ${message}\nat: _ready (res://main.gd:5)`)

const INSTANCE = gd("Invalid call. Nonexistent function 'instance' in base 'PackedScene'.")
const GET_STATE = gd("Invalid call. Nonexistent function 'get_staet' in base 'PackedScene'.")

describe('patternProblem：普通工具', () => {
  it('短于 12 个字或全是通用词不行；有一个实词就行', () => {
    const missing = normalizeError(
      "godot_editor_set_property 失败：节点 'Player/Sprite' 上没有属性 'flip_hh'"
    )
    expect(patternProblem('godot_editor_set_property', '没有属性', missing)).toBe('too-short')
    expect(
      patternProblem('godot_editor_set_property', "上没有属性 'flip_hh'", missing)
    ).toBeUndefined()
    const node = normalizeError(
      "godot_editor_add_node 失败：parent 'World/Enemies' not found in scene"
    )
    expect(patternProblem('godot_editor_add_node', 'not found in scene', node)).toBeUndefined()
    expect(patternProblem('godot_editor_add_node', 'not found in the', node)).toBe('not-in-error')
  })
})

describe('召回兜底：旧的宽片段不再命中', () => {
  it('一条写成 nonexistent function 的旧经验，对哪个方法都不出场', () => {
    const wide: LayeredEntry = {
      id: 'e-wide',
      title: '宽',
      tool: 'godot_check',
      errorPattern: 'invalid call. nonexistent function',
      advice: '查文档',
      expect: { tool: 'edit_local_file' },
      source: '',
      status: 'proven',
      layer: 'global'
    }
    const narrow: LayeredEntry = {
      ...wide,
      id: 'e-narrow',
      errorPattern: "nonexistent function 'instance' in base 'packedscene'"
    }
    expect(matchEntries([wide, narrow], wide.tool, INSTANCE).map((e) => e.id)).toEqual(['e-narrow'])
    // 换一个方法：窄的那条也不出场 —— 它说的是 instance
    expect(matchEntries([wide, narrow], wide.tool, GET_STATE)).toEqual([])
  })

  it('说的不是同一个 API，片段再像也不出场', () => {
    const entry: LayeredEntry = {
      id: 'e',
      title: 't',
      tool: 'godot_check',
      errorPattern: "nonexistent function 'instance' in base",
      advice: 'a',
      expect: { tool: 'edit_local_file' },
      source: '',
      status: 'trial',
      layer: 'global',
      symbol: 'packedscene.instance'
    }
    const other = gd("Invalid call. Nonexistent function 'instance' in base 'Node2D'.")
    expect(
      matchEntries([entry], entry.tool, INSTANCE, undefined, 'packedscene.instance')
    ).toHaveLength(1)
    expect(matchEntries([entry], entry.tool, other, undefined, 'node2d.instance')).toEqual([])
  })
})

describe('整理员：同一次会话里别的报错也对得上，就太宽', () => {
  const call = (i: number, over: Partial<TrailCall>): TrailCall => ({
    kind: 'call',
    agent: 's1',
    i,
    tool: 'godot_check',
    ok: true,
    args: '{}',
    ...over
  })
  const edit = (i: number): TrailCall =>
    call(i, {
      tool: 'edit_local_file',
      path: 'H:/G/main.gd',
      old: 's.instance()',
      code: 's.instantiate()'
    })
  const calls = [
    call(1, { ok: false, error: INSTANCE, fp: INSTANCE.slice(0, 120) }),
    edit(2),
    call(3, {}),
    call(4, { ok: false, error: GET_STATE, fp: GET_STATE.slice(0, 120) })
  ]

  it('片段能同时对上 instance 和 get_staet 两个错，丢掉', () => {
    const [candidate] = findLessonCandidates(calls, [] as ExperienceEntry[])
    expect(candidate.siblings).toEqual([GET_STATE])
    const lesson = { index: 0, title: 't', advice: '改用 instantiate()', expect: {} }
    expect(
      validateLesson(
        { ...lesson, errorPattern: 'invalid call. nonexistent function' },
        candidate,
        new Set()
      )
    ).toBeUndefined()
    expect(
      validateLesson(
        { ...lesson, errorPattern: "nonexistent function 'instance' in base 'packedscene'" },
        candidate,
        new Set()
      )
    ).toMatchObject({ expect: { tool: 'edit_local_file' } })
  })

  it('笔误连候选都进不去，不花模型调用', () => {
    const typo = gd('Parse Error: Identifier "velocity_y" not declared in the current scope.')
    expect(
      findLessonCandidates(
        [call(1, { ok: false, error: typo, fp: typo }), edit(2), call(3, {})],
        []
      )
    ).toEqual([])
  })
})
