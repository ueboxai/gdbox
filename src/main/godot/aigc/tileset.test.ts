import { describe, expect, it } from 'vitest'
import { blank } from './pixels'
import { sliceTileset, tilesetTres } from './tileset'

function fill(
  img: ReturnType<typeof blank>,
  x0: number,
  y0: number,
  w: number,
  h: number,
  rgb: [number, number, number]
): void {
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) img.data.set([...rgb, 255], (y * img.width + x) * 4)
}

describe('sliceTileset', () => {
  it('按空白找瓦片，半格高的木板不被拉伸，实心块带碰撞', () => {
    const img = blank(120, 100)
    fill(img, 0, 0, 120, 100, [255, 0, 255])
    fill(img, 10, 10, 40, 40, [120, 80, 40]) // 整块泥土
    fill(img, 70, 10, 40, 40, [90, 90, 90]) // 整块石头
    fill(img, 10, 60, 40, 10, [150, 100, 50]) // 木板：只有 1/4 高
    const t = sliceTileset(img, 8, true)
    expect(t.count).toBe(3)
    expect(t.cols).toBe(2)
    expect(t.rows).toBe(2)
    expect(t.solid).toEqual([true, true, false, false])
    const tres = tilesetTres('res://tiles.png', t, new Set([1]))
    expect(tres).toContain(
      '0:0/0/physics_layer_0/polygon_0/points = PackedVector2Array(-4, -4, 4, -4, 4, 4, -4, 4)'
    )
    expect(tres).not.toContain('1:0/0/physics_layer_0')
    expect(tres).toContain('0:1/0 = 0') // 木板登记了但不实心
    expect(tres).not.toContain('1:1/0 = 0') // 空格子不登记
  })

  it('修掉整块瓦片的深色描边', () => {
    const img = blank(60, 60)
    fill(img, 0, 0, 60, 60, [255, 0, 255])
    fill(img, 10, 10, 40, 40, [10, 10, 10]) // 描边
    fill(img, 15, 15, 30, 30, [200, 150, 100]) // 内部
    const t = sliceTileset(img, 8, true)
    const corner = Array.from(t.atlas.data.subarray(0, 3))
    expect(corner[0]).toBeGreaterThan(150)
  })
})
