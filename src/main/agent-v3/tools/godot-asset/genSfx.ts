/**
 * gen_sfx：本地 sfxr 合成复古游戏音效，离线、免费、瞬间出。
 *
 * 原型里还有一条「按描述用 AI 生成音效」的路，接的是 ElevenLabs 音效接口；本仓库的模型层
 * 没有音效这一类服务，所以这里只保留本地合成。模型听不见结果，所以一次出几个候选让用户挑。
 */

import { z } from 'zod'

import { defineTool, type UnrealAgentTool } from '../defineTool'
import { ProjectAssets } from '../../../godot/aigc/projectAssets'
import { makeSfx, SFX_KINDS } from '../../../godot/aigc/sfxr'
import { projectPathInput, requireProjectDir } from './shared'

const Input = z.object({
  project_path: projectPathInput,
  name: z.string().min(1).describe('英文文件名，如 "jump"、"coin_pickup"'),
  kind: z.enum(SFX_KINDS).describe('合成预设'),
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
      '你听不见结果：可用 inspect_audio 量一下，再请用户在资产抽屉里试听挑选。',
    input: Input,
    execute: async (args) => {
      const projectDir = requireProjectDir(args.project_path)
      const assets = new ProjectAssets(projectDir)
      const name = ProjectAssets.slug(args.name)
      const count = args.count ?? 3
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
        text: `已写入 ${outputs.length} 个音效：\n${outputs.join('\n')}\n请用户试听后选定一个，其余可删除。`,
        details: { outputs, seed }
      }
    }
  })
}
