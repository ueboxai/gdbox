import { describe, expect, it } from 'vitest'

import { getAssetClassColor, getAssetClassNameCn } from './assetClassNames'

describe('getAssetClassNameCn', () => {
  it('翻译 GodotAssetProcessor 产出的类名', () => {
    expect(getAssetClassNameCn('PackedScene')).toBe('场景')
    expect(getAssetClassNameCn('GDScript (CharacterBody2D)')).toBe('脚本')
    expect(getAssetClassNameCn('ShaderMaterial')).toBe('材质')
    expect(getAssetClassNameCn('Shader')).toBe('着色器')
    expect(getAssetClassNameCn('Texture2D')).toBe('纹理')
    expect(getAssetClassNameCn('AudioStreamOggVorbis')).toBe('音频')
    expect(getAssetClassNameCn('SpriteFrames')).toBe('帧动画')
    expect(getAssetClassNameCn('TileSet')).toBe('图块集')
  })

  it('场景根节点类型和认不出的类名原样返回', () => {
    expect(getAssetClassNameCn('CharacterBody2D')).toBe('CharacterBody2D')
    expect(getAssetClassNameCn('AnimatedSprite2D')).toBe('AnimatedSprite2D')
  })

  it('没有类名时叫「资产」', () => {
    expect(getAssetClassNameCn()).toBe('资产')
  })
})

describe('getAssetClassColor', () => {
  it('认不出的类名给默认灰', () => {
    expect(getAssetClassColor('CharacterBody2D')).toBe('#888888')
    expect(getAssetClassColor('Texture2D')).not.toBe('#888888')
  })
})
