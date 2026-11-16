/**
 * gen_sfx：本地 sfxr 合成复古游戏音效，离线、免费、瞬间出。
 *
 * 给了 description 且绑了「音效生成」时按描述云端生成。音乐来源不借来用：音效是单独的
 * 接口和模型，借音乐的绑定只会把音乐模型发给音效接口、被服务商拒收。
 * 云端 WAV 与回执缓存在 .gdbox/ 下，防止重试重复扣费。没绑则用本地合成 ——
 * 不让「没配音效服务」挡住出声。模型听不见结果，所以一次出几个候选让用户挑。
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

import { defineTool, type UnrealAgentTool } from '../defineTool'
import { ProjectAssets } from '../../../godot/aigc/projectAssets'
import { makeSfx, SFX_KINDS } from '../../../godot/aigc/sfxr'
import { generateSoundEffect } from '../../../ai/soundEffect'
import { boundProvider, modelUsed, projectPathInput, requireProjectDir } from './shared'

const Input = z.object({
  project_path: projectPathInput,
  name: z.string().min(1).describe('英文文件名，如 "jump"、"coin_pickup"'),
  kind: z.enum(SFX_KINDS).describe('合成预设（本地合成用；按描述生成时也作为兜底）'),
  description: z
    .string()
    .max(450)
    .optional()
    .describe(
      '按描述用 AI 生成，英文效果最好，如 "short metallic coin pickup chime"。绑定了音效生成时生效'
    ),
  seconds: z
    .number()
    .min(0.5)
    .max(22)
    .optional()
    .describe('按描述生成时的时长（秒）。不给由服务商决定'),
  count: z.number().int().min(1).max(5).optional().describe('候选个数，默认 3')
})

export interface GenSfxDetails {
  outputs: string[]
  seed: number
}

export function createGenSfxTool(): UnrealAgentTool<GenSfxDetails> {
  return defineTool<typeof Input, GenSfxDetails>({
    name: 'gen_sfx',
    namespace: 'godot.asset',
    risk: 'mutating',
    concurrency: 'sequential',
    description:
      '本地合成复古游戏音效（sfxr，离线、不花钱），写成 res://assets/gen/sfx/<name>_<n>.wav（count=1 时为 <name>.wav）。' +
      '你听不见结果：可用 inspect_audio 量一下，再请用户在资产抽屉里试听挑选。' +
      '给 description 且用户绑了音效生成时改为按描述 AI 生成（新参数花用户额度，同参数复用，' +
      '结果不满意时用 ask_user 说明问题并给出选项，不要自己决定重新付费生成；用户明确说重来就直接做。' +
      '）；否则仍是本地合成，回话里会说明用的是哪一种。',
    input: Input,
    execute: async (args, ctx) => {
      const projectDir = requireProjectDir(args.project_path)
      const assets = new ProjectAssets(projectDir)
      const name = ProjectAssets.slug(args.name)
      const count = args.count ?? 3

      const bound = args.description ? await boundProvider('sfx') : undefined
      if (args.description && bound) {
        const model = bound.modelId
        const outputs: string[] = []
        for (let i = 0; i < count; i++) {
          ctx.report({ text: `正在生成第 ${i + 1}/${count} 个音效…` })
          const generated = await generateSoundEffect(
            bound.provider,
            model,
            { prompt: args.description, seconds: args.seconds, loop: false },
            i,
            join(assets.metaPath(), 'sfx-cache'),
            ctx.signal
          )
          const file = assets.path('sfx', count === 1 ? `${name}.wav` : `${name}_${i + 1}.wav`)
          assets.write(file.abs, readFileSync(generated.path))
          outputs.push(file.res)
        }
        assets.record({
          tool: 'gen_sfx',
          ...modelUsed(bound.provider, model),
          prompt: args.description,
          params: { seconds: args.seconds, count },
          outputs
        })
        return {
          text: `已按描述生成 ${outputs.length} 个音效（ElevenLabs）：\n${outputs.join('\n')}\n请用户试听后选定一个，其余可删除。`,
          details: { outputs, seed: 0 }
        }
      }
      const fallback = args.description
        ? '（没有绑定「音效生成」—— 要按描述生成，请用户在偏好设置 → 模型来源里添加「ElevenLabs 音效」并绑到「音效生成」；这次用的是本地合成）\n'
        : ''
      // 记下种子：用户挑中第几个，以后能原样再合成一次
      const seed = Math.floor(Math.random() * 1e9)
      const outputs: string[] = []
      for (let i = 0; i < count; i++) {
        const { wav } = makeSfx(args.kind, seed + i)
        const file = assets.path('sfx', count === 1 ? `${name}.wav` : `${name}_${i + 1}.wav`)
        assets.write(file.abs, wav)
        outputs.push(file.res)
      }
      assets.record({
        tool: 'gen_sfx',
        api: 'sfxr',
        params: { kind: args.kind, seed, count },
        outputs
      })
      return {
        text: `${fallback}已写入 ${outputs.length} 个音效（本地合成）：\n${outputs.join('\n')}\n请用户试听后选定一个，其余可删除。`,
        details: { outputs, seed }
      }
    }
  })
}
