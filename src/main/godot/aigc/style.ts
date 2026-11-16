import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Rgba } from './pixels'

/**
 * 风格包：让一个工程里生成的东西看起来是一套。
 *
 * 实验里风格靠人自觉：有人忘了带前缀，画风就跑偏；几张图像素密度不一样。
 * 所以风格写进工程（.gdbox/style.json），每次生成自动带上；满意的风格可以存成预设，新工程一键套用。
 */
export interface StylePack {
  /** 每次生图都加在描述前面的风格描述 */
  prompt?: string
  pixelArt?: boolean
  /** 角色帧高（像素） */
  frameHeight?: number
  tileSize?: number
  /** 限定调色板，#RRGGBB；生成的图会映射到最接近的颜色 */
  palette?: string[]
  /** 风格参考图，res:// 路径 */
  references?: string[]
}

export class StyleStore {
  constructor(
    private readonly projectDir: string,
    private readonly presetsDir: string
  ) {}

  private get file(): string {
    return join(this.projectDir, '.gdbox', 'style.json')
  }

  get(): StylePack {
    try {
      return JSON.parse(readFileSync(this.file, 'utf8')) as StylePack
    } catch {
      return {}
    }
  }

  set(patch: StylePack): StylePack {
    const next = { ...this.get(), ...patch }
    for (const k of Object.keys(next) as (keyof StylePack)[]) if (next[k] === null) delete next[k]
    mkdirSync(dirname(this.file), { recursive: true })
    const ignore = join(this.projectDir, '.gdbox', '.gdignore')
    if (!existsSync(ignore)) writeFileSync(ignore, '')
    writeFileSync(this.file, JSON.stringify(next, null, 2))
    return next
  }

  listPresets(): string[] {
    if (!existsSync(this.presetsDir)) return []
    return readdirSync(this.presetsDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -5))
  }

  /** 预设不带参考图路径：那是工程内的路径，换了工程就不存在了。参考图本身随预设一起拷。 */
  savePreset(name: string): string {
    const style = this.get()
    mkdirSync(this.presetsDir, { recursive: true })
    const refs = (style.references ?? []).flatMap((r) => {
      const abs = join(this.projectDir, r.replace(/^res:\/\//, ''))
      return existsSync(abs)
        ? [{ name: r.split('/').pop()!, data: readFileSync(abs).toString('base64') }]
        : []
    })
    const file = join(this.presetsDir, `${name}.json`)
    writeFileSync(
      file,
      JSON.stringify({ ...style, references: undefined, referenceImages: refs }, null, 2)
    )
    return file
  }

  /** 套用预设：参考图写进本工程的 res://assets/style/。 */
  loadPreset(name: string): StylePack {
    const file = join(this.presetsDir, `${name}.json`)
    if (!existsSync(file))
      throw new Error(
        `No style preset named "${name}". Available: ${this.listPresets().join(', ') || 'none'}`
      )
    const preset = JSON.parse(readFileSync(file, 'utf8')) as StylePack & {
      referenceImages?: { name: string; data: string }[]
    }
    const references = (preset.referenceImages ?? []).map((img) => {
      const rel = `assets/style/${img.name}`
      const abs = join(this.projectDir, rel)
      mkdirSync(dirname(abs), { recursive: true })
      writeFileSync(abs, Buffer.from(img.data, 'base64'))
      return `res://${rel}`
    })
    const rest: StylePack & { referenceImages?: unknown } = { ...preset }
    delete rest.referenceImages
    return this.set({ ...rest, references })
  }
}

export function summarizeStyle(s: StylePack): string {
  const parts = [
    s.prompt ? `prompt "${s.prompt}"` : '',
    s.pixelArt !== undefined ? (s.pixelArt ? 'pixel art' : 'not pixel art') : '',
    s.frameHeight ? `frame height ${s.frameHeight}px` : '',
    s.tileSize ? `tile ${s.tileSize}px` : '',
    s.palette?.length ? `palette ${s.palette.join(' ')}` : '',
    s.references?.length ? `references ${s.references.join(', ')}` : ''
  ].filter(Boolean)
  return parts.length ? parts.join('; ') : 'No style set.'
}

// ---------- 调色板 ----------

export function parseHex(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) throw new Error(`Not a #RRGGBB color: ${hex}`)
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const toHex = (r: number, g: number, b: number): string =>
  `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`

/** 每个不透明像素换成调色板里最接近的颜色。 */
export function applyPalette(img: Rgba, palette: string[]): Rgba {
  if (!palette.length) return img
  const colors = palette.map(parseHex)
  const out: Rgba = { width: img.width, height: img.height, data: img.data.slice() }
  const d = out.data
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue
    let best = colors[0]
    let bestDist = Infinity
    for (const c of colors) {
      const dist = (d[i] - c[0]) ** 2 + (d[i + 1] - c[1]) ** 2 + (d[i + 2] - c[2]) ** 2
      if (dist < bestDist) {
        bestDist = dist
        best = c
      }
    }
    d[i] = best[0]
    d[i + 1] = best[1]
    d[i + 2] = best[2]
  }
  return out
}

/** 从一张满意的图里提取调色板：量化后取出现最多的几种颜色，相近的合并。 */
export function extractPalette(img: Rgba, maxColors = 16): string[] {
  const counts = new Map<number, number>()
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] < 128) continue
    const key = ((img.data[i] >> 3) << 10) | ((img.data[i + 1] >> 3) << 5) | (img.data[i + 2] >> 3)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const picked: [number, number, number][] = []
  for (const [key] of [...counts].sort((a, b) => b[1] - a[1])) {
    const c: [number, number, number] = [
      ((key >> 10) & 31) * 8 + 4,
      ((key >> 5) & 31) * 8 + 4,
      (key & 31) * 8 + 4
    ]
    if (picked.some((p) => (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2 < 24 * 24))
      continue
    picked.push(c)
    if (picked.length >= maxColors) break
  }
  return picked.map(([r, g, b]) => toHex(r, g, b))
}
