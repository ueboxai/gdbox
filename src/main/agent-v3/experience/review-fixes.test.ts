import { describe, expect, it } from 'vitest'

import { patternCovered } from './admission'
import {
  parseExperienceFile,
  serializeExperienceFile,
  type ExperienceEntry
} from './experienceFile'
import { digestArgs } from './trail'

const entry: ExperienceEntry = {
  id: 'e-1',
  title: 't',
  tool: 'godot_check',
  errorPattern: "nonexistent function 'instance' in base 'packedscene'",
  advice: 'a',
  expect: { tool: 'edit_local_file' },
  source: '',
  status: 'trial'
}

describe('代码审查修复的回归', () => {
  it('长脚本的参数摘要仍是合法 JSON；只改了尾部的两段脚本摘要不同', () => {
    const head = 'x'.repeat(2000)
    const a = digestArgs({ content: `${head}\nscene.instance()` })
    const b = digestArgs({ content: `${head}\nscene.instantiate()` })
    expect(() => JSON.parse(a)).not.toThrow()
    expect((JSON.parse(a) as { content: string }).content).not.toBe(
      (JSON.parse(b) as { content: string }).content
    )
  })

  it('片段里的双引号原样写回，读出来还是原报错里的那一段', () => {
    const quoted = {
      ...entry,
      tool: 'godot_editor_set_property',
      errorPattern: 'property "foo" not found on node'
    }
    const text = serializeExperienceFile('godot_editor_set_property', [quoted])
    expect(parseExperienceFile(text)[0].errorPattern).toBe('property "foo" not found on node')
  })

  it('验证工具的片段也能查出重复', () => {
    expect(
      patternCovered([entry], entry.tool, "nonexistent function 'instance' in base 'packedscene'")
    ).toBe(true)
    expect(
      patternCovered([entry], entry.tool, "nonexistent function 'pack' in base 'packedscene'")
    ).toBe(false)
  })
})
