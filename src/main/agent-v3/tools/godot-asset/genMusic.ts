/**
 * gen_music：用户绑定的音乐服务出整首曲子 → 找无缝循环点 → 写成带 smpl 循环块的 WAV。
 *
 * 服务商给的是带前奏和结尾的完整曲子，直接循环会有接缝。`godot/aigc/musicLoop.ts`
 * 找一对听起来最像的位置、对齐波形、交叉淡化，循环点写进 WAV 的 smpl 块；
 * Godot 导入 WAV 默认「从文件检测循环」，不用改 .import。
 *
 * 提交、续查、防重复扣费全在 `ai/music.ts` 的 `generateTaskMusic` 里：它按请求内容在
 * 工作目录记回执，同样的请求再来一次是续查而不是重新提交。工作目录放在工程的
 * `.gdbox/` 下（Godot 不导入那里），服务商的原始音频也就顺带留在了那里。
 */

import { promises as fs } from 'node:fs'
import { extname } from 'node:path'
import { z } from 'zod'

import { defineTool, type UnrealAgentTool } from '../defineTool'
import { generateTaskMusic } from '../../../ai/music'
import { makeLoopingWav } from '../../../godot/aigc/musicLoop'
import { ProjectAssets } from '../../../godot/aigc/projectAssets'
import {
  boundProvider,
  modelUsed,
  projectPathInput,
  requireProjectDir,
  SPENDING_NOTE
} from './shared'

const Input = z.object({
  project_path: projectPathInput,
  name: z.string().min(1).describe('英文文件名，如 "level1_bgm"'),
  description: z.string().min(1).max(1500).describe('情绪、曲风、乐器、速度。只做纯音乐'),
  seconds: z.number().int().min(10).max(240).optional().describe('目标循环长度（秒），默认 60'),
  loop: z.boolean().optional().describe('做成无缝循环，默认 true；一次性的短曲填 false')
})

export interface GenMusicDetails {
  outputs: string[]
  loop?: { start: number; end: number; score: number }
}

export const MUSIC_NOT_CONFIGURED =
  '未配置可用的音乐生成模型。请用户到偏好设置 → 模型来源配置音乐生成，并绑定到「音乐」。'

export function createGenMusicTool(): UnrealAgentTool<GenMusicDetails> {
  return defineTool<typeof Input, GenMusicDetails>({
    name: 'gen_music',
    namespace: 'godot.asset',
    risk: 'mutating',
    concurrency: 'sequential',
    description:
      '用绑定的音乐服务生成背景音乐，默认裁成无缝循环写成 res://assets/gen/music/<name>.wav（循环点写在文件里，Godot 导入后 AudioStreamPlayer 自动循环）；' +
      'loop=false 或找不到循环点时按原格式存为 <name>.mp3。需要一到几分钟；中断后用相同参数再调一次会续查同一任务，不会重复扣费。' +
      SPENDING_NOTE,
    input: Input,
    execute: async (args, ctx) => {
      const projectDir = requireProjectDir(args.project_path)
      const bound = await boundProvider('music')
      if (!bound) throw new Error(MUSIC_NOT_CONFIGURED)
      const seconds = args.seconds ?? 60
      const loop = args.loop ?? true
      const assets = new ProjectAssets(projectDir)
      const name = ProjectAssets.slug(args.name)
      const used = modelUsed(bound.provider, bound.modelId)

      const result = await generateTaskMusic(
        bound.provider,
        bound.modelId,
        `${args.description}. Instrumental, no vocals.${loop ? ' Steady groove suitable for looping game background music.' : ''}`,
        // 要循环的话多要一些，给找循环点留余量
        loop ? Math.round(seconds * 1.5) : seconds,
        assets.metaPath(),
        ctx.signal,
        (text) => ctx.report({ text }),
        (taskId) =>
          ctx.setAbortNote?.(
            () =>
              `音乐任务 ${taskId} 已提交。用相同参数再调一次 gen_music 会接回这个任务，不会重复扣费。`
          )
      )
      const tracks = await Promise.all(
        result.tracks.map(async (track) => ({
          data: await fs.readFile(track.path),
          ext: (extname(track.path).slice(1).toLowerCase() || 'mp3') as 'mp3' | 'wav'
        }))
      )
      if (!tracks.length) throw new Error('音乐服务没有返回音频。')

      if (loop) {
        ctx.report({ text: '正在寻找无缝循环点…' })
        // 服务商常常一次给好几首，挑循环效果最好的那首
        let best: Awaited<ReturnType<typeof makeLoopingWav>> | null = null
        for (const track of tracks) {
          try {
            const made = await makeLoopingWav(track.data, track.ext, seconds)
            if (!best || made.score > best.score) best = made
          } catch {
            // 太短或全程淡出的那首跳过
          }
        }
        if (best) {
          const file = assets.path('music', `${name}.wav`)
          assets.write(file.abs, best.wav)
          assets.record({
            tool: 'gen_music',
            ...used,
            prompt: args.description,
            params: { seconds, loop },
            outputs: [file.res]
          })
          const length = best.loopEndSec - best.loopStartSec
          return {
            text:
              `音乐：${file.res}\n无缝循环 ${best.loopStartSec.toFixed(2)}s → ${best.loopEndSec.toFixed(2)}s` +
              `（${length.toFixed(1)}s，接缝相似度 ${(best.score * 100).toFixed(0)}%）。` +
              '循环点写在 WAV 的 smpl 块里，不用改代码也不用改导入设置：.import 里的 edit/loop_mode=0 意思是「从 WAV 读循环点」，' +
              `不是关闭循环。运行时这条 AudioStreamWAV 的 loop_mode 是 1（LOOP_FORWARD）、loop_begin=${best.loopStartSample}、` +
              `loop_end=${best.loopEndSample}（采样数），要核实就用 godot_run 盯 "<播放器节点>:stream:loop_mode"。` +
              '别把 loop_begin 改成 0：那会丢掉无缝接缝，从头重播时能听出断口。请用户在资产抽屉里试听。',
            details: {
              outputs: [file.res],
              loop: { start: best.loopStartSec, end: best.loopEndSec, score: best.score }
            }
          }
        }
      }

      const first = tracks[0]
      const file = assets.path('music', `${name}.${first.ext}`)
      assets.write(file.abs, first.data)
      assets.record({
        tool: 'gen_music',
        ...used,
        prompt: args.description,
        params: { seconds, loop: false },
        outputs: [file.res]
      })
      return {
        text:
          `音乐：${file.res}` +
          (loop
            ? '\n这首曲子里没找到干净的循环点，已按原样保存。可请用户决定重出，或在导入设置里打开循环（接缝处会有跳变）。'
            : ''),
        details: { outputs: [file.res] }
      }
    }
  })
}
