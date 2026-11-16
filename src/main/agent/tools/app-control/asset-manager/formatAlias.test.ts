import { describe, expect, it } from 'vitest'

import { FORMAT_ALIAS_MAP } from './types'

/**
 * 别名表本身的约束。
 *
 * 这些不是风格问题，每一条都对应一个真机上量到的错误结果。
 */
describe('FORMAT_ALIAS_MAP', () => {
  /**
   * 别名里不能有一个「什么都匹配」的值。虚幻盒子时期是 `uasset`：每个资产落盘都是它，
   * 列进哪个别名，哪个别名就匹配全库 —— 真机上问「有哪些材质」返回了整个库。
   * Godot 这边对应的是导入旁挂文件 `.import`，也不许出现。
   */
  it('别名里不能出现匹配全库的扩展名', () => {
    const offenders = Object.entries(FORMAT_ALIAS_MAP)
      .filter(([, values]) => values.some((v) => ['uasset', 'import'].includes(v.toLowerCase())))
      .map(([name]) => name)

    expect(offenders).toEqual([])
  })

  /**
   * 场景和脚本按扩展名认：库里场景的类型记的是根节点类型，脚本记的是
   * `GDScript (基类)`，按类型名一个都对不上。
   */
  it('场景、脚本按扩展名认', () => {
    expect(FORMAT_ALIAS_MAP['场景']).toContain('tscn')
    expect(FORMAT_ALIAS_MAP['脚本']).toContain('gd')
  })

  /**
   * 扩展名与类型名靠**大小写**区分：类型名一律 PascalCase（Texture2D、
   * SpriteFrames），扩展名一律小写（glb、png）。
   *
   * 原来的判据是先 toLowerCase 再测 `^[a-z0-9]+$` —— 小写之后
   * `Material` 必然匹配，所有类型名都被当成扩展名，拿去和文件扩展名比
   * 永远比不中。凡是别名里只有类型名的（材质/动画/特效），筛选恒为空。
   */
  it('类型名保持 PascalCase，扩展名保持小写', () => {
    const isExtension = (v: string): boolean => /^\.?[a-z0-9]+$/.test(v)
    for (const [alias, values] of Object.entries(FORMAT_ALIAS_MAP)) {
      for (const value of values) {
        // 每个值要么是干净的小写扩展名，要么是首字母大写的类型名，
        // 不能是 "spriteFrames" 这种两头不靠的写法
        const looksLikeType = /^[A-Z]/.test(value)
        expect(isExtension(value) || looksLikeType, `${alias} 的 "${value}"`).toBe(true)
      }
    }
  })

  it('常用别名都还在', () => {
    for (const alias of ['模型', '贴图', '材质', '场景', '脚本', '动画', '音效']) {
      expect(FORMAT_ALIAS_MAP[alias]?.length, alias).toBeGreaterThan(0)
    }
  })
})
