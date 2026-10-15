/**
 * 视频序列帧 → 精灵：视频模型出的纯色底角色动画，逐帧抠底、找循环点、拉回漂移、拼图集。
 *
 * 和 `pixels.ts` 的单图管线不同的几处，都是视频才有的问题：
 * - 键色全片统一（调用方从第一帧估一次传进来）：每帧从边框各估一次，帧间会抖，抠出来的边跟着闪。
 * - 帧先裁成「图层」（只留不透明包围盒 + 在原画面里的位置）：几十帧 720p 原图全留在内存里要上百兆。
 * - 循环点靠「哪一帧最像第一帧」找（先去漂移再比）；首尾帧给同一张图时，最后一帧就是它。
 * - 漂移只去线性趋势：模型偷偷推镜头/挪角色是慢慢平移，跑步时重心的左右摆动是动作本身，不能抹平。
 * - 缩放按角色身高（各帧包围盒高度的中位数）算，不按并集高度：跳跃的并集比站立高，按并集算会把整套动作缩小。
 *
 * 全部纯函数，操作 RGBA 原始像素，便于测试。
 */

import {
  averageDownsample,
  blank,
  blit,
  modeDownsample,
  opaqueBounds,
  removeBackground,
  type Rect,
  type Rgba
} from './pixels'

export type KeyColor = [number, number, number]

const idx = (img: Rgba, x: number, y: number): number => (y * img.width + x) * 4

const median = (values: number[]): number => {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

/** 高饱和的抠像色（纯绿、品红）：最高和最低通道差得很远 */
export const isChromaKey = (key: KeyColor): boolean => Math.max(...key) - Math.min(...key) >= 150

/** 像素有多「像键色」：键色高的通道里最低的，减去键色低的通道里最高的。绿幕上就是 g - max(r, b) */
function keynessOf(key: KeyColor): (d: Uint8Array, i: number) => number {
  const high = [0, 1, 2].filter((c) => key[c] >= 128)
  const low = [0, 1, 2].filter((c) => key[c] < 128)
  if (!high.length || !low.length) return () => 0
  return (d, i) => Math.min(...high.map((c) => d[i + c])) - Math.max(...low.map((c) => d[i + c]))
}

/**
 * 去溢色：紧挨透明区两像素内、还带键色调的像素，把键色高的通道压到不超过低通道的最大值。
 * 只动边缘一圈：角色身上真正的绿色（绿围巾）不在边上，不会被灰掉。
 */
export function despillEdges(img: Rgba, key: KeyColor): Rgba {
  if (!isChromaKey(key)) return img
  const high = [0, 1, 2].filter((c) => key[c] >= 128)
  const low = [0, 1, 2].filter((c) => key[c] < 128)
  const keyness = keynessOf(key)
  const { width: w, height: h } = img
  const d = img.data
  const nearClear = (x: number, y: number): boolean => {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || d[(ny * w + nx) * 4 + 3] === 0) return true
      }
    }
    return false
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = idx(img, x, y)
      if (d[i + 3] === 0 || keyness(d, i) <= 0 || !nearClear(x, y)) continue
      const cap = Math.max(...low.map((c) => d[i + c]))
      for (const c of high) d[i + c] = Math.min(d[i + c], cap)
    }
  }
  return img
}

/**
 * 黑底特效的抠法：亮度当透明度（取 max(r,g,b)），颜色反预乘回去。
 * 火焰、光效的半透明和发光边都留得住；角色不要用这个（黑头发、阴影会被抠成半透明）。
 */
export function luminanceKey(img: Rgba, floor = 12): Rgba {
  const out: Rgba = { width: img.width, height: img.height, data: img.data.slice() }
  const d = out.data
  for (let i = 0; i < d.length; i += 4) {
    const a = Math.max(d[i], d[i + 1], d[i + 2])
    // 压缩噪声：纯黑底上到处是 1~10 的杂色，不切掉整张图都会蒙一层灰
    if (a <= floor) {
      d[i + 3] = 0
      continue
    }
    const alpha = Math.round(((a - floor) * 255) / (255 - floor))
    d[i] = Math.round((d[i] * 255) / a)
    d[i + 1] = Math.round((d[i + 1] * 255) / a)
    d[i + 2] = Math.round((d[i + 2] * 255) / a)
    d[i + 3] = alpha
  }
  return out
}

export type KeyMode = 'chroma' | 'luminance'

/** 一帧抠完：抠像色走连通区 + 夹缝 + 残边（`removeBackground`），再去溢色；黑底特效走亮度 */
export function keyFrame(img: Rgba, key: KeyColor, mode: KeyMode, tolerance = 60): Rgba {
  if (mode === 'luminance') return luminanceKey(img)
  return despillEdges(removeBackground(img, tolerance, key), key)
}

/** 一帧裁成的图层：只留不透明包围盒，记住它在原画面里的位置 */
export interface FrameLayer {
  img: Rgba
  x: number
  y: number
  /** 下四分之一（脚那一截）不透明像素的重心 x（原画面坐标）：对齐用它，伸出去的武器、披风不会把它拽偏 */
  cx: number
  /** 不透明像素数 */
  area: number
  /** 碰到了画面边缘：角色多半被裁掉了一截 */
  touchesEdge: boolean
  /** 不透明像素里还带明显键色的比例：抠不干净 */
  spill: number
}

const SIG = 24
/** 抠完以后才算「不透明」的门槛，与 `opaqueBounds` 一致 */
const SOLID = 128

/** 抠好的整帧 → 图层；整帧都是空的返回 null */
export function toLayer(img: Rgba, key: KeyColor): FrameLayer | null {
  const bounds = opaqueBounds(img)
  if (!bounds) return null
  const crop = blank(bounds.w, bounds.h)
  let area = 0
  let sumX = 0
  let feet = 0
  const feetFrom = Math.floor(bounds.h * 0.75)
  let spilled = 0
  const keyness = keynessOf(key)
  const chroma = isChromaKey(key)
  for (let y = 0; y < bounds.h; y++) {
    for (let x = 0; x < bounds.w; x++) {
      const s = idx(img, bounds.x + x, bounds.y + y)
      crop.data.set(img.data.subarray(s, s + 4), idx(crop, x, y))
      if (img.data[s + 3] < SOLID) continue
      area++
      if (y >= feetFrom) {
        sumX += bounds.x + x
        feet++
      }
      if (chroma && keyness(img.data, s) > 60) spilled++
    }
  }
  return {
    img: crop,
    x: bounds.x,
    y: bounds.y,
    cx: feet ? sumX / feet : bounds.x + bounds.w / 2,
    area,
    touchesEdge:
      bounds.x === 0 ||
      bounds.y === 0 ||
      bounds.x + bounds.w === img.width ||
      bounds.y + bounds.h === img.height,
    spill: area ? spilled / area : 0
  }
}

function unionOf(layers: FrameLayer[]): Rect {
  const x0 = Math.min(...layers.map((l) => l.x))
  const y0 = Math.min(...layers.map((l) => l.y))
  const x1 = Math.max(...layers.map((l) => l.x + l.img.width))
  const y1 = Math.max(...layers.map((l) => l.y + l.img.height))
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/**
 * 图层贴回并集画布再缩到 SIG×SIG，每格记透明度和亮度：比对两帧姿势像不像，不受压缩噪声影响。
 * 用的是图层当前的位置，所以要先 `removeHorizontalDrift` 再找循环点 —— 否则漂移本身就让首尾对不上。
 */
function signatureOf(layer: FrameLayer, union: Rect): Float32Array {
  const canvas = blank(union.w, union.h)
  blit(canvas, layer.img, layer.x - union.x, layer.y - union.y)
  const small = averageDownsample(canvas, { x: 0, y: 0, w: union.w, h: union.h }, SIG, SIG)
  const out = new Float32Array(SIG * SIG * 2)
  for (let p = 0; p < SIG * SIG; p++) {
    const i = p * 4
    const a = small.data[i + 3] / 255
    out[p * 2] = a
    out[p * 2 + 1] =
      (a * (0.299 * small.data[i] + 0.587 * small.data[i + 1] + 0.114 * small.data[i + 2])) / 255
  }
  return out
}

function signatureDistance(a: Float32Array, b: Float32Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i])
  return sum / a.length
}

export interface LoopPoint {
  /** 保留 [0, end) 这些帧；第 end 帧就是回到开头的那一帧，不重复放 */
  end: number
  /** 找到干净的循环点了没有。没找到时 end = 全部帧数 */
  found: boolean
}

/**
 * 找循环点：第 minFrames 帧往后，最像第一帧的那一帧（连同它的下一帧和第二帧比，分得清运动方向）。
 *
 * 「像不像」的尺子是相邻两帧之间的差（动作本身每帧走多远）：最像的那帧和第一帧的差
 * 不超过相邻帧差中位数的 1.5 倍，就算接得上。比这还远，硬截出来的循环会在接缝处跳一下，
 * 不如整段保留、告诉调用方没找到。
 */
export function findLoopPoint(layers: FrameLayer[], minFrames: number): LoopPoint {
  const n = layers.length
  if (n <= minFrames) return { end: n, found: false }
  const union = unionOf(layers)
  const sigs = layers.map((l) => signatureOf(l, union))
  const steps: number[] = []
  for (let i = 1; i < n; i++) steps.push(signatureDistance(sigs[i - 1], sigs[i]))
  const step = median(steps)
  let best = -1
  let bestDistance = Infinity
  for (let i = minFrames; i < n; i++) {
    // 连下一帧一起比：只比单帧，来回摆的动作在半个周期处位置一样、方向相反，会被当成循环点
    const d =
      i + 1 < n
        ? (signatureDistance(sigs[0], sigs[i]) + signatureDistance(sigs[1], sigs[i + 1])) / 2
        : signatureDistance(sigs[0], sigs[i])
    if (d < bestDistance) {
      bestDistance = d
      best = i
    }
  }
  if (best < 0 || bestDistance > Math.max(step * 1.5, 1e-3)) return { end: n, found: false }
  return { end: best, found: true }
}

/** 帧太多时均匀抽：保留首帧，间隔尽量相等 */
export function pickEvenly<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items
  return Array.from({ length: max }, (_, k) => items[Math.floor((k * items.length) / max)])
}

/**
 * 去掉水平方向的线性漂移，返回拉回了多少像素（首尾两帧之间）。
 *
 * 只减线性趋势：慢慢平移是镜头/角色位置在跑，帧和帧之间的左右摆动是动作，留着。
 */
export function removeHorizontalDrift(layers: FrameLayer[]): number {
  const n = layers.length
  if (n < 3) return 0
  const meanT = (n - 1) / 2
  const meanX = layers.reduce((s, l) => s + l.cx, 0) / n
  let num = 0
  let den = 0
  layers.forEach((l, t) => {
    num += (t - meanT) * (l.cx - meanX)
    den += (t - meanT) ** 2
  })
  const slope = den ? num / den : 0
  layers.forEach((l, t) => {
    const shift = Math.round(-slope * (t - meanT))
    l.x += shift
    l.cx += shift
  })
  return Math.abs(slope * (n - 1))
}

export interface QualityNotes {
  /** 碰到画面边缘的帧（从 0 数） */
  cutOff: number[]
  /** 抠不干净的帧 */
  spill: number[]
  /** 不透明面积突变的帧：这一帧和上一帧比，大了或小了三成以上 */
  flicker: number[]
}

export function qualityNotes(layers: FrameLayer[]): QualityNotes {
  const notes: QualityNotes = { cutOff: [], spill: [], flicker: [] }
  layers.forEach((l, i) => {
    if (l.touchesEdge) notes.cutOff.push(i)
    if (l.spill > 0.01) notes.spill.push(i)
    if (i > 0) {
      const prev = layers[i - 1].area
      if (prev && Math.abs(l.area - prev) / prev > 0.3) notes.flicker.push(i)
    }
  })
  return notes
}

/** 一段动画的帧排成一行：格子大小统一，脚底对齐，`anchorX` 是角色重心在格子里的横坐标 */
export interface AnimationStrip {
  strip: Rgba
  cell: { w: number; h: number }
  frames: number
  anchorX: number
}

/**
 * 图层 → 一行帧。
 *
 * 所有帧按同一个比例缩：身高（各帧包围盒高度的中位数）缩到 targetHeight。
 * 先把每帧图层贴回并集大小的画布再整体缩，不逐层缩：逐层缩各自取整，帧间会差一像素地抖。
 */
export function composeStrip(
  layers: FrameLayer[],
  targetHeight: number,
  pixelArt: boolean
): AnimationStrip {
  if (!layers.length) throw new Error('没有可用的帧。')
  const union = unionOf(layers)
  const bodyHeight = median(layers.map((l) => l.img.height))
  const scale = targetHeight / bodyHeight
  const cellW = Math.max(1, Math.round(union.w * scale))
  const cellH = Math.max(1, Math.round(union.h * scale))
  const strip = blank(cellW * layers.length, cellH)
  const full = { x: 0, y: 0, w: union.w, h: union.h }
  layers.forEach((l, i) => {
    const canvas = blank(union.w, union.h)
    blit(canvas, l.img, l.x - union.x, l.y - union.y)
    const cell = pixelArt
      ? modeDownsample(canvas, full, cellW, cellH)
      : averageDownsample(canvas, full, cellW, cellH)
    blit(strip, cell, i * cellW, 0)
  })
  const anchorX = Math.round((median(layers.map((l) => l.cx)) - union.x) * scale)
  return { strip, cell: { w: cellW, h: cellH }, frames: layers.length, anchorX }
}

export interface PackedSheet {
  sheet: Rgba
  cell: { w: number; h: number }
  cols: number
  frameCount: number
}

/**
 * 同一角色的几段动画拼成一张图集，格子统一大小。
 *
 * 对齐靠每段的重心锚点和脚底：锚点放到格子正中、底边贴格子底边。不按包围盒居中 ——
 * 攻击动作的武器伸出去很远，按包围盒居中身体会往回缩，切动画时角色原地一跳。
 */
export function packStrips(strips: AnimationStrip[], maxCols = 8): PackedSheet {
  const left = Math.max(...strips.map((s) => s.anchorX))
  const right = Math.max(...strips.map((s) => s.cell.w - s.anchorX))
  const half = Math.max(left, right)
  const cellW = half * 2
  const cellH = Math.max(...strips.map((s) => s.cell.h))
  const frameCount = strips.reduce((n, s) => n + s.frames, 0)
  const cols = Math.min(maxCols, frameCount)
  const sheet = blank(cellW * cols, cellH * Math.ceil(frameCount / cols))
  let k = 0
  for (const s of strips) {
    for (let f = 0; f < s.frames; f++, k++) {
      const frame = blank(s.cell.w, s.cell.h)
      for (let y = 0; y < s.cell.h; y++) {
        const from = idx(s.strip, f * s.cell.w, y)
        frame.data.set(s.strip.data.subarray(from, from + s.cell.w * 4), y * s.cell.w * 4)
      }
      const cx = (k % cols) * cellW
      const cy = Math.floor(k / cols) * cellH
      blit(sheet, frame, cx + half - s.anchorX, cy + cellH - s.cell.h)
    }
  }
  return { sheet, cell: { w: cellW, h: cellH }, cols, frameCount }
}

/** 一行帧图（`composeStrip` 存盘后再读回来的）→ AnimationStrip */
export function stripFromImage(img: Rgba, frames: number, anchorX: number): AnimationStrip {
  return {
    strip: img,
    cell: { w: Math.round(img.width / frames), h: img.height },
    frames,
    anchorX
  }
}
