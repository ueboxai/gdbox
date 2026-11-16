import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { blank } from './pixels'
import { applyPalette, extractPalette, StyleStore } from './style'

describe('StyleStore', () => {
  it('存成预设，换一个工程套用，参考图跟着过去', () => {
    const presets = mkdtempSync(join(tmpdir(), 'gdbox-presets-'))
    const a = mkdtempSync(join(tmpdir(), 'gdbox-a-'))
    mkdirSync(join(a, 'art'))
    writeFileSync(join(a, 'art', 'hero.png'), 'png-bytes')
    const styleA = new StyleStore(a, presets)
    styleA.set({
      prompt: 'cozy pixel art',
      pixelArt: true,
      frameHeight: 32,
      references: ['res://art/hero.png']
    })
    styleA.savePreset('cozy')

    const b = mkdtempSync(join(tmpdir(), 'gdbox-b-'))
    const styleB = new StyleStore(b, presets)
    expect(styleB.listPresets()).toEqual(['cozy'])
    const applied = styleB.loadPreset('cozy')
    expect(applied).toMatchObject({
      prompt: 'cozy pixel art',
      frameHeight: 32,
      references: ['res://assets/style/hero.png']
    })
    expect(existsSync(join(b, 'assets', 'style', 'hero.png'))).toBe(true)
  })
})

describe('palette', () => {
  it('提取主色，再把图映射到调色板', () => {
    const img = blank(4, 1)
    img.data.set([200, 20, 20, 255, 205, 22, 18, 255, 20, 20, 200, 255, 0, 0, 0, 0])
    const palette = extractPalette(img)
    expect(palette).toHaveLength(2)
    const mapped = applyPalette(img, ['#ff0000', '#0000ff'])
    expect(Array.from(mapped.data.subarray(0, 3))).toEqual([255, 0, 0])
    expect(Array.from(mapped.data.subarray(8, 11))).toEqual([0, 0, 255])
    expect(mapped.data[15]).toBe(0)
  })
})
