/**
 * @vitest-environment node
 *
 * gen_sprite_video。视频模型、ffmpeg 抽帧、下载都替身，抠图拼图集走真的（sharp）。
 *
 * 盯的是：
 *   1. 生成时首尾帧都是同一张定稿图；没给定稿图不花钱直接拦下
 *   2. 原始视频留在 .gdbox/raw/，不给 description 再调一次是拿它重做、不再生成
 *   3. 同一角色的第二段动作拼进同一个 .tres；回执里的帧数和动画是从写出去的文件读回来的
 *   4. 下载失败时把任务号交出来，不叫模型重新生成
 */

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const generateVideo = vi.fn()
const resumeVideo = vi.fn()
const forEachVideoFrame = vi.fn()

vi.mock('../../../ai/video', () => ({
  generateVideo: (...args: unknown[]) => generateVideo(...args),
  resumeVideo: (...args: unknown[]) => resumeVideo(...args),
  encodeVideoJob: (job: { id: string }) => `ark:${job.id}`
}))
vi.mock('../../../ai/store', () => ({ readSettings: async () => ({ providers: [], roles: {} }) }))
vi.mock('../../../godot/aigc/videoFrames', () => ({
  forEachVideoFrame: (...args: unknown[]) => forEachVideoFrame(...args)
}))

import { blank, type Rgba } from '../../../godot/aigc/pixels'
import { createGenSpriteVideoTool } from './genSpriteVideo'

type AnyTool = { execute: (id: string, params: unknown) => Promise<unknown> }
const presets = mkdtempSync(join(tmpdir(), 'gdbox-presets-'))
const tool = createGenSpriteVideoTool(async () => presets) as unknown as AnyTool
const run = (params: Record<string, unknown>): Promise<unknown> => tool.execute('call-1', params)
const textOf = (result: unknown): string =>
  (result as { content: { text?: string }[] }).content.map((part) => part.text ?? '').join('')
const detailsOf = <T = Record<string, unknown>>(result: unknown): T =>
  (result as { details: T }).details

function fill(img: Rgba, x0: number, y0: number, w: number, h: number, rgb: number[]): void {
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) img.data.set([...rgb, 255], (y * img.width + x) * 4)
}

/** 绿底小人，手臂按 phase 摆：周期 6 */
function frame(phase: number): Rgba {
  const img = blank(80, 80)
  fill(img, 0, 0, 80, 80, [0, 255, 0])
  fill(img, 34, 20, 12, 44, [200, 60, 40])
  fill(img, 46, 26 + phase * 3, 8, 4, [240, 200, 160])
  return img
}

/** 抽帧替身：交出 n 帧周期 6 的动作 */
function feedFrames(n: number): void {
  forEachVideoFrame.mockImplementation(
    async (_path: string, _options: unknown, onFrame: (f: Rgba, i: number) => void) => {
      for (let i = 0; i < n; i++) onFrame(frame(i % 6), i)
      return n
    }
  )
}

let project: string
let reference: string

beforeEach(async () => {
  vi.clearAllMocks()
  project = mkdtempSync(join(tmpdir(), 'gdbox-proj-'))
  writeFileSync(join(project, 'project.godot'), 'config_version=5\n')
  reference = join(project, 'hero_ref.png')
  writeFileSync(
    reference,
    await sharp({ create: { width: 8, height: 8, channels: 3, background: '#00ff00' } })
      .png()
      .toBuffer()
  )
  generateVideo.mockResolvedValue({
    url: 'https://cdn.example/v.mp4',
    job: { id: 'j1' },
    usage: null
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }))
  )
  feedFrames(13)
})

describe('gen_sprite_video', () => {
  it('没给定稿图：不调视频模型，直接说明要什么', async () => {
    await expect(
      run({ project_path: project, name: 'hero', action: 'idle', description: 'breathing' })
    ).rejects.toThrow(/reference_image/)
    expect(generateVideo).not.toHaveBeenCalled()
  })

  it('生成：首尾帧同一张定稿图，绿底提示词；原始视频留存，循环点截好，产物写进工程', async () => {
    const result = await run({
      project_path: project,
      name: 'Hero',
      action: 'idle',
      description: 'breathing slowly',
      reference_image: reference
    })
    const request = generateVideo.mock.calls[0][0] as {
      prompt: string
      images: { url: string; role: string }[]
    }
    expect(request.images.map((i) => i.role)).toEqual(['first_frame', 'last_frame'])
    expect(request.images[0].url).toBe(request.images[1].url)
    expect(request.prompt).toMatch(/#00FF00/)
    expect(request.prompt).toMatch(/seamless loop/)

    const details = detailsOf<{ outputs: string[]; video_path: string; job_id: string }>(result)
    expect(details.outputs).toEqual([
      'res://assets/gen/sprites/hero.png',
      'res://assets/gen/sprites/hero.tres'
    ])
    expect(details.video_path).toMatch(/[\\/]\.gdbox[\\/]raw[\\/]hero_idle_\d+\.mp4$/)
    expect(details.job_id).toBe('ark:j1')
    expect(readFileSync(details.video_path)).toEqual(Buffer.from([1, 2, 3]))

    const tres = readFileSync(join(project, 'assets/gen/sprites/hero.tres'), 'utf8')
    expect(tres).toContain('path="res://assets/gen/sprites/hero.png"')
    // 13 帧周期 6：截到回到首帧之前，留 6 帧
    expect((tres.match(/AtlasTexture/g) ?? []).length).toBe(6)
    expect(textOf(result)).toMatch(/保留 6 帧/)
    expect(textOf(result)).not.toMatch(/^注意/)
  })

  it('同一角色第二段动作拼进同一个 .tres；不给 description 是拿上次的视频重做、不再生成', async () => {
    await run({
      project_path: project,
      name: 'hero',
      action: 'idle',
      description: 'breathing',
      reference_image: reference
    })
    feedFrames(5)
    const second = await run({
      project_path: project,
      name: 'hero',
      action: 'attack',
      description: 'slash',
      reference_image: reference,
      loop: false
    })
    expect(generateVideo.mock.calls[1][0].images.map((i: { role: string }) => i.role)).toEqual([
      'first_frame'
    ])
    expect(detailsOf<{ animations: string[] }>(second).animations).toEqual(['idle', 'attack'])
    const tres = readFileSync(join(project, 'assets/gen/sprites/hero.tres'), 'utf8')
    expect((tres.match(/AtlasTexture/g) ?? []).length).toBe(11)

    generateVideo.mockClear()
    feedFrames(13)
    const redo = await run({ project_path: project, name: 'hero', action: 'idle', fps: 8 })
    expect(generateVideo).not.toHaveBeenCalled()
    expect(textOf(redo)).toMatch(/8 fps/)
    expect(detailsOf<{ animations: string[] }>(redo).animations).toEqual(['attack', 'idle'])
  })

  it('换身高要换名字：同一图集里各段动作比例必须一致', async () => {
    await run({
      project_path: project,
      name: 'hero',
      action: 'idle',
      description: 'breathing',
      reference_image: reference
    })
    await expect(
      run({ project_path: project, name: 'hero', action: 'idle', frame_height: 64 })
    ).rejects.toThrow(/换个 name/)
  })

  it('下载失败：把任务号交出来，叫用 resume_job_id 取回而不是重新生成', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('gone', { status: 404 }))
    )
    await expect(
      run({
        project_path: project,
        name: 'hero',
        action: 'idle',
        description: 'breathing',
        reference_image: reference
      })
    ).rejects.toThrow(/resume_job_id=ark:j1/)
    expect(existsSync(join(project, 'assets/gen/sprites/hero.tres'))).toBe(false)
  })

  it('碰到画面边缘的帧：第一行就是注意，不是成功', async () => {
    forEachVideoFrame.mockImplementation(
      async (_p: string, _o: unknown, onFrame: (f: Rgba, i: number) => void) => {
        for (let i = 0; i < 6; i++) {
          const img = frame(i)
          fill(img, 34, 20, 12, 60, [200, 60, 40])
          onFrame(img, i)
        }
        return 6
      }
    )
    const result = await run({
      project_path: project,
      name: 'hero',
      action: 'idle',
      source_video: reference,
      loop: false
    })
    expect(generateVideo).not.toHaveBeenCalled()
    expect(textOf(result).split('\n')[0]).toMatch(/^注意/)
    expect(textOf(result)).toMatch(/碰到了画面边缘/)
  })
})
