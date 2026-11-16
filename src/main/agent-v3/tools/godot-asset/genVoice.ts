/**
 * gen_voice：用户绑定的语音合成模型把台词逐条合成 WAV，一条台词一个文件。
 *
 * 文字、音色、模型、演法都没变的台词跳过（`.gdbox/voice-cache.json` 记着），改一句台词不用整批重新付费。
 *
 * 音色三选一，优先级从高到低：`role`（工程角色音色表里采用过的音色，跟着它设计时的模型走，
 * 见 `voiceDesign.ts`）→ `voice`（直接给音色 id）→ 模型配置上的默认音色。
 * 都经 `requestSpeech` 的 `options.voice` 按次传，不改用户的设置。
 */

import { existsSync } from 'node:fs'
import { z } from 'zod'

import { defineTool, type UnrealAgentTool } from '../defineTool'
import { instructionWidth, requestSpeech, supportsSpeechInstruction } from '../../../ai/speech'
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
        voice: z.string().optional().describe('这个说话人的音色 id；不填用设置里的音色'),
        role: z
          .string()
          .min(1)
          .max(40)
          .optional()
          .describe(
            '角色名，用工程角色音色表里这个角色的音色（design_voice 设计、用户确认过的），优先于 voice'
          ),
        style: z
          .string()
          .min(1)
          .max(100)
          .optional()
          .describe(
            '演法，一句话说情绪和语气，如「愤怒地吼出来」「压低声音、有些害怕」。只有阿里云 Qwen-Audio 生效；汉字算 2 个字符，合计不超过 100'
          )
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
  /** 给了演法、但模型不认，按默认语气合成了的台词 */
  styleIgnored?: string[]
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

type LineTarget = { provider: ProviderConfig; modelId: string; voice: string }

/** 每句台词 → 用哪个来源、哪个模型、哪个音色 */
async function resolveLineTargets(
  projectDir: string,
  lines: z.infer<typeof Input>['lines']
): Promise<Record<string, LineTarget>> {
  const targets: Record<string, LineTarget> = {}
  const { normalizeRole, readVoiceCast, voiceCastDir } = await import(
    '../../../godot/aigc/voiceCast'
  )
  const roles = lines.some((line) => line.role)
    ? await readVoiceCast(voiceCastDir(projectDir)!)
    : {}
  let bound: Awaited<ReturnType<typeof boundProvider>> | null = null
  for (const line of lines) {
    if (line.style && instructionWidth(line.style) > 100)
      throw new Error(`台词 ${line.id} 的 style 太长：汉字算 2 个字符，合计不能超过 100。`)
    if (line.role) {
      const name = normalizeRole(line.role)
      const entry = roles[name]?.adopted
      if (!entry) {
        const adopted = Object.keys(roles).filter((key) => roles[key].adopted)
        throw new Error(
          roles[name]?.candidate
            ? `「${name}」的音色还在试听，用户确认（adopt_voice）之后才能配音。`
            : `角色音色表里没有「${name}」。` +
              (adopted.length ? `已有：${adopted.join('、')}。` : '') +
              '要新角色先用 design_voice 设计，或者这句改填 voice。'
        )
      }
      const { castBinding } = await import('./voiceDesign')
      targets[line.id] = { ...(await castBinding(name, entry)), voice: entry.voiceId }
      continue
    }
    bound ??= await boundProvider('tts')
    if (!bound) throw new Error(VOICE_NOT_CONFIGURED)
    const { provider, modelId } = bound
    const fallback = provider.models.find((model) => model.id === modelId)?.ttsVoice ?? ''
    targets[line.id] = { provider, modelId, voice: line.voice ?? fallback }
  }
  return targets
}

export function createGenVoiceTool(): UnrealAgentTool<GenVoiceDetails> {
  return defineTool<typeof Input, GenVoiceDetails>({
    name: 'gen_voice',
    namespace: 'godot.asset',
    risk: 'mutating',
    concurrency: 'sequential',
    description:
      '用绑定的语音合成模型把对白/旁白逐条合成 res://assets/gen/voice/<id>.wav（24kHz 单声道）。' +
      '角色有设计好的音色就填 role（list_voices 可查），否则不同角色给不同 voice；要情绪就填 style。' +
      '文字、音色和演法都没变的台词直接跳过、不花钱。' +
      SPENDING_NOTE,
    input: Input,
    execute: async (args, ctx) => {
      const projectDir = requireProjectDir(args.project_path)
      // 先把每句台词用哪个来源、哪个音色定下来：缺角色、模型没配好都在花第一分钱之前报出来
      const targets = await resolveLineTargets(projectDir, args.lines)
      const assets = new ProjectAssets(projectDir)
      const cache = assets.readVoiceCache()
      const generated: string[] = []
      const durations: string[] = []
      const skipped: string[] = []
      const styleIgnored: string[] = []
      let failed: { id: string; error: string } | undefined

      for (const line of args.lines) {
        const id = ProjectAssets.slug(line.id)
        const file = assets.path('voice', `${id}.wav`)
        const { provider, modelId, voice } = targets[line.id]
        const instruction =
          line.style && supportsSpeechInstruction(modelId) ? line.style : undefined
        if (line.style && !instruction) styleIgnored.push(id)
        // 不带演法时键和以前一样，老缓存照旧命中
        const key = `${provider.id}|${modelId}|${voice}|${line.text}${instruction ? `|${instruction}` : ''}`
        if (cache[id] === key && existsSync(file.abs)) {
          skipped.push(file.res)
          continue
        }
        ctx.report({
          text: `正在合成 ${id}（${generated.length + 1}/${args.lines.length - skipped.length}）…`
        })
        try {
          const chunks: Buffer[] = []
          // 超长的一句按模型层的上限拆开合成再拼起来，别让整条台词因为长度被拒
          for (const piece of splitSpeechText(line.text, MAX_SPEECH_CHARS)) {
            await requestSpeech(
              provider,
              modelId,
              piece,
              ctx.signal ?? new AbortController().signal,
              (chunk) => chunks.push(Buffer.from(chunk.base64, 'base64')),
              { voice, instruction }
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
        const first = targets[args.lines[0].id]
        assets.record({
          tool: 'gen_voice',
          ...modelUsed(first.provider, first.modelId),
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
        skipped.length ? `未变化、已跳过：\n${skipped.join('\n')}` : '',
        // 回执如实说：没生效的演法不能让模型以为念出了那个情绪
        styleIgnored.length
          ? `当前模型不认演法，这几条按默认语气合成：${styleIgnored.join('、')}`
          : ''
      ]
        .filter(Boolean)
        .join('\n\n')
      return {
        text,
        details: {
          outputs: [...generated, ...skipped],
          generated,
          skipped,
          ...(failed ? { failed } : {}),
          ...(styleIgnored.length ? { styleIgnored } : {})
        }
      }
    }
  })
}
