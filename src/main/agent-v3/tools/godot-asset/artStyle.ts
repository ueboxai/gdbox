/**
 * art_style：读写工程的美术风格包（`.gdbox/style.json`），以及跨工程的风格预设。
 *
 * 生成工具每次都自动套用风格包（提示词前缀、像素风、帧高、瓦片尺寸、调色板、参考图），
 * 所以一个工程里出的东西是一套。存取逻辑见 `godot/aigc/style.ts`。
 */

import { readFileSync } from 'node:fs'
import { z } from 'zod'

import { defineTool, type UnrealAgentTool } from '../defineTool'
import { decodeImage } from '../../../godot/aigc/sprite'
import { extractPalette, parseHex, summarizeStyle, type StylePack } from '../../../godot/aigc/style'
import {
  projectPathInput,
  requireProjectDir,
  resolveResPath,
  styleStoreFor,
  type PresetsDirResolver
} from './shared'

const Input = z.object({
  project_path: projectPathInput,
  action: z.enum(['show', 'set', 'save_preset', 'load_preset', 'list_presets']),
  prompt: z.string().optional().describe('每次生图加在描述前面的风格描述'),
  pixel_art: z.boolean().optional(),
  frame_height: z.number().int().min(8).max(512).optional(),
  tile_size: z.number().int().min(8).max(128).optional(),
  palette: z.array(z.string()).optional().describe('#RRGGBB 颜色；空数组清除调色板'),
  palette_from: z.string().optional().describe('从这张 res:// 图里提取最多 16 色作调色板'),
  references: z.array(z.string()).optional().describe('res:// 风格参考图'),
  preset: z.string().optional().describe('save_preset / load_preset 的预设名')
})

export interface ArtStyleDetails {
  style?: StylePack
  presets?: string[]
}

const PRESET_NAME = /^[\w\- ]{1,64}$/

export function createArtStyleTool(
  presetsDir: PresetsDirResolver
): UnrealAgentTool<ArtStyleDetails> {
  return defineTool<typeof Input, ArtStyleDetails>({
    name: 'art_style',
    namespace: 'godot.style',
    risk: 'mutating',
    // 只看不改的两个动作不用审批
    riskFor: (args) =>
      args.action === 'show' || args.action === 'list_presets' ? 'safe' : 'mutating',
    concurrency: 'sequential',
    description:
      '读写工程美术风格（存于工程 .gdbox/style.json），gen_sprite / gen_tileset 自动套用：提示词前缀、像素风、帧高、瓦片尺寸、调色板、参考图。' +
      'set 只改给出的字段；palette_from 从用户满意的图里取调色板。save_preset / load_preset 把风格存成跨工程预设或套用到本工程（参考图拷到 res://assets/style/）。',
    input: Input,
    execute: async (args) => {
      const projectDir = requireProjectDir(args.project_path)
      const store = await styleStoreFor(projectDir, presetsDir)
      const presetName = (): string => {
        const name = args.preset?.trim()
        if (!name) throw new Error('需要 preset（预设名）。')
        // 预设名直接当文件名用，不许带路径分隔符
        if (!PRESET_NAME.test(name))
          throw new Error('预设名只能用字母、数字、下划线、连字符和空格。')
        return name
      }

      switch (args.action) {
        case 'show': {
          const style = store.get()
          return { text: summarizeStyle(style), details: { style } }
        }
        case 'set': {
          const patch: StylePack = {}
          if (args.prompt !== undefined) patch.prompt = args.prompt
          if (args.pixel_art !== undefined) patch.pixelArt = args.pixel_art
          if (args.frame_height !== undefined) patch.frameHeight = args.frame_height
          if (args.tile_size !== undefined) patch.tileSize = args.tile_size
          if (args.references !== undefined) {
            // 先校验路径：坏的参考图要到下次生成时才报错，那时已经想不起是哪次设的了
            for (const ref of args.references) resolveResPath(projectDir, ref)
            patch.references = args.references
          }
          if (args.palette !== undefined) {
            // 同理：颜色写错当场报，parseHex 抛的错误里带着那个值
            args.palette.forEach(parseHex)
            patch.palette = args.palette
          }
          if (args.palette_from) {
            const abs = resolveResPath(projectDir, args.palette_from)
            patch.palette = extractPalette(await decodeImage(readFileSync(abs)))
          }
          const style = store.set(patch)
          return { text: `风格已更新：${summarizeStyle(style)}`, details: { style } }
        }
        case 'save_preset': {
          const name = presetName()
          store.savePreset(name)
          return {
            text: `已存为预设「${name}」，任何工程都可以 load_preset 套用。`,
            details: { style: store.get() }
          }
        }
        case 'load_preset': {
          const style = store.loadPreset(presetName())
          return {
            text: `已套用预设「${args.preset}」：${summarizeStyle(style)}`,
            details: { style }
          }
        }
        default: {
          const presets = store.listPresets()
          return { text: presets.join('、') || '还没有存过预设。', details: { presets } }
        }
      }
    }
  })
}
