/**
 * Godot 资产生成工具共用的几件事：认工程、解析 res:// 路径、套风格包、出一张图。
 *
 * 加工管线（抠图、切帧、像素化、找循环点）在 `godot/aigc/`，与模型服务无关；
 * 这里只负责把「用户在设置里绑的那个模型」接到管线的入口上。
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

import { generateImages, resolveImageBinding } from '../../../ai/imageGeneration'
import { readSettings } from '../../../ai/store'
import type { ProviderConfig } from '../../../ai/types'
import type { Rgba } from '../../../godot/aigc/pixels'
import { applyPalette, StyleStore, type StylePack } from '../../../godot/aigc/style'

export const projectPathInput = z
  .string()
  .min(1)
  .describe('Godot 工程目录的绝对路径（含 project.godot 的那一层）')

/** 不是 Godot 工程就直接报错：写进错的目录比报错难收拾得多 */
export function requireProjectDir(projectPath: string): string {
  const dir = projectPath.trim()
  if (!existsSync(join(dir, 'project.godot'))) {
    throw new Error(`${dir} 下没有 project.godot，不是 Godot 工程。project_path 要给工程根目录。`)
  }
  return dir
}

/** res:// → 工程里的绝对路径。带 `..` 的拒绝，免得写到工程外面 */
export function resolveResPath(projectDir: string, resPath: string): string {
  if (!resPath.startsWith('res://')) throw new Error(`需要 res:// 路径，收到的是 ${resPath}`)
  const rel = resPath.slice('res://'.length)
  if (rel.split(/[\\/]/).includes('..')) throw new Error(`路径越出了工程：${resPath}`)
  return join(projectDir, rel)
}

/**
 * 跨工程的风格预设放在哪。
 *
 * 预设是用户自己的积累，和工程无关，所以不进工程目录；按需取 electron 的 userData，
 * 测试可以换成临时目录。
 */
export type PresetsDirResolver = () => Promise<string>

export const defaultPresetsDir: PresetsDirResolver = async () => {
  const { app } = await import('electron')
  return join(app.getPath('userData'), 'godot-style-presets')
}

export async function styleStoreFor(
  projectDir: string,
  presetsDir: PresetsDirResolver
): Promise<StyleStore> {
  return new StyleStore(projectDir, await presetsDir())
}

const MEDIA_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp'
}

/**
 * 风格包里的提示词前缀、参考图，和这次调用自己给的合在一起。
 *
 * 风格写进工程、每次自动带上，是原型实验里得出的：靠模型自觉带前缀，几轮之后画风就跑了。
 */
export function applyStyle(
  projectDir: string,
  style: StylePack,
  description: string,
  extraRefs: string[] = []
): { description: string; referenceImages: string[] } {
  const refs = [...new Set([...(style.references ?? []), ...extraRefs])]
  return {
    description: style.prompt ? `${style.prompt}. ${description}` : description,
    // 读不到就抛：少一张参考图出来的是「看着也行、但和整套风格无关」的图，比报错难查
    referenceImages: refs.map((ref) => {
      const abs = resolveResPath(projectDir, ref)
      let bytes: Buffer
      try {
        bytes = readFileSync(abs)
      } catch {
        throw new Error(`参考图读不到：${ref}`)
      }
      const ext = ref.split('.').pop()?.toLowerCase() ?? ''
      return `data:${MEDIA_TYPES[ext] ?? 'image/png'};base64,${bytes.toString('base64')}`
    })
  }
}

export const withPalette = (img: Rgba, style: StylePack): Rgba =>
  style.palette?.length ? applyPalette(img, style.palette) : img

/** 生成记录里的服务商与模型：.gdbox/generations.jsonl 靠它回答「这张是谁画的」 */
export interface ModelUsed {
  api: string
  model: string
}

export function modelUsed(provider: ProviderConfig, modelId: string): ModelUsed {
  return { api: provider.displayName || provider.id, model: modelId }
}

/**
 * 按用户绑定的生图模型出一张图。
 *
 * 先解析绑定再出图，并把解析出的服务商和模型显式传下去：记录里写的模型和真正出图的
 * 模型必须是同一个。没绑模型时 `resolveImageBinding` 抛的错误本身就写了去哪配。
 */
export async function generateOneImage(request: {
  prompt: string
  referenceImages: string[]
  signal?: AbortSignal
}): Promise<{ data: Buffer; used: ModelUsed }> {
  const { provider, modelId } = await resolveImageBinding({ prompt: request.prompt })
  const images = await generateImages({
    prompt: request.prompt,
    providerId: provider.id,
    modelId,
    count: 1,
    aspectRatio: '1:1',
    ...(request.referenceImages.length ? { referenceImages: request.referenceImages } : {}),
    ...(request.signal ? { signal: request.signal } : {})
  })
  const first = images[0]
  if (!first) throw new Error('生图服务没有返回图片。')
  return { data: Buffer.from(first.base64, 'base64'), used: modelUsed(provider, modelId) }
}

/** 某个角色绑定的服务商和模型；没绑或绑的模型已不在时返回 undefined */
export async function boundProvider(
  role: 'music' | 'tts'
): Promise<{ provider: ProviderConfig; modelId: string } | undefined> {
  const settings = await readSettings()
  const binding = settings.roles[role]
  if (!binding) return undefined
  const provider = settings.providers.find(
    (item) => item.id === binding.providerId && item.kind === role
  )
  if (!provider || !provider.models.some((model) => model.id === binding.modelId)) return undefined
  return { provider, modelId: binding.modelId }
}

/** 花钱工具描述末尾共用的一句：重做的决定权在用户 */
export const SPENDING_NOTE =
  '每次调用都花用户的额度；结果不满意时用 ask_user 说明问题并给出选项，不要自己决定重做；用户明确说重来就直接做。'
