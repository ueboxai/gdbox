/**
 * inspect_audio：模型听不见声音，这里给它能客观测量的事实（时长、响度、首尾静音、削波、
 * 明暗、音高走向、循环接缝）。好不好听仍要人来听。测量见 `godot/aigc/audioInspect.ts`。
 */

import { readFileSync } from 'node:fs'
import { z } from 'zod'

import { defineTool, type UnrealAgentTool } from '../defineTool'
import { describeAudio, inspectAudio, type AudioFacts } from '../../../godot/aigc/audioInspect'
import { projectPathInput, requireProjectDir, resolveResPath } from './shared'

const Input = z.object({
  project_path: projectPathInput,
  path: z.string().min(1).describe('res:// 路径，.wav（16 位 PCM）或 .mp3')
})

export function createInspectAudioTool(): UnrealAgentTool<AudioFacts> {
  return defineTool<typeof Input, AudioFacts>({
    name: 'inspect_audio',
    namespace: 'godot.asset',
    risk: 'safe',
    description:
      '测量一个听不见的音频文件：时长、响度、削波、首尾静音、明暗、音高走向，带循环点的 WAV 还给出接缝跳变。' +
      '生成音效或音乐后先用它检查，再告诉用户可以用。只读。',
    input: Input,
    execute: async (args) => {
      const projectDir = requireProjectDir(args.project_path)
      const abs = resolveResPath(projectDir, args.path)
      const ext = args.path.split('.').pop()?.toLowerCase() ?? ''
      let data: Buffer
      try {
        data = readFileSync(abs)
      } catch {
        throw new Error(`读不到 ${args.path}。`)
      }
      const facts = await inspectAudio(data, ext)
      return { text: describeAudio(facts), details: facts }
    }
  })
}
