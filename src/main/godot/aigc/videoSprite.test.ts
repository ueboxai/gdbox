import { describe, expect, it } from 'vitest'

import { blank, opaqueBounds, type Rgba } from './pixels'
import {
  composeStrip,
  findLoopPoint,
  keyFrame,
  luminanceKey,
  packStrips,
  pickEvenly,
  qualityNotes,
  removeHorizontalDrift,
  toLayer,
  type KeyColor
} from './videoSprite'

const GREEN: KeyColor = [0, 255, 0]

function fill(img: Rgba, x0: number, y0: number, w: number, h: number, rgb: number[]): void {
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) img.data.set([...rgb, 255], (y * img.width + x) * 4)
}

const px = (img: Rgba, x: number, y: number): number[] =>
  Array.from(img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4))

/** 绿底上的小人：身体固定，手臂按 phase 上下摆，整体可以平移 */
function figure(phase: number, dx = 0, size = 64): Rgba {
  const img = blank(size, size)
  fill(img, 0, 0, size, size, [0, 255, 0])
  fill(img, 26 + dx, 20, 10, 34, [200, 60, 40])
  fill(img, 36 + dx, 24 + phase * 3, 6, 4, [240, 200, 160])
  return img
}

const layerOf = (img: Rgba): ReturnType<typeof toLayer> & object => {
  const layer = toLayer(keyFrame(img, GREEN, 'chroma'), GREEN)
  if (!layer) throw new Error('empty')
  return layer
}

describe('keyFrame', () => {
  it('绿底抠成透明，边上一圈带绿的像素被去溢色', () => {
    const img = figure(0)
    // 角色边缘一列偏绿的混色
    fill(img, 25, 20, 1, 34, [120, 200, 90])
    const out = keyFrame(img, GREEN, 'chroma')
    expect(px(out, 2, 2)[3]).toBe(0)
    const edge = px(out, 25, 30)
    if (edge[3] > 0) expect(edge[1]).toBeLessThanOrEqual(Math.max(edge[0], edge[2]))
    expect(px(out, 30, 30)).toEqual([200, 60, 40, 255])
  })

  it('黑底特效按亮度抠：纯黑透明，半亮的保留半透明且颜色反预乘', () => {
    const img = blank(2, 1)
    img.data.set([0, 0, 0, 255, 128, 64, 0, 255])
    const out = luminanceKey(img)
    expect(out.data[3]).toBe(0)
    expect(out.data[7]).toBeGreaterThan(100)
    expect(out.data[7]).toBeLessThan(140)
    expect(out.data[4]).toBe(255)
    expect(out.data[5]).toBe(128)
  })
})

describe('findLoopPoint', () => {
  it('周期 6 的动作：截在回到首帧姿势的那一帧之前', () => {
    const layers = Array.from({ length: 14 }, (_, i) => layerOf(figure(i % 6)))
    expect(findLoopPoint(layers, 4)).toEqual({ end: 6, found: true })
  })

  it('来回摆的动作：半个周期处位置一样但方向相反，不当成循环点', () => {
    const swing = (i: number): Rgba => {
      const img = blank(64, 64)
      fill(img, 0, 0, 64, 64, [0, 255, 0])
      fill(img, 26, 20, 10, 34, [200, 60, 40])
      fill(img, 36, 30 + Math.round(8 * Math.sin((2 * Math.PI * i) / 12)), 6, 4, [240, 200, 160])
      return img
    }
    const layers = Array.from({ length: 20 }, (_, i) => layerOf(swing(i)))
    expect(findLoopPoint(layers, 4)).toEqual({ end: 12, found: true })
  })

  it('一路变化、回不到首帧：整段保留并说没找到', () => {
    const layers = Array.from({ length: 10 }, (_, i) => layerOf(figure(0, i * 2)))
    expect(findLoopPoint(layers, 4)).toEqual({ end: 10, found: false })
  })
})

describe('removeHorizontalDrift', () => {
  it('线性平移被拉回，重心对齐到同一位置', () => {
    const layers = Array.from({ length: 8 }, (_, i) => layerOf(figure(0, i * 2)))
    const drift = removeHorizontalDrift(layers)
    expect(drift).toBeCloseTo(14, 0)
    const cx = layers.map((l) => l.cx)
    expect(Math.max(...cx) - Math.min(...cx)).toBeLessThanOrEqual(1)
  })
})

describe('composeStrip / packStrips', () => {
  it('按身高缩放：跳起来的帧不会把整套缩小，格子高于身高', () => {
    const ground = layerOf(figure(0))
    const jumping = figure(0)
    const air = blank(64, 64)
    fill(air, 0, 0, 64, 64, [0, 255, 0])
    fill(air, 26, 4, 10, 34, [200, 60, 40])
    const layers = [ground, layerOf(air), ground, layerOf(jumping)]
    const strip = composeStrip(layers, 34, false)
    expect(strip.frames).toBe(4)
    expect(strip.cell.h).toBeGreaterThan(34)
    expect(strip.strip.width).toBe(strip.cell.w * 4)
  })

  it('几段动作拼图集：各段的重心锚点都落在格子正中，脚底贴格子底', () => {
    const a = composeStrip([layerOf(figure(0)), layerOf(figure(1))], 34, false)
    const wide = figure(0)
    fill(wide, 42, 30, 18, 3, [90, 90, 90]) // 伸出去的武器
    const b = composeStrip([layerOf(wide)], 34, false)
    const packed = packStrips([a, b])
    expect(packed.frameCount).toBe(3)
    expect(packed.cell.w % 2).toBe(0)
    for (let k = 0; k < 3; k++) {
      const cell = { x: k * packed.cell.w, y: 0, w: packed.cell.w, h: packed.cell.h }
      const bounds = opaqueBounds(packed.sheet, cell)!
      expect(bounds.y + bounds.h).toBe(packed.cell.h)
      // 身体（红色那一块）的中心在格子正中附近
      let sum = 0
      let n = 0
      for (let x = cell.x; x < cell.x + cell.w; x++) {
        const p = px(packed.sheet, x, Math.floor(packed.cell.h * 0.8))
        if (p[3] > 0 && p[0] > 150 && p[1] < 100) {
          sum += x - cell.x
          n++
        }
      }
      expect(Math.abs(sum / n - packed.cell.w / 2)).toBeLessThanOrEqual(3)
    }
  })
})

describe('qualityNotes / pickEvenly', () => {
  it('碰到画面边缘的帧被点名', () => {
    const cut = figure(0)
    fill(cut, 26, 20, 10, 44, [200, 60, 40])
    const notes = qualityNotes([layerOf(figure(0)), layerOf(cut)])
    expect(notes.cutOff).toEqual([1])
  })

  it('均匀抽帧保留首帧', () => {
    expect(pickEvenly([0, 1, 2, 3, 4, 5, 6, 7], 4)).toEqual([0, 2, 4, 6])
    expect(pickEvenly([0, 1], 4)).toEqual([0, 1])
  })
})
