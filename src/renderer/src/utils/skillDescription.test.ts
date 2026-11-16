import { describe, expect, it } from 'vitest'
import { createI18n } from 'vue-i18n'
import zhCN from '@renderer/i18n/locales/zh-CN'
import enUS from '@renderer/i18n/locales/en-US'
import { skillDescription } from './skillDescription'

function i18n(locale: 'zh-CN' | 'en-US'): {
  te: (k: string) => boolean
  t: (k: string) => string
} {
  const { global } = createI18n({
    legacy: false,
    locale,
    fallbackLocale: false,
    missingWarn: false,
    fallbackWarn: false,
    messages: { 'zh-CN': zhCN, 'en-US': enUS }
  })
  return { te: (k: string) => global.te(k, locale), t: (k: string) => global.t(k) }
}

describe('skillDescription', () => {
  const builtin = {
    name: 'godot-tilemap-level',
    description: 'Builds a 2D tile level',
    source: 'builtin' as const
  }

  it('中文界面的内置技能显示中文说明', () => {
    const { te, t } = i18n('zh-CN')
    expect(skillDescription(builtin, te, t)).toBe('用生成的图块搭建或扩展 2D 图块关卡')
  })

  it('英文界面显示英文短说明', () => {
    const { te, t } = i18n('en-US')
    expect(skillDescription(builtin, te, t)).toBe(
      'Build or extend a 2D tile level from generated tiles'
    )
  })

  it('没有译文的内置技能显示原文', () => {
    const { te, t } = i18n('zh-CN')
    const unknown = { ...builtin, name: 'not-a-skill' }
    expect(skillDescription(unknown, te, t)).toBe('Builds a 2D tile level')
  })

  it('用户技能即使同名也显示原文', () => {
    const { te, t } = i18n('zh-CN')
    expect(skillDescription({ ...builtin, source: 'user' }, te, t)).toBe('Builds a 2D tile level')
  })

  it('每个内置技能都有中文说明', async () => {
    const { readdirSync, existsSync } = await import('node:fs')
    const names = readdirSync('resources/skills', { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(`resources/skills/${d.name}/SKILL.md`))
      .map((d) => d.name)
    const zh = (zhCN as unknown as { skillDescriptions: Record<string, string> }).skillDescriptions
    expect(names.filter((n) => !zh[n])).toEqual([])
  })
})
