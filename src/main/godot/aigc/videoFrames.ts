/**
 * 用用户装的 ffmpeg 把视频按帧率抽成 PNG，逐帧交给回调。
 *
 * ffmpeg 不随包（GPL，见 electron-builder.yml），找不到时 `requireFFmpeg` 抛的错误里带安装命令。
 * 抽到临时目录、一帧一帧解码再交出去：几十帧 720p 原图一次全解进内存要上百兆。
 */

import { spawn } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { requireFFmpeg } from '../../services/ffmpegPath'
import type { Rgba } from './pixels'
import { decodeImage } from './sprite'

export interface ExtractOptions {
  fps: number
  /** 从第几秒开始、到第几秒结束；不给就是整段 */
  start?: number
  end?: number
  /** 抽出来的帧高不超过这个（只缩不放）。默认 720：再高对精灵没用，只拖慢抠图 */
  maxHeight?: number
  signal?: AbortSignal
}

function run(exe: string, args: string[], signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
      ...(signal ? { signal } : {})
    })
    let output = ''
    child.stderr.on('data', (data: Buffer) => {
      output = (output + data.toString()).slice(-4000)
    })
    child.once('error', reject)
    child.once('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`ffmpeg 抽帧失败 (${code})：${output.slice(-1200)}`))
    )
  })
}

/** 抽帧并逐帧回调，返回抽到的帧数。临时目录用完就删 */
export async function forEachVideoFrame(
  videoPath: string,
  options: ExtractOptions,
  onFrame: (frame: Rgba, index: number) => void
): Promise<number> {
  const exe = await requireFFmpeg()
  const dir = await mkdtemp(join(tmpdir(), 'gdbox-frames-'))
  try {
    const maxHeight = options.maxHeight ?? 720
    const args = ['-hide_banner', '-loglevel', 'error']
    if (options.start !== undefined) args.push('-ss', String(options.start))
    if (options.end !== undefined) args.push('-to', String(options.end))
    args.push(
      '-i',
      videoPath,
      '-vf',
      `fps=${options.fps},scale=-2:'min(${maxHeight},ih)'`,
      join(dir, '%05d.png')
    )
    await run(exe, args, options.signal)
    const files = (await readdir(dir)).filter((f) => f.endsWith('.png')).sort()
    for (let i = 0; i < files.length; i++) {
      options.signal?.throwIfAborted()
      onFrame(await decodeImage(await readFile(join(dir, files[i]))), i)
    }
    return files.length
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
