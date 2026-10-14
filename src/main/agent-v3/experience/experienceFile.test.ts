import { describe, expect, it } from 'vitest'

import {
  parseExperienceFile,
  serializeExperienceFile,
  type ExperienceEntry
} from './experienceFile'

const entry: ExperienceEntry = {
  id: 'e-1a2b3c4d',
  title: 'PackedScene 用 instantiate()',
  tool: 'godot_check',
  errorPattern: "nonexistent function 'instance' in base 'packedscene'",
  advice: 'Godot 4 里改用 instantiate()',
  expect: { tool: 'edit_local_file' },
  source: '2026-09-28 · session a1b2c3d4 · failed 2x, then succeeded',
  verified: { date: '2026-09-28', engine: '4.3' },
  status: 'trial'
}

describe('experienceFile', () => {
  it('写出去再读回来一模一样', () => {
    const pinned = {
      ...entry,
      id: 'e-2',
      status: 'proven' as const,
      pinned: true,
      expect: { tool: 'godot_editor_get_node' },
      // 通用层才有的两个字段
      engines: ['4.2', '4.3'],
      notFor: ['4.4']
    }
    const text = serializeExperienceFile('godot_check', [entry, pinned])
    expect(parseExperienceFile(text)).toEqual([entry, pinned])
  })

  it('验证版本写成 Godot 4.3；虚幻时期写的 UE 前缀照样读得回来', () => {
    const text = serializeExperienceFile('godot_check', [entry])
    expect(text).toContain('- verified: 2026-09-28 · Godot 4.3')
    expect(parseExperienceFile(text.replace('Godot 4.3', 'UE 4.3'))[0].verified).toEqual({
      date: '2026-09-28',
      engine: '4.3'
    })
  })

  it('字段里的换行被压平，不会把一条劈成两条', () => {
    const text = serializeExperienceFile('t', [{ ...entry, advice: '第一行\n## 第二行' }])
    const parsed = parseExperienceFile(text)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].advice).toBe('第一行 ## 第二行')
  })

  it('用户手改坏的那一条不认，其余照常', () => {
    const good = serializeExperienceFile('t', [entry])
    const broken = '\n## 坏掉的一条\n<!-- id: e-bad -->\n- advice: 没有 key 也没有 status\n'
    expect(parseExperienceFile(good + broken).map((e) => e.id)).toEqual([entry.id])
  })
})
