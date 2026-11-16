import { describe, expect, it } from 'vitest'
import {
  OTHER_TOOL_CATEGORY,
  TOOL_CATEGORIES,
  categoryToggleState,
  groupToolsByCategory,
  nextCategoryValue,
  toolCategoryId
} from './toolCategories'

const tool = (name: string, namespace: string): { name: string; namespace: string } => ({
  name,
  namespace
})

describe('大类归属', () => {
  it('一条命名空间只属于一个大类', () => {
    const seen = new Set<string>()
    for (const category of TOOL_CATEGORIES) {
      for (const namespace of category.namespaces) {
        expect(seen.has(namespace)).toBe(false)
        seen.add(namespace)
      }
    }
  })

  // 不开编辑器能做的和必须连着编辑器的是两摊：没开编辑器时用户要知道哪些还能用
  it('Godot 的无头工具和编辑器工具各自一类', () => {
    expect(toolCategoryId('godot')).toBe('godot')
    expect(toolCategoryId('godot.editor')).toBe('editor')
  })

  it('没登记的命名空间落到 other，而不是从清单上消失', () => {
    expect(toolCategoryId('something-new')).toBe(OTHER_TOOL_CATEGORY)
  })

  // 素材库、本机文件、联网、生成、知识库、工程管理不属于虚幻里的任何一摊，
  // 摊成六个大类只会让清单顶上全是两三条工具的分组头
  it('盒子自己的能力合成一类', () => {
    for (const namespace of ['asset', 'library', 'project', 'local', 'web', 'notebook']) {
      expect(toolCategoryId(namespace)).toBe('box')
    }
  })

  // 生成是唯一一摊凭空造新素材、并且按次向外部厂商花钱的，不跟着别的混
  it('生成单独一类，生成进 Godot 项目的素材也算', () => {
    for (const namespace of ['aigc', 'video.production', 'godot.asset', 'godot.style']) {
      expect(toolCategoryId(namespace)).toBe('aigc')
    }
  })
})

describe('分组', () => {
  it('按表里的顺序返回，other 垫底，空分组不返回', () => {
    const groups = groupToolsByCategory([
      tool('other_x', 'brand-new'),
      tool('read_local_file', 'local'),
      tool('generate_image', 'aigc'),
      tool('editor_select', 'godot.editor'),
      tool('godot_check', 'godot')
    ])
    expect(groups.map((group) => group.id)).toEqual([
      'godot',
      'editor',
      'aigc',
      'box',
      OTHER_TOOL_CATEGORY
    ])
    expect(groups[0].tools.map((entry) => entry.name)).toEqual(['godot_check'])
    expect(groups[1].tools.map((entry) => entry.name)).toEqual(['editor_select'])
  })
})

describe('大类开关', () => {
  const isOn = (entry: { on: boolean }): boolean => entry.on

  it('全开 / 全关 / 部分开三档', () => {
    expect(categoryToggleState([{ on: true }, { on: true }], isOn)).toBe('all')
    expect(categoryToggleState([{ on: false }, { on: false }], isOn)).toBe('none')
    expect(categoryToggleState([{ on: true }, { on: false }], isOn)).toBe('some')
  })

  it('空分组算全关，不会显示成「已全部打开」', () => {
    expect(categoryToggleState([], isOn)).toBe('none')
  })

  it('部分开时点一下是全开，只有全开时点才关', () => {
    expect(nextCategoryValue('some')).toBe(true)
    expect(nextCategoryValue('none')).toBe(true)
    expect(nextCategoryValue('all')).toBe(false)
  })
})
