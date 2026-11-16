/**
 * gen_sprite_video：视频模型出一段纯色底的角色动作 → 抽帧 → 抠底 → 找循环点 → 拉回漂移 → SpriteFrames。
 *
 * 和 `gen_sprite` 的分工：gen_sprite 一张图出 4~8 帧，便宜，适合像素风小动作；这个按秒付视频的钱，
 * 换来十几二十帧连贯的动作，适合流畅动画、复杂动作和特效。
 *
 * 几处刻意的设计：
 * - **同一角色的每段动作都用同一张定稿图当首帧**，循环动作还把它当尾帧。不这样，几段动作之间角色
 *   长得不一样；首尾同一张图，模型自己就把循环接上了。所以生成时定稿图必填。
 * - **原始视频留在 .gdbox/raw/，处理参数记在 .gdbox/sprite-video/<name>.json**。换帧率、换帧段、换帧高
 *   重新加工都不用再花钱：不给 description 就是拿上次那段视频重做。
 * - **一个角色的几段动作拼在同一张图集、同一个 .tres 里**，格子统一大小，按重心和脚底对齐，
 *   切动画时角色不会原地跳一下。每段动作单独的一行帧留在 .gdbox/sprite-video/<name>/，拼图集时读回来。
 * - **回执从写出去的文件里读回来**（AGENTS §5.14），质检问题写在第一行。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { z } from 'zod'

import { defineTool, type UnrealAgentTool } from '../defineTool'
import { encodeVideoJob, generateVideo, resumeVideo, type GeneratedVideo } from '../../../ai/video'
import { readSettings } from '../../../ai/store'
import { loadReferenceImage, VIDEO_REFERENCE_BUDGET } from '../aigc/references'
import { describeMissingVideoModel, listVideoModels, pickVideoModel } from '../aigc/videoModels'
import { ProjectAssets } from '../../../godot/aigc/projectAssets'
import { borderColor } from '../../../godot/aigc/pixels'
import { decodeImage, encodePng, previewPng, spriteFramesTres } from '../../../godot/aigc/sprite'
import { applyPalette } from '../../../godot/aigc/style'
import { forEachVideoFrame } from '../../../godot/aigc/videoFrames'
import {
  composeStrip,
  findLoopPoint,
  keyFrame,
  packStrips,
  pickEvenly,
  qualityNotes,
  removeHorizontalDrift,
  stripFromImage,
  toLayer,
  type AnimationStrip,
  type FrameLayer,
  type KeyColor
} from '../../../godot/aigc/videoSprite'
import {
  projectPathInput,
  requireProjectDir,
  resolveResPath,
  SPENDING_NOTE,
  styleStoreFor,
  type PresetsDirResolver
} from './shared'

const Input = z.object({
  project_path: projectPathInput,
  name: z
    .string()
    .min(1)
    .describe('英文角色名，如 "hero"。同一角色的各段动作用同一个名字，会拼进同一个 .tres'),
  action: z
    .string()
    .min(1)
    .describe('动作名，也是 SpriteFrames 里的动画名，如 idle / run / attack'),
  description: z
    .string()
    .optional()
    .describe(
      '要生成新视频时必填：这段动作具体怎么做（"挥剑从右上砍到左下，收剑回站姿"）。' +
        '不给且没有 source_video / resume_job_id 时，拿这个动作上次的视频免费重新加工'
    ),
  reference_image: z
    .string()
    .optional()
    .describe(
      '生成时必填：角色定稿图（res:// 或绝对路径），纯绿底、全身、和视频同样的朝向。' +
        '同一角色的所有动作用同一张'
    ),
  source_video: z
    .string()
    .optional()
    .describe('直接加工一段现成的视频（res:// 或绝对路径），不调用视频模型、不花钱'),
  resume_job_id: z
    .string()
    .optional()
    .describe('接着取一个已经提交过的视频任务（上次失败或被停止时回执里给的任务号），不重新扣费'),
  mode: z
    .enum(['character', 'vfx'])
    .optional()
    .describe(
      'character（默认）：绿底，按颜色抠。vfx：黑底特效（火焰、光效），按亮度抠，保留半透明'
    ),
  loop: z
    .boolean()
    .optional()
    .describe('循环动作（默认 true）：自动找循环点截断。攻击、死亡这类一次性动作给 false'),
  fps: z.number().int().min(4).max(30).optional().describe('抽帧和播放帧率，默认 12'),
  max_frames: z
    .number()
    .int()
    .min(2)
    .max(48)
    .optional()
    .describe('最多保留几帧，多了均匀抽，默认 24'),
  start: z.number().min(0).optional().describe('只用视频的这一段：起点（秒）'),
  end: z.number().min(0).optional().describe('只用视频的这一段：终点（秒）'),
  frame_height: z
    .number()
    .int()
    .min(16)
    .max(512)
    .optional()
    .describe(
      '角色身高（像素）。默认沿用这个角色上次的，否则取工程风格，再否则像素风 48、非像素风 128'
    ),
  pixel_art: z.boolean().optional().describe('默认取工程风格，否则 false'),
  stabilize: z.boolean().optional().describe('拉回角色在画面里的水平漂移，默认 true'),
  duration: z
    .number()
    .int()
    .min(2)
    .max(10)
    .optional()
    .describe('生成时的视频秒数，默认 4。直接乘在账单上'),
  resolution: z.enum(['480p', '720p', '1080p']).optional().describe('生成时的分辨率，默认 720p'),
  model: z.string().optional().describe('指定视频模型，不填用用户绑定的')
})

interface ManifestAnimation {
  name: string
  frames: number
  fps: number
  loop: boolean
  anchorX: number
  /** 原始视频的绝对路径：不给 description 时拿它重新加工 */
  video: string
}

interface Manifest {
  frameHeight: number
  pixelArt: boolean
  animations: ManifestAnimation[]
}

export interface GenSpriteVideoDetails {
  outputs: string[]
  frame: { w: number; h: number }
  animations: string[]
  video_path: string
  job_id?: string
  warnings: string[]
}

const DEFAULT_FPS = 12
const DEFAULT_MAX_FRAMES = 24

function manifestPath(assets: ProjectAssets, name: string): string {
  return join(assets.metaPath(), 'sprite-video', `${name}.json`)
}

function readManifest(assets: ProjectAssets, name: string): Manifest | undefined {
  try {
    return JSON.parse(readFileSync(manifestPath(assets, name), 'utf8')) as Manifest
  } catch {
    return undefined
  }
}

function stripPath(assets: ProjectAssets, name: string, action: string): string {
  return join(assets.metaPath(), 'sprite-video', name, `${action}.png`)
}

/** res:// 或绝对路径 → 绝对路径 */
function localPath(projectDir: string, path: string): string {
  if (path.startsWith('res://')) return resolveResPath(projectDir, path)
  if (!isAbsolute(path)) throw new Error(`需要 res:// 或绝对路径，收到的是 ${path}`)
  return path
}

export function buildVideoPrompt(options: {
  stylePrompt?: string
  description: string
  action: string
  mode: 'character' | 'vfx'
  loop: boolean
}): string {
  const subject = options.mode === 'vfx' ? 'The effect' : 'The character'
  return [
    options.stylePrompt ? `${options.stylePrompt}.` : '',
    `${options.description}.`,
    options.mode === 'vfx'
      ? `A 2D game visual effect: "${options.action}".`
      : `The character from the reference image performs "${options.action}" in place, side view for a 2D game.`,
    options.loop
      ? 'A seamless loop: the last frame returns to exactly the same pose as the first frame.'
      : '',
    'Locked-off static camera, no camera movement, no zoom, no cuts.',
    `${subject} stays centered and fully inside the frame at all times, never touching the edges.`,
    options.mode === 'vfx'
      ? 'Solid pure black (#000000) background everywhere, nothing else in the scene.'
      : 'Solid flat pure green (#00FF00) background everywhere, no ground, no shadow, no props, no text, even lighting. The character wears no green.'
  ]
    .filter(Boolean)
    .join(' ')
}

async function downloadVideo(url: string, signal?: AbortSignal): Promise<Buffer> {
  const response = await fetch(url, signal ? { signal } : {})
  if (!response.ok) throw new Error(`下载视频失败：HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

export function createGenSpriteVideoTool(
  presetsDir: PresetsDirResolver
): UnrealAgentTool<GenSpriteVideoDetails> {
  return defineTool<typeof Input, GenSpriteVideoDetails>({
    name: 'gen_sprite_video',
    namespace: 'godot.asset',
    risk: 'mutating',
    concurrency: 'sequential',
    description:
      '用视频模型生成一段纯色底的角色动作（或黑底特效），抽帧抠底做成 SpriteFrames：' +
      'res://assets/gen/sprites/<name>.png（透明底图集）和 <name>.tres。同一 name 的各段动作拼进同一个 .tres，' +
      '格子统一、按重心和脚底对齐。循环动作自动找循环点，自动拉回水平漂移，回执附联系表，用之前先看。' +
      '比 gen_sprite 贵得多也慢得多（一次几分钟，按秒计费），换来十几帧连贯动作；4~8 帧的像素风小动作用 gen_sprite。' +
      '生成要 description + reference_image（角色定稿图，纯绿底全身）。' +
      '不给 description 就是拿这个动作上次的视频免费重新加工（换帧率、帧段、帧高），给 source_video 加工现成视频也不花钱。' +
      '需要用户装了 ffmpeg。生成前先用 ask_user 说明要做哪些动作、各几秒。' +
      SPENDING_NOTE,
    input: Input,
    execute: async (args, ctx) => {
      const projectDir = requireProjectDir(args.project_path)
      const assets = new ProjectAssets(projectDir)
      const name = ProjectAssets.slug(args.name)
      const action = ProjectAssets.slug(args.action)
      const style = (await styleStoreFor(projectDir, presetsDir)).get()
      const manifest = readManifest(assets, name)
      const previous = manifest?.animations.find((a) => a.name === action)
      const mode = args.mode ?? 'character'
      const loop = args.loop ?? previous?.loop ?? true
      const fps = args.fps ?? DEFAULT_FPS
      const pixelArt = args.pixel_art ?? manifest?.pixelArt ?? style.pixelArt ?? false
      const frameHeight =
        args.frame_height ?? manifest?.frameHeight ?? style.frameHeight ?? (pixelArt ? 48 : 128)
      if (manifest && (manifest.frameHeight !== frameHeight || manifest.pixelArt !== pixelArt)) {
        return {
          isError: true,
          text:
            `角色 ${name} 已有的动作是按身高 ${manifest.frameHeight}px、${manifest.pixelArt ? '像素风' : '非像素风'}做的，` +
            '同一张图集里各段动作必须一致。要改就换个 name 从头做，或者不传 frame_height / pixel_art。'
        }
      }

      // —— 1. 拿到视频：续跑 / 现成视频 / 新生成 / 上次的视频 ——
      let videoPath: string
      let jobId: string | undefined
      let prompt: string | undefined
      let used: { api: string; model?: string } = { api: 'local' }
      const fetchGenerated = async (generated: GeneratedVideo): Promise<string> => {
        jobId = encodeVideoJob(generated.job)
        ctx.report({ text: '视频已生成，正在下载…' })
        let data: Buffer
        try {
          data = await downloadVideo(generated.url, ctx.signal)
        } catch (error) {
          throw new Error(
            `${error instanceof Error ? error.message : String(error)}。钱已经花了：` +
              `用 resume_job_id=${jobId} 再调一次就能取回，不要重新生成。临时地址（几小时后失效）：${generated.url}`
          )
        }
        return assets.keepRaw(`${name}_${action}_${Date.now()}.mp4`, data)
      }
      const onSubmitted = (token: string): void =>
        ctx.setAbortNote?.(
          () =>
            `视频任务 ${token} 已经提交、钱已扣：要结果用 resume_job_id=${token} 接着取，不要重新生成。`
        )

      if (args.resume_job_id?.trim()) {
        ctx.report({ text: `正在取回任务 ${args.resume_job_id} 的结果（不重新扣费）…` })
        const resumed = await resumeVideo({
          jobId: args.resume_job_id.trim(),
          ...(ctx.signal ? { signal: ctx.signal } : {}),
          onProgress: (note) => ctx.report({ text: `任务状态：${note}` })
        })
        videoPath = await fetchGenerated(resumed)
        used = { api: 'video', model: 'resume' }
      } else if (args.source_video?.trim()) {
        videoPath = localPath(projectDir, args.source_video.trim())
        if (!existsSync(videoPath))
          return { isError: true, text: `视频不存在：${args.source_video}` }
      } else if (args.description?.trim()) {
        if (!args.reference_image?.trim()) {
          return {
            isError: true,
            text:
              '生成要给 reference_image：角色定稿图（纯绿底、全身、和要的朝向一致）。' +
              '同一角色的每段动作都用这一张，几段动作里角色才长得一样。还没有就先用 generate_image 出一张让用户定。'
          }
        }
        let chosen: { providerId: string; modelId: string; label: string } | undefined
        if (args.model) {
          const available = listVideoModels(await readSettings())
          chosen = pickVideoModel(available, args.model)
          if (!chosen)
            return { isError: true, text: describeMissingVideoModel(available, args.model) }
        }
        const reference = await loadReferenceImage(
          localPath(projectDir, args.reference_image.trim()),
          VIDEO_REFERENCE_BUDGET
        )
        prompt = buildVideoPrompt({
          stylePrompt: style.prompt,
          description: args.description.trim(),
          action,
          mode,
          loop
        })
        ctx.report({ text: `正在生成「${action}」动作视频，通常要几分钟…` })
        const generated = await generateVideo({
          prompt,
          images: [
            { url: reference, role: 'first_frame' },
            // 首尾同一张：模型自己把动作收回起始姿势，循环点几乎就是最后一帧
            ...(loop ? [{ url: reference, role: 'last_frame' as const }] : [])
          ],
          duration: args.duration ?? 4,
          resolution: args.resolution ?? '720p',
          ...(chosen ? { providerId: chosen.providerId, modelId: chosen.modelId } : {}),
          ...(ctx.signal ? { signal: ctx.signal } : {}),
          onProgress: (note) => ctx.report({ text: `视频生成中：${note}` }),
          onSubmitted
        }).catch((error: unknown) => {
          const raw = error instanceof Error ? error.message : String(error)
          throw new Error(
            `${raw}
任务提交出去之后的失败（审核不过、超时）额度多半已经扣了：不要直接重试，先告诉用户原因，由他决定。`
          )
        })
        videoPath = await fetchGenerated(generated)
        used = { api: 'video', model: chosen?.label ?? 'bound' }
      } else if (previous && existsSync(previous.video)) {
        videoPath = previous.video
      } else {
        return {
          isError: true,
          text: `角色 ${name} 还没有「${action}」的视频。要生成就给 description 和 reference_image，要加工现成视频就给 source_video。`
        }
      }

      // —— 2. 抽帧、抠底、裁成图层 ——
      ctx.report({ text: '正在抽帧抠底…' })
      let key: KeyColor = [0, 255, 0]
      const layers: FrameLayer[] = []
      let empty = 0
      const extracted = await forEachVideoFrame(
        videoPath,
        {
          fps,
          ...(args.start !== undefined ? { start: args.start } : {}),
          ...(args.end !== undefined ? { end: args.end } : {}),
          ...(ctx.signal ? { signal: ctx.signal } : {})
        },
        (frame, index) => {
          // 键色只从第一帧估一次，全片共用
          if (index === 0) key = mode === 'vfx' ? [0, 0, 0] : borderColor(frame)
          const layer = toLayer(keyFrame(frame, key, mode === 'vfx' ? 'luminance' : 'chroma'), key)
          if (layer) layers.push(layer)
          else empty++
        }
      )
      if (!layers.length) {
        return {
          isError: true,
          text: `抽到 ${extracted} 帧，抠完全是空的：视频背景可能不是纯色，或者角色和背景同色。看一眼视频（analyze_video ${videoPath}）。`
        }
      }

      // —— 3. 漂移、循环点、抽帧 ——
      // 先去漂移再找循环点：角色在画面里平移着，首尾姿势再像位置也对不上
      const drift = args.stabilize === false ? 0 : removeHorizontalDrift(layers)
      const warnings: string[] = []
      let kept = layers
      if (loop) {
        const point = findLoopPoint(layers, Math.max(4, Math.round(fps * 0.4)))
        if (point.found) kept = layers.slice(0, point.end)
        else
          warnings.push(
            '没找到干净的循环点，整段保留了：首尾接不上，播放时会跳一下。可以试 start/end 截一段，或请用户决定是否重新生成。'
          )
      }
      kept = pickEvenly(kept, args.max_frames ?? DEFAULT_MAX_FRAMES)
      const strip = composeStrip(kept, frameHeight, pixelArt)
      const notes = qualityNotes(kept)
      const list = (frames: number[]): string =>
        frames.slice(0, 6).join('、') + (frames.length > 6 ? '…' : '')
      if (notes.cutOff.length)
        warnings.push(`第 ${list(notes.cutOff)} 帧角色碰到了画面边缘，多半被裁掉了一截。`)
      if (notes.spill.length)
        warnings.push(
          `第 ${list(notes.spill)} 帧还有明显的背景色残留（或者角色身上有和背景相同的颜色）。`
        )
      if (notes.flicker.length)
        warnings.push(`第 ${list(notes.flicker)} 帧和上一帧面积差三成以上，可能有闪烁或抠坏的帧。`)
      if (empty) warnings.push(`${empty} 帧抠完是空的，已跳过。`)

      // —— 4. 存这一段，按清单把这个角色的所有动作重拼一张图集 ——
      const stripAbs = stripPath(assets, name, action)
      mkdirSync(join(assets.metaPath(), 'sprite-video', name), { recursive: true })
      writeFileSync(stripAbs, await encodePng(strip.strip))
      const animations: ManifestAnimation[] = [
        ...(manifest?.animations.filter((a) => a.name !== action) ?? []),
        { name: action, frames: strip.frames, fps, loop, anchorX: strip.anchorX, video: videoPath }
      ]
      const strips: AnimationStrip[] = []
      for (const a of animations) {
        const abs = stripPath(assets, name, a.name)
        if (!existsSync(abs)) {
          return {
            isError: true,
            text: `动作 ${a.name} 的帧图 ${abs} 不见了，图集没有重拼（这一段已存好）。不传 description 重新加工一次 ${a.name} 就能补回来。`
          }
        }
        strips.push(stripFromImage(await decodeImage(readFileSync(abs)), a.frames, a.anchorX))
      }
      const packed = packStrips(strips)
      const sheet = style.palette?.length ? applyPalette(packed.sheet, style.palette) : packed.sheet
      const png = assets.path('sprites', `${name}.png`)
      const tres = assets.path('sprites', `${name}.tres`)
      assets.write(png.abs, await encodePng(sheet))
      assets.write(tres.abs, spriteFramesTres(png.res, packed, animations))
      writeFileSync(
        manifestPath(assets, name),
        JSON.stringify({ frameHeight, pixelArt, animations } satisfies Manifest, null, 2)
      )
      assets.record({
        tool: 'gen_sprite_video',
        ...used,
        ...(prompt ? { prompt } : {}),
        params: { action, mode, loop, fps, frameHeight, pixelArt, video: videoPath, jobId },
        outputs: [png.res, tres.res]
      })

      // —— 5. 回执：从写出去的文件读回来 ——
      const written = await decodeImage(readFileSync(png.abs))
      const tresText = readFileSync(tres.abs, 'utf8')
      const writtenFrames = (tresText.match(/\[sub_resource type="AtlasTexture"/g) ?? []).length
      const writtenAnims = [...tresText.matchAll(/"name": &"([^"]+)"/g)].map((m) => m[1])
      const lines = [
        ...(warnings.length
          ? [`注意（${warnings.length} 个问题）：`, ...warnings.map((w) => `- ${w}`), '']
          : []),
        `SpriteFrames：${tres.res}（图集 ${png.res}，${written.width}x${written.height}）`,
        `格子 ${packed.cell.w}x${packed.cell.h}，共 ${writtenFrames} 帧，动画：${writtenAnims.join('、')}。`,
        `「${action}」：视频抽出 ${extracted} 帧，保留 ${strip.frames} 帧，${fps} fps，${loop ? '循环' : '不循环'}` +
          (drift >= 2 ? `；拉回了 ${Math.round(drift)}px 的水平漂移` : '') +
          '。',
        '帧按脚底对齐：AnimatedSprite2D 的 offset.y 设为负的半个格子高，节点原点就在脚底。',
        pixelArt
          ? '像素风：工程需使用最近邻过滤（rendering/textures/canvas_textures/default_texture_filter=0）。'
          : '',
        `原始视频：${videoPath}${jobId ? `（任务号 ${jobId}）` : ''}。换帧率、帧段、帧高重新加工不用再花钱：不传 description 再调一次。`,
        '下附这段动作的联系表。'
      ].filter((line) => line !== '')
      return {
        text: lines.join('\n'),
        // 联系表排成 6 列的网格：一长条进上下文压缩后什么都看不清
        images: [{ data: await previewPng(packStrips([strip], 6).sheet), mimeType: 'image/png' }],
        details: {
          outputs: [png.res, tres.res],
          frame: packed.cell,
          animations: writtenAnims,
          video_path: videoPath,
          ...(jobId ? { job_id: jobId } : {}),
          warnings
        }
      }
    }
  })
}
