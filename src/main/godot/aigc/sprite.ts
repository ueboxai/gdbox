// sharp 按需加载：和主进程其余用到它的地方一致，原生模块加载失败时只坏这一条路
import { getSharp } from '../../utils/sharpLoader'
import { buildSheet, findFrames, removeBackground, type Rgba } from './pixels'
import { applyPalette } from './style'

export async function decodeImage(input: Buffer): Promise<Rgba> {
  const sharp = await getSharp()
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return {
    width: info.width,
    height: info.height,
    data: new Uint8Array(data.buffer, data.byteOffset, data.length)
  }
}

export async function encodePng(img: Rgba): Promise<Buffer> {
  const sharp = await getSharp()
  return sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length), {
    raw: { width: img.width, height: img.height, channels: 4 }
  })
    .png({ compressionLevel: 9 })
    .toBuffer()
}

/** 放大预览（最近邻），给模型和人看小像素图用。 */
export async function previewPng(img: Rgba, minSide = 256): Promise<Buffer> {
  const sharp = await getSharp()
  const scale = Math.max(1, Math.floor(minSide / Math.min(img.width, img.height)))
  return sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length), {
    raw: { width: img.width, height: img.height, channels: 4 }
  })
    .resize(img.width * scale, img.height * scale, { kernel: 'nearest' })
    .png()
    .toBuffer()
}

export interface AnimationSpec {
  name: string
  /** 这一段动画占几帧（按阅读顺序从精灵表里依次取） */
  frames: number
  fps?: number
  loop?: boolean
}

export interface SpriteResult {
  sheetPng: Buffer
  previewPng: Buffer
  cell: { w: number; h: number }
  cols: number
  frameCount: number
  /** 实际找到的帧数和期望不符时的说明 */
  warning?: string
}

/**
 * 一张 AI 生成的角色图/精灵表 → 透明底、真像素、对齐好的精灵表。
 */
export async function processSprite(
  input: Buffer,
  options: {
    frameHeight: number
    pixelArt: boolean
    expectedFrames: number
    grid?: { cols: number; rows: number }
    palette?: string[]
  }
): Promise<SpriteResult> {
  const cleaned = removeBackground(await decodeImage(input))
  let frames = findFrames(
    cleaned,
    options.grid ? { ...options.grid, count: options.expectedFrames } : undefined
  )
  let warning: string | undefined
  if (frames.length > options.expectedFrames) {
    // 多出来的通常是零碎小块（飘开的围巾尖、杂点）：去掉面积最小的那几块，保留原来的顺序
    const area = (f: { w: number; h: number }): number => f.w * f.h
    const ranked = [...frames].sort((a, b) => area(b) - area(a))
    const keep = new Set(ranked.slice(0, options.expectedFrames))
    const dropped = ranked.slice(options.expectedFrames)
    const kept = ranked.slice(0, options.expectedFrames)
    const median = area(kept[Math.floor(kept.length / 2)])
    frames = frames.filter((f) => keep.has(f))
    // 去掉的里面有和正常帧差不多大的，说明 AI 真的多画了帧，提醒一下
    if (dropped.some((f) => area(f) > median * 0.3)) {
      warning = `The image has ${kept.length + dropped.length} frame-sized figures, expected ${options.expectedFrames}; kept the largest ${options.expectedFrames} in reading order.`
    }
  } else if (frames.length < options.expectedFrames) {
    warning = `Found ${frames.length} frame(s) in the image, expected ${options.expectedFrames}.`
  }
  if (frames.length === 0)
    throw new Error('No sprite was found in the image after removing the background.')
  const built = buildSheet(cleaned, frames, options.frameHeight, options.pixelArt)
  const { cell, cols, frameCount } = built
  const sheet = options.palette?.length ? applyPalette(built.sheet, options.palette) : built.sheet
  return {
    sheetPng: await encodePng(sheet),
    previewPng: await previewPng(sheet),
    cell,
    cols,
    frameCount,
    warning
  }
}

/**
 * Godot 4 的 SpriteFrames 资源（文本格式）。每帧是精灵表上的一块 AtlasTexture。
 * 帧不够分时，后面的动画拿到的帧会少，不会报错。
 */
export function spriteFramesTres(
  texturePath: string,
  sheet: { cell: { w: number; h: number }; cols: number; frameCount: number },
  animations: AnimationSpec[]
): string {
  const lines: string[] = []
  lines.push(`[gd_resource type="SpriteFrames" format=3]`, '')
  lines.push(`[ext_resource type="Texture2D" path="${texturePath}" id="1_sheet"]`, '')
  for (let i = 0; i < sheet.frameCount; i++) {
    const x = (i % sheet.cols) * sheet.cell.w
    const y = Math.floor(i / sheet.cols) * sheet.cell.h
    lines.push(`[sub_resource type="AtlasTexture" id="frame_${i}"]`)
    lines.push(`atlas = ExtResource("1_sheet")`)
    lines.push(`region = Rect2(${x}, ${y}, ${sheet.cell.w}, ${sheet.cell.h})`, '')
  }
  const anims: string[] = []
  let cursor = 0
  for (const a of animations) {
    const ids: number[] = []
    for (let k = 0; k < a.frames && cursor < sheet.frameCount; k++) ids.push(cursor++)
    const frames = ids
      .map((id) => `{\n"duration": 1.0,\n"texture": SubResource("frame_${id}")\n}`)
      .join(', ')
    anims.push(
      `{\n"frames": [${frames}],\n"loop": ${a.loop ?? true},\n"name": &"${a.name}",\n"speed": ${(a.fps ?? 8).toFixed(1)}\n}`
    )
  }
  lines.push('[resource]')
  lines.push(`animations = [${anims.join(', ')}]`, '')
  return lines.join('\n')
}
