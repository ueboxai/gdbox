/**
 * `gdbox screenshot` —— 把游戏画面存成用户指定的那个 PNG 文件。
 *
 * 背后是 `godot_screenshot`：起一个屏幕外的 Godot 跑若干帧，取最后一帧。
 * 不需要编辑器开着，也不碰用户正在用的那个编辑器。
 *
 * ## 这条命令交付的是文件，不是「调用成功」
 *
 * 用户要的是 `--output` 那个路径上有一张能打开的图。中间隔着路径解析、
 * 磁盘空间、权限、覆盖策略。所以流程是：
 *
 *   1. 先判目标位置（已存在且没给 --overwrite 就直接停，别白跑一趟 Godot）
 *   2. 调工具，拿到原图
 *   3. 核验：非空、是 PNG、尺寸报了的话要对得上
 *   4. 写到目标目录里的一个唯一临时文件，再原子改名发布到目标文件
 *
 * 临时文件放在目标目录而不是系统临时目录，是为了第 4 步能是同卷改名 ——
 * 跨卷的话 rename 会退化成「复制 + 删除」，中途断电就在目标路径上留下半张图。
 *
 * ## 原图从哪来
 *
 * 优先用结果里报的文件路径（`structuredContent.path`）：那是工具存在盒子
 * userData 下的原图。没有路径时退一步，用结果里的图片块 —— **只在它还是
 * PNG 时**：超过上下文预算的图会被盒子压成 JPEG，那已经不是原图了，拿它
 * 交付等于给用户一张不是他要的图。这种情况如实报错，不偷偷转码。
 *
 * ## 同机假设
 *
 * 读结果里的路径依赖盒子与 CLI 在同一台机器上 —— 对外服务只监听回环，
 * 这一条天然成立。
 */

import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, isAbsolute, resolve } from 'node:path'

import { success, type Artifact, type Envelope } from '../envelope.js'
import { GdboxError } from '../errors.js'
import { assertMatchesReported, PngError, readPngHeader } from '../png.js'
import * as runtime from '../runtime.js'

const TOOL = 'godot_screenshot'

export interface ScreenshotOptions {
  output: string
  configPath?: string
  timeoutSeconds?: number
  project?: string
  /** res:// 场景路径，不给就是主场景 */
  scene?: string
  /** 跑到第几帧再拍，不给按工具默认 */
  frames?: number
  overwrite?: boolean
  env?: NodeJS.ProcessEnv
  cwd?: string
}

export async function runScreenshot(options: ScreenshotOptions): Promise<Envelope> {
  const target = await prepareTarget(options)

  const rt = await runtime.open({
    ...(options.configPath ? { configPath: options.configPath } : {}),
    ...(options.timeoutSeconds ? { timeoutSeconds: options.timeoutSeconds } : {}),
    ...(options.env ? { env: options.env } : {})
  })

  try {
    const catalog = await runtime.catalog(rt)
    if (!catalog.some((item) => item.name === TOOL)) {
      throw new GdboxError(
        'TOOL_UNAVAILABLE',
        `GDBox 没有开放 ${TOOL}，无法截图。`,
        '在 GDBox 的「设置 → MCP」里确认暴露范围没有被命名空间白名单收得太窄。'
      )
    }

    const project = await runtime.targetProject(rt, options.project, catalog)
    if (!project) {
      throw new GdboxError(
        'PROJECT_AMBIGUOUS',
        '没有指定要截哪个工程。',
        '用 --project <工程目录> 指定，或者在工程目录里运行本命令。'
      )
    }

    // 工程目录走参数，不走请求元数据：元数据要求编辑器连着，而截图不需要编辑器
    const result = await runtime.callTool(rt, TOOL, {
      project_path: project.path,
      ...(options.scene ? { scene: options.scene } : {}),
      ...(options.frames ? { frames: options.frames } : {})
    })

    const shot = result.structuredContent ?? {}
    const original = await readOriginal(result, shot)
    const info = verify(original.bytes, original.from, shot)
    const bytes = await publish(original.bytes, target)

    const artifact: Artifact = {
      path: target,
      mimeType: 'image/png',
      bytes,
      role: 'image'
    }

    return success({
      project: { name: project.name, path: project.path },
      data: {
        output: target,
        width: info.width,
        height: info.height,
        bytes,
        // 拍的是哪个场景决定这张图能说明什么，必须跟着走
        scene: options.scene ?? null,
        frames: options.frames ?? null
      },
      artifacts: [artifact]
    })
  } finally {
    await rt.close()
  }
}

/**
 * 定下目标文件，并把该拦的先拦掉。
 *
 * 顺序有意为之：**在连接盒子之前**就判「已存在且不许覆盖」。反过来的话，
 * 用户要等完一整轮无头运行，才被告知一个第一秒就能知道的错误。
 */
async function prepareTarget(options: ScreenshotOptions): Promise<string> {
  const cwd = options.cwd ?? process.cwd()
  const raw = options.output

  if (!/\.png$/i.test(raw)) {
    throw new GdboxError(
      'INVALID_ARGUMENT',
      `--output 只接受 .png 文件，收到：${raw}`,
      '写成 .\\artifacts\\shot.png 这样。'
    )
  }

  const target = (isAbsolute(raw) ? raw : resolve(cwd, raw)).replace(/\\/g, '/')

  const exists = await fs
    .stat(target)
    .then(() => true)
    .catch(() => false)

  if (exists && !options.overwrite) {
    throw new GdboxError(
      'OUTPUT_EXISTS',
      `目标文件已经存在：${target}`,
      '换一个 --output，或者显式加 --overwrite。默认不覆盖是为了不悄悄毁掉上一张。'
    )
  }

  try {
    await fs.mkdir(dirname(target), { recursive: true })
  } catch (error) {
    throw new GdboxError(
      'OUTPUT_WRITE_FAILED',
      `建不了输出目录 ${dirname(target)}：${(error as Error).message}`
    )
  }

  return target
}

/** 拿原图的字节（来源规则见文件头） */
async function readOriginal(
  result: runtime.ToolCallResult,
  shot: Record<string, unknown>
): Promise<{ bytes: Buffer; from: string }> {
  const path = typeof shot.path === 'string' && shot.path ? shot.path : null
  if (path) {
    try {
      return { bytes: await fs.readFile(path), from: path }
    } catch (error) {
      throw new GdboxError(
        'OUTPUT_INVALID',
        `GDBox 报告截图已保存到 ${path}，但这个文件读不到：${(error as Error).message}`,
        '确认 GDBox 和本命令跑在同一台机器上 —— 这条命令要从本地磁盘读回原图。',
        'failed'
      )
    }
  }

  const images = (result.content ?? []).filter((block) => block.type === 'image')
  const png = images.find(
    (block) => block.mimeType === 'image/png' && typeof block.data === 'string'
  )
  if (png) return { bytes: Buffer.from(png.data as string, 'base64'), from: '工具返回的图片' }

  if (images.length > 0) {
    throw new GdboxError(
      'OUTPUT_INVALID',
      `GDBox 只交回了压缩过的预览图（${String(images[0].mimeType)}），没有给出原图位置。`,
      '升级 GDBox。拿预览图冒充原图会交付一张不是你要的图，这里不做。',
      'failed'
    )
  }

  // 没图也没路径：多半是工具在文字里说明了没拍成的原因，原样给出去
  throw new GdboxError(
    'OUTPUT_INVALID',
    `${TOOL} 没有返回图片：${runtime.textOf(result) || '未提供原因'}`,
    undefined,
    'failed'
  )
}

/** 核验字节。核验不过一律非零退出，绝不因为「工具说成功了」就放行 */
function verify(
  bytes: Buffer,
  from: string,
  shot: Record<string, unknown>
): { width: number; height: number } {
  try {
    const info = readPngHeader(bytes)
    assertMatchesReported(info, { width: num(shot.width), height: num(shot.height) })
    return info
  } catch (error) {
    if (error instanceof PngError) {
      throw new GdboxError('OUTPUT_INVALID', `${from}：${error.message}`, undefined, 'failed')
    }
    throw error
  }
}

/**
 * 发布到目标文件。
 *
 * 先写同目录的临时文件再改名：要么用户拿到完整的新图，要么原来那张原封不动。
 * 失败时**保留原有文件** —— 覆盖失败还把旧的毁了是最坏的结果。
 */
async function publish(bytes: Buffer, target: string): Promise<number> {
  const relay = `${target}.${randomUUID()}.tmp.png`
  try {
    await fs.writeFile(relay, bytes, { flag: 'wx' })
    await fs.rename(relay, target)

    const stats = await fs.stat(target)
    if (stats.size === 0) {
      throw new Error('发布之后目标文件是 0 字节')
    }
    return stats.size
  } catch (error) {
    throw new GdboxError(
      'OUTPUT_WRITE_FAILED',
      `图片没能交付到 ${target}：${(error as Error).message}`,
      '检查目标路径的写入权限和磁盘空间。原有文件（如果有）没有被改动。',
      'failed'
    )
  } finally {
    await fs.rm(relay, { force: true }).catch(() => undefined)
  }
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
