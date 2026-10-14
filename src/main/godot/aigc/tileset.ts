import {
  blank,
  blit,
  findFrames,
  modeDownsample,
  averageDownsample,
  removeBackground,
  type Rect,
  type Rgba
} from './pixels'

export interface TilesetResult {
  atlas: Rgba
  tileSize: number
  cols: number
  rows: number
  /** 每块瓦片是否算实心（不透明像素过半） */
  solid: boolean[]
  count: number
}

/**
 * AI 画的瓦片表 → 规整的瓦片图集。
 *
 * AI 出的瓦片之间有空隙、间距不均，而且有的不是整块（木板、草丛）。所以：
 * 1. 按空白找出每一块，按行分组；
 * 2. 以最大那块的边长当「一整格」，所有块用同一比例缩放——木板还是半格高，不会被拉伸成整块；
 * 3. 每块在格子里水平居中、贴本行顶部放（和原图里的相对位置一致）；
 * 4. 整块的瓦片修掉外圈描边，否则铺在一起会出现一道道网格线。
 */
export function sliceTileset(
  img: Rgba,
  tileSize: number,
  pixelArt: boolean,
  options: { removeOutline?: boolean } = {}
): TilesetResult {
  const cleaned = removeBackground(img)
  const frames = findFrames(cleaned)
  if (!frames.length)
    throw new Error('No tiles were found in the image after removing the background.')
  // 「一整格」的边长：取接近正方形的那些块的中位数（草皮顶上的草叶会让个别块偏大）
  const isSquare = (f: Rect): boolean => f.w / f.h > 0.8 && f.w / f.h < 1.25
  const squares = frames
    .filter(isSquare)
    .map((f) => Math.max(f.w, f.h))
    .sort((a, b) => a - b)
  const full = squares.length
    ? squares[Math.floor(squares.length / 2)]
    : Math.max(...frames.map((f) => Math.max(f.w, f.h)))

  // 按行分组：纵向有重叠的算同一行
  const rows: Rect[][] = []
  for (const f of [...frames].sort((a, b) => a.y - b.y)) {
    const row = rows.find((r) => r.some((o) => f.y < o.y + o.h && o.y < f.y + f.h))
    if (row) row.push(f)
    else rows.push([f])
  }
  rows.forEach((r) => r.sort((a, b) => a.x - b.x))
  const cols = Math.max(...rows.map((r) => r.length))
  const atlas = blank(cols * tileSize, rows.length * tileSize)
  const solid: boolean[] = new Array(cols * rows.length).fill(false)

  rows.forEach((row, ri) => {
    const top = Math.min(...row.map((f) => f.y))
    row.forEach((f, ci) => {
      // 整块瓦片按自己的边界铺满格子，铺在一起才没有缝；不是整块的（木板、草丛）按统一比例放，不拉伸
      const cell =
        isSquare(f) && Math.max(f.w, f.h) >= full * 0.85
          ? f
          : { x: Math.round(f.x + f.w / 2 - full / 2), y: top, w: full, h: full }
      const tile = pixelArt
        ? modeDownsample(cleaned, cell, tileSize, tileSize)
        : averageDownsample(cleaned, cell, tileSize, tileSize)
      let opaque = 0
      for (let i = 3; i < tile.data.length; i += 4) if (tile.data[i] >= 128) opaque++
      const index = ri * cols + ci
      solid[index] = opaque * 2 >= tileSize * tileSize
      if ((options.removeOutline ?? true) && opaque >= tileSize * tileSize * 0.9) stripOutline(tile)
      blit(atlas, tile, ci * tileSize, ri * tileSize)
    })
  })
  return { atlas, tileSize, cols, rows: rows.length, solid, count: frames.length }
}

const lum = (d: Uint8Array, i: number): number => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]

/**
 * 外圈像素明显比往里一格暗，就当描边，换成里面那一格的颜色。
 * 从外往里各做两圈：缩小后的描边常常是 1~2 像素。
 */
function stripOutline(tile: Rgba): void {
  const { width: w, height: h, data: d } = tile
  const at = (x: number, y: number): number => (y * w + x) * 4
  const fix = (x: number, y: number, ix: number, iy: number): void => {
    const o = at(x, y)
    const inner = at(ix, iy)
    if (d[o + 3] >= 128 && d[inner + 3] >= 128 && lum(d, o) < lum(d, inner) * 0.6)
      d.copyWithin(o, inner, inner + 4)
  }
  for (let ring = 1; ring >= 0; ring--) {
    for (let x = ring; x < w - ring; x++) {
      fix(x, ring, x, ring + 1)
      fix(x, h - 1 - ring, x, h - 2 - ring)
    }
    for (let y = ring; y < h - ring; y++) {
      fix(ring, y, ring + 1, y)
      fix(w - 1 - ring, y, w - 2 - ring, y)
    }
  }
}

/**
 * Godot 4 TileSet 资源（文本格式）。实心瓦片带一个整格的碰撞多边形；passable 里的序号不带碰撞。
 * 只登记有内容的格子。
 */
export function tilesetTres(
  texturePath: string,
  t: TilesetResult,
  passable: Set<number> = new Set()
): string {
  const h = t.tileSize / 2
  const lines = [
    `[gd_resource type="TileSet" format=3]`,
    '',
    `[ext_resource type="Texture2D" path="${texturePath}" id="1_tex"]`,
    '',
    `[sub_resource type="TileSetAtlasSource" id="atlas"]`,
    `texture = ExtResource("1_tex")`,
    `texture_region_size = Vector2i(${t.tileSize}, ${t.tileSize})`
  ]
  for (let i = 0; i < t.cols * t.rows; i++) {
    const x = i % t.cols
    const y = Math.floor(i / t.cols)
    if (!hasPixels(t, x, y)) continue
    lines.push(`${x}:${y}/0 = 0`)
    if (t.solid[i] && !passable.has(i)) {
      lines.push(
        `${x}:${y}/0/physics_layer_0/polygon_0/points = PackedVector2Array(${-h}, ${-h}, ${h}, ${-h}, ${h}, ${h}, ${-h}, ${h})`
      )
    }
  }
  lines.push(
    '',
    '[resource]',
    `tile_size = Vector2i(${t.tileSize}, ${t.tileSize})`,
    'physics_layer_0/collision_layer = 1',
    'sources/0 = SubResource("atlas")',
    ''
  )
  return lines.join('\n')
}

function hasPixels(t: TilesetResult, x: number, y: number): boolean {
  const { atlas, tileSize } = t
  for (let py = y * tileSize; py < (y + 1) * tileSize; py++) {
    for (let px = x * tileSize; px < (x + 1) * tileSize; px++) {
      if (atlas.data[(py * atlas.width + px) * 4 + 3] >= 128) return true
    }
  }
  return false
}
