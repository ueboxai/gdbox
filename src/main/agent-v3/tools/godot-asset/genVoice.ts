/**
 * gen_voice：用户绑定的语音合成模型把台词逐条合成 WAV，一条台词一个文件。
 *
 * 文字、音色、模型都没变的台词跳过（`.gdbox/voice-cache.json` 记着），改一句台词不用整批重新付费。
 *
 * 音色：模型层的 `requestSpeech` 从模型配置上取 `ttsVoice`，没有按次传音色的参数。
 * 每条台词要用不同角色的声音，就在这一次调用里把模型配置复制一份、换掉音色再传下去 ——
 * 不改用户的设置，也不在模型层另开一条路。
 */

import { existsSync } from 'node:fs'
import { z } from 'zod'

import { defineTool, type UnrealAgentTool } from '../defineTool'
import { requestSpeech } from '../../../ai/speech'
import type { ProviderConfig } from '../../../ai/types'
import { ProjectAssets } from '../../../godot/aigc/projectAssets'
import { MAX_SPEECH_CHARS, splitSpeechText } from '../../../../shared/speech'
import {
  boundProvider,
  modelUsed,
  projectPathInput,
  requireProjectDir,
  SPENDING_NOTE
} from './shared'

/** 模型层回的都是 24kHz、16 位、单声道 PCM（见 shared/speech.ts 的 SpeechAudio） */
const SAMPLE_RATE = 24000

const Input = z.object({
  project_path: projectPathInput,
  lines: z
    .array(
      z.object({
        id: z.string().min(1).describe('稳定的台词 id，用作文件名，如 "intro_01"'),
        text: z.string().min(1),
        voice: z.string().optional().describe('这个说话人的音色 id；不填用设置里的音色')
      })
    )
    .min(1)
    .max(50)
})

export interface GenVoiceDetails {
  outputs: string[]
  generated: string[]
  skipped: string[]
  failed?: { id: string; error: string }
}

export const VOICE_NOT_CONFIGURED =
  '未配置语音合成模型。请用户到偏好设置 → 模型来源配置语音合成，并绑定到「语音合成」。'

/** PCM16 单声道 → WAV */
export function pcm16ToWav(pcm: Buffer, sampleRate = SAMPLE_RATE): Buffer {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

function withVoice(
  provider: ProviderConfig,
  modelId: string,
  voice: string | undefined
): ProviderConfig {
  if (!voice) return provider
  return {
    ...provider,
    models: provider.models.map((model) =>
      model.id === modelId ? { ...model, ttsVoice: voice } : model
    )
  }
}

export function createGenVoiceTool(): UnrealAgentTool<GenVoiceDetails> {
  return defineTool<typeof Input, GenVoiceDetails>({
    name: 'gen_voice',
    namespace: 'godot.asset',
    risk: 'mutating',
    concurrency: 'sequential',
    description:
      '用绑定的语音合成模型把对白/旁白逐条合成 res://assets/gen/voice/<id>.wav（24kHz 单声道）。不同角色给不同 voice。' +
      '文字和音色都没变的台词直接跳过、不花钱。' +
      SPENDING_NOTE,
    input: Input,
    execute: async (args, ctx) => {
      const projectDir = requireProjectDir(args.project_path)
      const bound = await boundProvider('tts')
      if (!bound) throw new Error(VOICE_NOT_CONFIGURED)
      const { provider, modelId } = bound
      const defaultVoice = provider.models.find((model) => model.id === modelId)?.ttsVoice ?? ''
      const assets = new ProjectAssets(projectDir)
      const cache = assets.readVoiceCache()
      const generated: string[] = []
      const durations: string[] = []
      const skipped: string[] = []
      let failed: { id: string; error: string } | undefined

      for (const line of args.lines) {
        const id = ProjectAssets.slug(line.id)
        const file = assets.path('voice', `${id}.wav`)
        const key = `${provider.id}|${modelId}|${line.voice ?? defaultVoice}|${line.text}`
        if (cache[id] === key && existsSync(file.abs)) {
          skipped.push(file.res)
          continue
        }
        ctx.report({
          text: `正在合成 ${id}（${generated.length + 1}/${args.lines.length - skipped.length}）…`
        })
        try {
          const chunks: Buffer[] = []
          const target = withVoice(provider, modelId, line.voice)
          // 超长的一句按模型层的上限拆开合成再拼起来，别让整条台词因为长度被拒
          for (const piece of splitSpeechText(line.text, MAX_SPEECH_CHARS)) {
            await requestSpeech(
              target,
              modelId,
              piece,
              ctx.signal ?? new AbortController().signal,
              (chunk) => chunks.push(Buffer.from(chunk.base64, 'base64'))
            )
          }
          const pcm = Buffer.concat(chunks)
          assets.write(file.abs, pcm16ToWav(pcm))
          cache[id] = key
          assets.writeVoiceCache(cache)
          generated.push(file.res)
          durations.push(`${file.res}（${(pcm.length / (SAMPLE_RATE * 2)).toFixed(1)}s）`)
        } catch (error) {
          if (ctx.signal?.aborted) throw error
          // 多半是配置或额度问题，后面的台词也会同样失败：停下来如实报，不接着烧
          failed = { id, error: error instanceof Error ? error.message : String(error) }
          break
        }
      }

      if (generated.length) {
        assets.record({
          tool: 'gen_voice',
          ...modelUsed(provider, modelId),
          params: { lines: args.lines },
          outputs: generated
        })
      }
      if (failed && !generated.length && !skipped.length) {
        throw new Error(`台词 ${failed.id} 合成失败：${failed.error}`)
      }

      const pending = args.lines.length - generated.length - skipped.length - (failed ? 1 : 0)
      const text = [
        failed
          ? `${generated.length} 条成功 / 1 条失败${pending ? `，其后 ${pending} 条未合成` : ''}。台词 ${failed.id} 合成失败：${failed.error}`
          : '',
        durations.length ? `已合成：\n${durations.join('\n')}` : '',
        skipped.length ? `未变化、已跳过：\n${skipped.join('\n')}` : ''
      ]
        .filter(Boolean)
        .join('\n\n')
      return {
        text,
        details: {
          outputs: [...generated, ...skipped],
          generated,
          skipped,
          ...(failed ? { failed } : {})
        }
      }
    }
  })
}
