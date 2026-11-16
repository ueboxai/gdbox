import { describe, expect, it } from 'vitest'

import { createSessionExperience, isLearnableMeta } from './session'
import { assertNotWritingExperience } from './writeGuard'

describe('isLearnableMeta', () => {
  it('只学 Godot 引擎工具，破坏性的不学', () => {
    expect(isLearnableMeta({ namespace: 'godot.editor', risk: 'mutating' }, {})).toBe(true)
    expect(isLearnableMeta({ namespace: 'godot', risk: 'safe' }, {}, 'godot_check')).toBe(true)
    expect(isLearnableMeta({ namespace: 'local', risk: 'safe' }, {})).toBe(false)
    expect(isLearnableMeta({ namespace: 'ue', risk: 'safe' }, {})).toBe(false)
    expect(isLearnableMeta({ namespace: 'godot.editor', risk: 'destructive' }, {})).toBe(false)
    expect(isLearnableMeta(undefined, {})).toBe(false)
  })

  it('本地写文件只在改 Godot 文本文件时记账', () => {
    const meta = { namespace: 'local', risk: 'mutating' as const }
    expect(isLearnableMeta(meta, { path: 'H:/G/player.gd' }, 'edit_local_file')).toBe(true)
    expect(isLearnableMeta(meta, { path: 'H:/G/notes.txt' }, 'edit_local_file')).toBe(false)
    expect(isLearnableMeta(meta, {}, 'write_local_file')).toBe(false)
  })
})

describe('createSessionExperience', () => {
  it('沉淀开关关着、或者不知道是哪个工程，就不装', () => {
    const base = { sessionId: 's', tools: [] }
    expect(
      createSessionExperience({ ...base, projectRoot: 'H:/P/Game', skillLearning: 'off' })
    ).toBeUndefined()
    expect(createSessionExperience({ ...base, skillLearning: 'ask' })).toBeUndefined()
    expect(
      createSessionExperience({ ...base, projectRoot: 'H:/P/Game', skillLearning: 'ask' })
    ).toBeDefined()
  })
})

describe('assertNotWritingExperience', () => {
  it('挡住写经验目录，别的 .gdbox 子目录照常', () => {
    expect(
      assertNotWritingExperience('H:\\P\\Game\\.gdbox\\experience\\godot_check.md')
    ).toBeDefined()
    expect(assertNotWritingExperience('H:/P/Game/.gdbox/EXPERIENCE/.ledger.json')).toBeDefined()
    expect(assertNotWritingExperience('H:/P/Game/.gdbox/skills/my/SKILL.md')).toBeUndefined()
    expect(assertNotWritingExperience('H:/P/Game/.gdbox/experience-notes.md')).toBeUndefined()
  })
})
