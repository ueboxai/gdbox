/**
 * gen_tileset：AI 出一张瓦片表 → 切格、去描边、缩到 tile_size 真像素 → TileSet .tres。
 *
 * 实心瓦片默认整格碰撞；`passable` 里的序号（装饰物之类）不加碰撞。管线见 `godot/aigc/tileset.ts`。
 */

import { z } from 'zod'

import { defineTool, type UnrealAgentTool } from '../defineTool'
import { ProjectAssets } from '../../../godot/aigc/projectAssets'
import { decodeImage, encodePng, previewPng } from '../../../godot/aigc/sprite'
import { sliceTileset, tilesetTres } from '../../../godot/aigc/tileset'
import {
  applyStyle,
  generateOneImage,
  projectPathInput,
  requireProjectDir,
  SPENDING_NOTE,
  styleStoreFor,
  withPalette,
  type PresetsDirResolver
} from './shared'

const Input = z.object({
  project_path: projectPathInput,
  name: z.string().min(1).describe('英文资产名，如 "forest_tiles"'),
  style: z.string().min(1).describe('整体观感，如 "grassy forest platformer, warm colors"'),
  tiles: z
    .array(z.string().min(1))
    .min(1)
    .max(16)
    .describe('每项一块瓦片，如 "grass top"、"dirt"、"wooden plank platform"'),
  tile_size: z.number().int().min(8).max(128).optional().describe('默认取工程风格，否则 16'),
  pixel_art: z.boolean().optional().describe('默认取工程风格，否则 true'),
  passable: z
    .array(z.number().int().min(0))
    .optional()
    .describe('不加碰撞的瓦片在 tiles 里的序号（装饰物等）')
})

export interface GenTilesetDetails {
  outputs: string[]
  /** tiles[i] → 图集坐标 */
  atlas: { tile: string; x: number; y: number; collision: boolean }[]
  found: number
}

export function createGenTilesetTool(
  presetsDir: PresetsDirResolver
): UnrealAgentTool<GenTilesetDetails> {
  return defineTool<typeof Input, GenTilesetDetails>({
    name: 'gen_tileset',
    namespace: 'godot.asset',
    risk: 'mutating',
    concurrency: 'sequential',
    description:
      '用绑定的生图模型生成 TileMapLayer 用的瓦片，写成 res://assets/gen/sprites/<name>.png（图集，source id 0）和 <name>.tres（TileSet，实心瓦片整格碰撞）。' +
      '返回每块瓦片对应的图集坐标和预览图。自动套用工程风格；同名重出原地覆盖并备份。' +
      SPENDING_NOTE,
    input: Input,
    execute: async (args, ctx) => {
      const projectDir = requireProjectDir(args.project_path)
      const style = (await styleStoreFor(projectDir, presetsDir)).get()
      const { description, referenceImages } = applyStyle(projectDir, style, args.style)
      const tileSize = args.tile_size ?? style.tileSize ?? 16
      const pixelArt = args.pixel_art ?? style.pixelArt ?? true
      const cols = Math.min(4, args.tiles.length)
      const prompt = [
        `Tile sheet for a 2D side-view game, ${description}.`,
        `${args.tiles.length} separate square tiles in a grid of ${cols} columns, left to right, top to bottom: ${args.tiles.map((t, i) => `${i + 1}. ${t}`).join('; ')}.`,
        'Each full tile is a perfect square that fills its cell edge to edge and tiles seamlessly with its neighbors, no rounded corners, no dark outline around the tile.',
        'Platforms and decorations are drawn at the top of their cell at the same scale.',
        pixelArt ? 'Pixel art with crisp pixels and a limited palette.' : '',
        'Flat solid magenta (#FF00FF) background with clear gaps between tiles, no text.'
      ]
        .filter(Boolean)
        .join(' ')

      ctx.report({ text: `正在生成瓦片（${args.tiles.length} 块）…` })
      const raw = await generateOneImage({ prompt, referenceImages, signal: ctx.signal })

      const assets = new ProjectAssets(projectDir)
      const name = ProjectAssets.slug(args.name)
      assets.keepRaw(`${name}_${Date.now()}.png`, raw.data)
      const sliced = sliceTileset(await decodeImage(raw.data), tileSize, pixelArt)
      sliced.atlas = withPalette(sliced.atlas, style)

      // 请求里的序号 → 图集里的格子：按阅读顺序一一对应
      const cellOf = (i: number): number => Math.floor(i / cols) * sliced.cols + (i % cols)
      const passable = new Set((args.passable ?? []).map(cellOf))

      const png = assets.path('sprites', `${name}.png`)
      const tres = assets.path('sprites', `${name}.tres`)
      assets.write(png.abs, await encodePng(sliced.atlas))
      assets.write(tres.abs, tilesetTres(png.res, sliced, passable))
      assets.record({
        tool: 'gen_tileset',
        ...raw.used,
        prompt,
        params: { tiles: args.tiles, tileSize, pixelArt },
        outputs: [png.res, tres.res]
      })

      const atlas = args.tiles.map((tile, i) => ({
        tile,
        x: i % cols,
        y: Math.floor(i / cols),
        collision: !passable.has(cellOf(i))
      }))
      const lines = [
        `TileSet：${tres.res}（图集 ${png.res}，source id 0，瓦片 ${tileSize}px）`,
        sliced.count !== args.tiles.length
          ? `警告：图里找到 ${sliced.count} 块，要求 ${args.tiles.length} 块，下面的对应关系可能错位，先看预览。`
          : '',
        ...atlas.map(
          (a, i) => `${i}. ${a.tile} → atlas (${a.x}, ${a.y})${a.collision ? '' : '，无碰撞'}`
        ),
        '下附放大预览。'
      ].filter(Boolean)
      return {
        text: lines.join('\n'),
        images: [{ data: await previewPng(sliced.atlas, 320), mimeType: 'image/png' }],
        details: { outputs: [png.res, tres.res], atlas, found: sliced.count }
      }
    }
  })
}
