import { describe, expect, it } from 'vitest'
import {
  blank,
  buildSheet,
  findFrames,
  modeDownsample,
  opaqueBounds,
  removeBackground,
  type Rgba
} from './pixels'

function fill(
  img: Rgba,
  x0: number,
  y0: number,
  w: number,
  h: number,
  rgba: [number, number, number, number]
): void {
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) img.data.set(rgba, (y * img.width + x) * 4)
}

const GREEN: [number, number, number, number] = [0, 255, 0, 255]
const RED: [number, number, number, number] = [200, 30, 30, 255]

describe('removeBackground', () => {
  it('抠像色背景：连通的背景和被包住的同色缝都抠掉', () => {
    const img = blank(20, 20)
    fill(img, 0, 0, 20, 20, GREEN)
    fill(img, 5, 5, 10, 10, RED)
    fill(img, 9, 9, 2, 2, GREEN) // 胳膊和身体之间的缝
    const out = removeBackground(img)
    expect(out.data[3]).toBe(0)
    expect(out.data[(10 * 20 + 6) * 4 + 3]).toBe(255)
    expect(out.data[(9 * 20 + 9) * 4 + 3]).toBe(0)
  })

  it('普通背景色：只抠和边连通的，角色身上同色的地方不挖洞', () => {
    const GRAY: [number, number, number, number] = [200, 200, 200, 255]
    const img = blank(20, 20)
    fill(img, 0, 0, 20, 20, GRAY)
    fill(img, 5, 5, 10, 10, RED)
    fill(img, 9, 9, 2, 2, GRAY) // 比如眼白
    const out = removeBackground(img)
    expect(out.data[3]).toBe(0)
    expect(out.data[(9 * 20 + 9) * 4 + 3]).toBe(255)
  })
})

describe('findFrames', () => {
  it('按空白切开间距不均的帧，并去掉零碎斑点', () => {
    const img = blank(100, 30)
    fill(img, 2, 5, 20, 20, RED)
    fill(img, 30, 3, 18, 24, RED)
    fill(img, 70, 5, 22, 20, RED)
    fill(img, 60, 1, 1, 1, RED) // 斑点
    const frames = findFrames(img)
    expect(frames.map((f) => f.x)).toEqual([2, 30, 70])
  })

  it('帧粘在一起、找到的比要的少时，按网格平分并只取要的格数', () => {
    const img = blank(40, 20)
    fill(img, 0, 0, 40, 20, RED) // 连成一片，按空白切只有一帧
    expect(findFrames(img, { cols: 4, rows: 2, count: 6 })).toHaveLength(6)
  })

  it('网格没排满（10 帧排成 4×3）时不误退回网格平分', () => {
    const img = blank(100, 75)
    for (let i = 0; i < 10; i++)
      fill(img, (i % 4) * 25 + 3, Math.floor(i / 4) * 25 + 3, 18, 18, RED)
    const frames = findFrames(img, { cols: 4, rows: 3, count: 10 })
    expect(frames).toHaveLength(10)
    expect(frames.every((f) => f.w === 18 && f.h === 18)).toBe(true)
  })
})

describe('modeDownsample', () => {
  it('不规则的假像素块缩成干净的真像素', () => {
    // 3×3 个「美术像素」，每格 7 像素宽，中间那格有一点杂色
    const img = blank(21, 21)
    fill(img, 0, 0, 21, 21, RED)
    fill(img, 7, 7, 7, 7, [20, 20, 220, 255])
    fill(img, 9, 9, 1, 1, [255, 255, 255, 255])
    const out = modeDownsample(img, { x: 0, y: 0, w: 21, h: 21 }, 3, 3)
    const center = Array.from(out.data.subarray((1 * 3 + 1) * 4, (1 * 3 + 1) * 4 + 4))
    expect(center[2]).toBeGreaterThan(200)
    expect(center[0]).toBeLessThan(40)
  })
})

describe('buildSheet', () => {
  it('统一缩到目标高度，脚底对齐', () => {
    const img = blank(100, 50)
    fill(img, 0, 10, 20, 40, RED) // 高 40
    fill(img, 50, 30, 20, 20, RED) // 高 20
    const frames = findFrames(img)
    const { sheet, cell, frameCount } = buildSheet(img, frames, 16, true)
    expect(frameCount).toBe(2)
    expect(cell.h).toBe(16)
    // 第二帧只有一半高，应该贴在格子底部
    const second = opaqueBounds(sheet, { x: cell.w, y: 0, w: cell.w, h: cell.h })
    expect(second?.y).toBe(8)
    expect(second?.h).toBe(8)
  })
})
