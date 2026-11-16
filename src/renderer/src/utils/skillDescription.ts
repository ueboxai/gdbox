/**
 * 技能在界面上显示的说明。
 *
 * SKILL.md 的 description 是写给模型看的英文长句（SKILL_STANDARD 只允许 name 和 description
 * 两个字段），中文界面直接显示它就是一整段英文。内置技能在语言包 `skillDescriptions.<name>`
 * 里有一句中文说明时用它；用户自建和插件带来的技能，以及没有译文的语言，照旧显示原文。
 */
export interface SkillLike {
  name: string
  description: string
  source: 'user' | 'plugin' | 'builtin'
}

export function skillDescription(
  skill: SkillLike,
  te: (key: string) => boolean,
  t: (key: string) => string
): string {
  if (skill.source !== 'builtin') return skill.description
  const key = `skillDescriptions.${skill.name}`
  return te(key) ? t(key) : skill.description
}
