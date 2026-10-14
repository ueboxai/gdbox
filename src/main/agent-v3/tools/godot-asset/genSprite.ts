/**
 * gen_sprite：AI 出一张精灵表 → 抠底 → 切帧 → 像素化/套调色板 → SpriteFrames .tres。
 *
 * 背景要求纯品红：好抠，角色又很少用这个颜色。管线见 `godot/aigc/sprite.ts`。
 */

import { z } from 'zod'

import { defineTool, type UnrealAgentTool } from '../defineTool'
import { ProjectAssets } from '../../../godot/aigc/projectAssets'
import { processSprite, spriteFramesTres } from '../../../godot/aigc/sprite'
import {
  applyStyle,
  generateOneImage,
  projectPathInput,
  requireProjectDir,
  SPENDING_NOTE,
  styleStoreFor,
  type PresetsDirResolver
} from './shared'

const Animation = z.object({
  name: z.string().min(1).describe('动画名，如 idle / run / jump'),
  frames: z.number().int().min(1).max(12),
  fps: z.number().min(1).max(60).optional(),
  loop: z.boolean().optional()
})

const Input = z.object({
  project_path: projectPathInput,
  name: z.string().min(1).describe('英文资产名，如 "hero"、"slime"'),
  description: z.string().min(1).describe('外观：角色、服装、配色、画风'),
  animations: z.array(Animation).max(8).optional().describe('默认 idle 4 帧'),
  pixel_art: z.boolean().optional().describe('默认取工程风格，否则 true'),
  frame_height: z
    .number()
    .int()
    .min(8)
    .max(512)
    .optional()
    .describe('帧高（像素）。默认取工程风格，否则像素风 32、非像素风 128'),
  facing: z.enum(['right', 'left', 'front']).optional().describe('默认 right'),
  reference: z.array(z.string()).optional().describe('res:// 风格参考图')
})

export interface GenSpriteDetails {
  outputs: string[]
  frame: { w: number; h: number }
  warning?: string
}

export function createGenSpriteTool(
  presetsDir: PresetsDirResolver
): UnrealAgentTool<GenSpriteDetails> {
  return defineTool<typeof Input, GenSpriteDetails>({
    name: 'gen_sprite',
    namespace: 'godot.asset',
    risk: 'mutating',
    concurrency: 'sequential',
    description:
      '用绑定的生图模型生成 2D 动画角色/物体，写成可直接用的 SpriteFrames：' +
      'res://assets/gen/sprites/<name>.png（透明底精灵表，按脚底对齐，像素风为真像素）和 <name>.tres（赋给 AnimatedSprite2D）。' +
      '自动套用工程风格（art_style）。同名重出原地覆盖，旧文件备份到 .gdbox/history/。返回预览图，用之前先看。' +
      SPENDING_NOTE,
    input: Input,
    execute: async (args, ctx) => {
      const projectDir = requireProjectDir(args.project_path)
      const style = (await styleStoreFor(projectDir, presetsDir)).get()
      const animations = args.animations?.length ? args.animations : [{ name: 'idle', frames: 4 }]
      const total = animations.reduce((n, a) => n + a.frames, 0)
      const cols = Math.min(4, total)
      const rows = Math.ceil(total / cols)
      const { description, referenceImages } = applyStyle(
        projectDir,
        style,
        args.description,
        args.reference
      )
      const pixelArt = args.pixel_art ?? style.pixelArt ?? true
      const frameHeight = args.frame_height ?? style.frameHeight ?? (pixelArt ? 32 : 128)
      const facing = args.facing ?? 'right'

      const sequence = animations.map((a) => `${a.frames} frames of "${a.name}"`).join(', then ')
      const prompt = [
        `Sprite sheet of ${description}.`,
        `${total} frames arranged in a grid of ${cols} columns and ${rows} rows, read left to right, top to bottom: ${sequence}.`,
        `The same character in every frame, same size and proportions, full body visible, facing ${facing}, side view for a 2D game.`,
        pixelArt
          ? 'Pixel art style with crisp pixels and a limited palette.'
          : 'Clean 2D game art.',
        'Flat solid magenta (#FF00FF) background everywhere, no ground, no shadow, no text, no frame borders, generous empty space between frames.'
      ].join(' ')

      ctx.report({ text: `正在生成精灵表（${total} 帧）…` })
      const raw = await generateOneImage({ prompt, referenceImages, signal: ctx.signal })

      const assets = new ProjectAssets(projectDir)
      const name = ProjectAssets.slug(args.name)
      // 原图留一份：以后换帧高、换调色板重新加工不用再花钱
      assets.keepRaw(`${name}_${Date.now()}.png`, raw.data)
      const sprite = await processSprite(raw.data, {
        frameHeight,
        pixelArt,
        expectedFrames: total,
        grid: { cols, rows },
        palette: style.palette
      })

      const png = assets.path('sprites', `${name}.png`)
      const tres = assets.path('sprites', `${name}.tres`)
      assets.write(png.abs, sprite.sheetPng)
      assets.write(tres.abs, spriteFramesTres(png.res, sprite, animations))
      assets.record({
        tool: 'gen_sprite',
        ...raw.used,
        prompt,
        params: { animations, pixelArt, frameHeight, facing },
        outputs: [png.res, tres.res]
      })

      const lines = [
        `SpriteFrames：${tres.res}（精灵表 ${png.res}）`,
        `帧尺寸 ${sprite.cell.w}x${sprite.cell.h}，动画：${animations.map((a) => `${a.name}(${a.frames})`).join('、')}。`,
        pixelArt
          ? '像素风：工程需使用最近邻过滤（rendering/textures/canvas_textures/default_texture_filter=0）。'
          : '',
        sprite.warning ? `注意：${sprite.warning} 看预览，帧不对就请用户决定是否重出。` : '',
        '下附放大预览。'
      ].filter(Boolean)
      return {
        text: lines.join('\n'),
        images: [{ data: sprite.previewPng, mimeType: 'image/png' }],
        details: {
          outputs: [png.res, tres.res],
          frame: sprite.cell,
          ...(sprite.warning ? { warning: sprite.warning } : {})
        }
      }
    }
  })
}
