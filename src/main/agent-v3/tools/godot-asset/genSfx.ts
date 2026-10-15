/**
 * gen_sfx：本地 sfxr 合成复古游戏音效，离线、免费、瞬间出。
 *
 * 给了 description、并且「音乐」绑的是 ElevenLabs 时，改用它的音效接口按描述生成（同一把密钥，
 * 见 `ai/soundEffect.ts`），出来的 MP3 转成 WAV。没绑或不是 ElevenLabs 就用本地合成 ——
 * 不让「没配音效服务」挡住出声。模型听不见结果，所以一次出几个候选让用户挑。
 */

import { z } from 'zod'

import { defineTool, type UnrealAgentTool } from '../defineTool'
import { ProjectAssets } from '../../../godot/aigc/projectAssets'
import { makeSfx, SFX_KINDS } from '../../../godot/aigc/sfxr'
import { generateSoundEffect, supportsSoundEffects } from '../../../ai/soundEffect'
import { decodeMp3, encodeWav } from '../../../godot/aigc/musicLoop'
import { boundProvider, modelUsed, projectPathInput, requireProjectDir, SPENDING_NOTE } from './shared'

const Input = z.object({
  project_path: projectPathInput,
  name: z.string().min(1).describe('英文文件名，如 "jump"、"coin_pickup"'),
  kind: z.enum(SFX_KINDS).describe('合成预设（本地合成用；按描述生成时也作为兜底）'),
  description: z
    .string()
    .max(450)
    .optional()
    .describe('按描述用 AI 生成，英文效果最好，如 "short metallic coin pickup chime"。只有用户绑了 ElevenLabs 音乐来源时生效'),
  seconds: z.number().min(0.5).max(22).optional().describe('按描述生成时的时长（秒）。不给由服务商决定'),
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
      '给 description 且用户的「音乐」绑的是 ElevenLabs 时改为按描述 AI 生成（花用户额度，' +
      SPENDING_NOTE +
      '）；否则仍是本地合成，回话里会说明用的是哪一种。',
    input: Input,
    execute: async (args, ctx) => {
      const projectDir = requireProjectDir(args.project_path)
      const assets = new ProjectAssets(projectDir)
      const name = ProjectAssets.slug(args.name)
      const count = args.count ?? 3

      const bound = args.description ? await boundProvider('music') : undefined
      if (args.description && bound && supportsSoundEffects(bound.provider)) {
        const outputs: string[] = []
        for (let i = 0; i < count; i++) {
          ctx.report({ text: `正在生成第 ${i + 1}/${count} 个音效…` })
          const mp3 = await generateSoundEffect(bound.provider, args.description, args.seconds, ctx.signal)
          const file = assets.path('sfx', count === 1 ? `${name}.wav` : `${name}_${i + 1}.wav`)
          assets.write(file.abs, encodeWav(await decodeMp3(mp3)))
          outputs.push(file.res)
        }
        assets.record({
          tool: 'gen_sfx',
          ...modelUsed(bound.provider, 'sound-generation'),
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
        ? '（没有可用的 AI 音效服务 —— 要按描述生成，请用户在偏好设置里把「音乐」绑到 ElevenLabs；这次用的是本地合成）\n'
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
