/**
 * 把 AI 生成的图加工成游戏能用的精灵。全部是纯函数，操作 RGBA 原始像素，便于测试。
 *
 * 实验里每个人都手写过这些步骤：去背景、切帧、假像素转真像素、底部对齐。
 */

export interface Rgba {
  width: number
  height: number
  /** 每像素 4 字节，行优先 */
  data: Uint8Array
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export function blank(width: number, height: number): Rgba {
  return { width, height, data: new Uint8Array(width * height * 4) }
}

const idx = (img: Rgba, x: number, y: number): number => (y * img.width + x) * 4

function colorDistance(d: Uint8Array, i: number, r: number, g: number, b: number): number {
  const dr = d[i] - r
  const dg = d[i + 1] - g
  const db = d[i + 2] - b
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

/** 边框上最常见的颜色（按 16 级量化后统计），当作背景色。 */
export function borderColor(img: Rgba): [number, number, number] {
  const counts = new Map<number, { n: number; r: number; g: number; b: number }>()
  const add = (x: number, y: number): void => {
    const i = idx(img, x, y)
    const key = ((img.data[i] >> 4) << 8) | ((img.data[i + 1] >> 4) << 4) | (img.data[i + 2] >> 4)
    const c = counts.get(key) ?? { n: 0, r: 0, g: 0, b: 0 }
    c.n++
    c.r += img.data[i]
    c.g += img.data[i + 1]
    c.b += img.data[i + 2]
    counts.set(key, c)
  }
  for (let x = 0; x < img.width; x++) {
    add(x, 0)
    add(x, img.height - 1)
  }
  for (let y = 0; y < img.height; y++) {
    add(0, y)
    add(img.width - 1, y)
  }
  let best = { n: 0, r: 0, g: 0, b: 0 }
  for (const c of counts.values()) if (c.n > best.n) best = c
  return [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)]
}

/** 已经有透明背景就不用再抠：边框上大半是透明像素。 */
export function hasTransparentBorder(img: Rgba): boolean {
  let transparent = 0
  let total = 0
  for (let x = 0; x < img.width; x++) {
    for (const y of [0, img.height - 1]) {
      total++
      if (img.data[idx(img, x, y) + 3] < 16) transparent++
    }
  }
  return transparent / total > 0.6
}

/**
 * 去背景：从四条边出发，把和背景色相近、并且跟边连通的像素抠掉。
 * 只抠连通区域，所以角色身上和背景同色的地方不会被挖洞。
 * 抠完再把紧挨着透明区、带背景色调的边缘像素去色（去绿边/去品红边）。
 */
export function removeBackground(img: Rgba, tolerance = 60, key?: [number, number, number]): Rgba {
  if (hasTransparentBorder(img)) return img
  // 视频逐帧抠时由调用方给定同一个键色：每帧各自从边框估，估出来的颜色帧间会抖，抠出的边就跟着闪
  const [br, bg, bb] = key ?? borderColor(img)
  const out: Rgba = { width: img.width, height: img.height, data: img.data.slice() }
  const d = out.data
  const { width: w, height: h } = out
  const seen = new Uint8Array(w * h)
  const stack: number[] = []
  const push = (x: number, y: number): void => {
    const p = y * w + x
    if (seen[p]) return
    seen[p] = 1
    if (colorDistance(d, p * 4, br, bg, bb) <= tolerance) stack.push(p)
  }
  for (let x = 0; x < w; x++) {
    push(x, 0)
    push(x, h - 1)
  }
  for (let y = 0; y < h; y++) {
    push(0, y)
    push(w - 1, y)
  }
  while (stack.length) {
    const p = stack.pop()!
    d[p * 4 + 3] = 0
    const x = p % w
    const y = (p - x) / w
    if (x > 0) push(x - 1, y)
    if (x < w - 1) push(x + 1, y)
    if (y > 0) push(x, y - 1)
    if (y < h - 1) push(x, y + 1)
  }

  // 背景是高饱和的抠像色（纯绿、品红这类，提示词里要求的）时，被角色包住的同色小块也是背景：
  // 胳膊和身体之间的缝就是这样。普通背景色（白、灰、天空蓝）不做这一步，免得在角色身上挖洞。
  if (Math.max(br, bg, bb) - Math.min(br, bg, bb) >= 150) {
    const tight = tolerance * 0.75
    for (let p = 0; p < w * h; p++) {
      if (d[p * 4 + 3] !== 0 && colorDistance(d, p * 4, br, bg, bb) <= tight) d[p * 4 + 3] = 0
    }
  }

  // 抠像色的残边：靠近透明区两像素以内、还带着抠像色调的像素（橙色和品红混出来的粉边）一律去掉。
  // 「抠像色调」按通道算：品红是 R、B 高 G 低，绿幕是 G 高 R、B 低。真实颜色（橙、绿围巾）不满足这个形状。
  if (Math.max(br, bg, bb) - Math.min(br, bg, bb) >= 150) {
    const key = [br, bg, bb]
    const high = [0, 1, 2].filter((c) => key[c] >= 128)
    const low = [0, 1, 2].filter((c) => key[c] < 128)
    const keyness = (i: number): number =>
      Math.min(...high.map((c) => d[i + c])) - Math.max(...low.map((c) => d[i + c]))
    const nearClear = (x: number, y: number): boolean => {
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx >= 0 && ny >= 0 && nx < w && ny < h && d[(ny * w + nx) * 4 + 3] === 0) return true
        }
      }
      return false
    }
    const fringe: number[] = []
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        if (d[i + 3] !== 0 && low.length && high.length && keyness(i) > 40 && nearClear(x, y))
          fringe.push(i)
      }
    }
    for (const i of fringe) d[i + 3] = 0
  }

  // 去色边：和透明像素相邻、颜色仍偏向背景色的像素，按接近程度降低不透明度
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = idx(out, x, y)
      if (d[i + 3] === 0) continue
      const nearTransparent =
        (x > 0 && d[i - 4 + 3] === 0) ||
        (x < w - 1 && d[i + 4 + 3] === 0) ||
        (y > 0 && d[i - w * 4 + 3] === 0) ||
        (y < h - 1 && d[i + w * 4 + 3] === 0)
      if (!nearTransparent) continue
      const dist = colorDistance(d, i, br, bg, bb)
      if (dist < tolerance * 2)
        d[i + 3] = Math.round((255 * (dist - tolerance)) / tolerance) < 128 ? 0 : 255
    }
  }
  return out
}

/** 不透明像素的包围盒；全透明返回 null。 */
export function opaqueBounds(
  img: Rgba,
  region: Rect = { x: 0, y: 0, w: img.width, h: img.height }
): Rect | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -1
  let maxY = -1
  for (let y = region.y; y < region.y + region.h; y++) {
    for (let x = region.x; x < region.x + region.w; x++) {
      if (img.data[idx(img, x, y) + 3] >= 128) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

/**
 * 找出一张精灵表里的各帧：先把每一列/每一行投影成「有没有不透明像素」，
 * 按空白间隔切开。AI 出的精灵表常常帧间距不均，按网格平分会切到角色身上，按空白切更稳。
 *
 * expected.count 是要的帧数（10 帧排成 4×3 的网格时是 10，不是 12）。
 * 按空白找到的比要的少（帧粘在一起了），才退回按 cols×rows 平分、取前 count 格；
 * 找到的多（零碎小块）交给调用方去挑。
 */
export function findFrames(
  img: Rgba,
  expected?: { cols: number; rows: number; count?: number }
): Rect[] {
  const rowsWithInk = spans(img.height, (y) => rowHasInk(img, y, 0, img.width))
  const frames: Rect[] = []
  for (const [y0, y1] of rowsWithInk) {
    const colSpans = spans(img.width, (x) => colHasInk(img, x, y0, y1))
    for (const [x0, x1] of colSpans) {
      const b = opaqueBounds(img, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
      if (b) frames.push(b)
    }
  }
  // 去掉零碎斑点（比最大帧面积的 3% 还小）
  const maxArea = Math.max(0, ...frames.map((f) => f.w * f.h))
  const kept = frames.filter((f) => f.w * f.h >= maxArea * 0.03)

  const wanted = expected ? (expected.count ?? expected.cols * expected.rows) : 0
  if (expected && kept.length < wanted) {
    const cw = img.width / expected.cols
    const ch = img.height / expected.rows
    const grid: Rect[] = []
    for (let r = 0; r < expected.rows; r++) {
      for (let c = 0; c < expected.cols; c++) {
        const cell = {
          x: Math.round(c * cw),
          y: Math.round(r * ch),
          w: Math.round(cw),
          h: Math.round(ch)
        }
        grid.push(opaqueBounds(img, cell) ?? cell)
      }
    }
    return grid.slice(0, wanted)
  }
  return kept
}

function rowHasInk(img: Rgba, y: number, x0: number, x1: number): boolean {
  for (let x = x0; x < x1; x++) if (img.data[idx(img, x, y) + 3] >= 128) return true
  return false
}

function colHasInk(img: Rgba, x: number, y0: number, y1: number): boolean {
  for (let y = y0; y < y1; y++) if (img.data[idx(img, x, y) + 3] >= 128) return true
  return false
}

/** 连续为真的区间，[开始, 结束)。间隔小于 2 像素的视为同一段（抗锯齿缝）。 */
function spans(length: number, ink: (i: number) => boolean): [number, number][] {
  const out: [number, number][] = []
  let start = -1
  let gap = 0
  for (let i = 0; i < length; i++) {
    if (ink(i)) {
      if (start < 0) start = i
      gap = 0
    } else if (start >= 0) {
      gap++
      if (gap >= 2) {
        out.push([start, i - gap + 1])
        start = -1
        gap = 0
      }
    }
  }
  if (start >= 0) out.push([start, length - gap])
  return out
}

/**
 * 区域缩小到目标尺寸，每个目标像素取对应源格子里出现最多的颜色。
 * AI 画的「像素风」其实是不规则的大方块（实验里量到 6.5 和 8.5 像素一格），
 * 取众数而不是插值，出来的才是干净的真像素，没有糊边。
 */
export function modeDownsample(img: Rgba, region: Rect, outW: number, outH: number): Rgba {
  const out = blank(outW, outH)
  const sx = region.w / outW
  const sy = region.h / outH
  const counts = new Map<number, number>()
  for (let oy = 0; oy < outH; oy++) {
    for (let ox = 0; ox < outW; ox++) {
      counts.clear()
      let opaque = 0
      let total = 0
      const x0 = Math.floor(region.x + ox * sx)
      const x1 = Math.max(x0 + 1, Math.floor(region.x + (ox + 1) * sx))
      const y0 = Math.floor(region.y + oy * sy)
      const y1 = Math.max(y0 + 1, Math.floor(region.y + (oy + 1) * sy))
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          total++
          if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue
          const i = idx(img, x, y)
          if (img.data[i + 3] < 128) continue
          opaque++
          const key =
            ((img.data[i] >> 3) << 10) | ((img.data[i + 1] >> 3) << 5) | (img.data[i + 2] >> 3)
          counts.set(key, (counts.get(key) ?? 0) + 1)
        }
      }
      if (opaque * 2 < total) continue
      let bestKey = 0
      let bestN = -1
      for (const [k, n] of counts) {
        if (n > bestN) {
          bestN = n
          bestKey = k
        }
      }
      const o = idx(out, ox, oy)
      out.data[o] = ((bestKey >> 10) & 31) * 8 + 4
      out.data[o + 1] = ((bestKey >> 5) & 31) * 8 + 4
      out.data[o + 2] = (bestKey & 31) * 8 + 4
      out.data[o + 3] = 255
    }
  }
  return out
}

/** 平滑缩放（非像素风用）：区域平均，带透明度预乘。 */
export function averageDownsample(img: Rgba, region: Rect, outW: number, outH: number): Rgba {
  const out = blank(outW, outH)
  const sx = region.w / outW
  const sy = region.h / outH
  for (let oy = 0; oy < outH; oy++) {
    for (let ox = 0; ox < outW; ox++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let n = 0
      const x0 = Math.floor(region.x + ox * sx)
      const x1 = Math.max(x0 + 1, Math.floor(region.x + (ox + 1) * sx))
      const y0 = Math.floor(region.y + oy * sy)
      const y1 = Math.max(y0 + 1, Math.floor(region.y + (oy + 1) * sy))
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          n++
          if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue
          const i = idx(img, x, y)
          const alpha = img.data[i + 3]
          r += img.data[i] * alpha
          g += img.data[i + 1] * alpha
          b += img.data[i + 2] * alpha
          a += alpha
        }
      }
      const o = idx(out, ox, oy)
      if (a > 0) {
        out.data[o] = Math.round(r / a)
        out.data[o + 1] = Math.round(g / a)
        out.data[o + 2] = Math.round(b / a)
      }
      out.data[o + 3] = n ? Math.round(a / n) : 0
    }
  }
  return out
}

/** 把一张小图贴到大图的指定位置（直接覆盖）。 */
export function blit(dst: Rgba, src: Rgba, dx: number, dy: number): void {
  for (let y = 0; y < src.height; y++) {
    const ty = dy + y
    if (ty < 0 || ty >= dst.height) continue
    for (let x = 0; x < src.width; x++) {
      const tx = dx + x
      if (tx < 0 || tx >= dst.width) continue
      const s = idx(src, x, y)
      if (src.data[s + 3] === 0) continue
      const t = idx(dst, tx, ty)
      dst.data.set(src.data.subarray(s, s + 4), t)
    }
  }
}

export interface SheetResult {
  sheet: Rgba
  cell: { w: number; h: number }
  frameCount: number
  cols: number
}

/**
 * 各帧统一比例缩到目标高度（按最高那一帧算比例，帧之间大小关系不变），
 * 放进同样大小的格子里，水平居中、脚底对齐，排成一行或多行。
 */
export function buildSheet(
  img: Rgba,
  frames: Rect[],
  targetHeight: number,
  pixelArt: boolean,
  maxCols = 8
): SheetResult {
  const tallest = Math.max(...frames.map((f) => f.h))
  const scale = targetHeight / tallest
  const scaled = frames.map((f) => {
    const w = Math.max(1, Math.round(f.w * scale))
    const h = Math.max(1, Math.round(f.h * scale))
    return pixelArt ? modeDownsample(img, f, w, h) : averageDownsample(img, f, w, h)
  })
  const cellW = Math.max(...scaled.map((s) => s.width))
  const cellH = targetHeight
  const cols = Math.min(maxCols, scaled.length)
  const rows = Math.ceil(scaled.length / cols)
  const sheet = blank(cellW * cols, cellH * rows)
  scaled.forEach((s, i) => {
    const cx = (i % cols) * cellW
    const cy = Math.floor(i / cols) * cellH
    blit(sheet, s, cx + Math.floor((cellW - s.width) / 2), cy + cellH - s.height)
  })
  return { sheet, cell: { w: cellW, h: cellH }, frameCount: scaled.length, cols }
}
