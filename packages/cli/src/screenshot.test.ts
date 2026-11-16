/** @vitest-environment node */
// 假盒子的 handle 是同步的，写盘也得同步 —— 所以除了 promises 还要一个 writeFileSync
import { promises as fs, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { run } from './cli.js'
import {
  fakePng,
  projectListTool,
  startFakeBox,
  type FakeBox,
  type FakeTool
} from './testServer.js'

const boxes: FakeBox[] = []
const dirs: string[] = []

/**
 * 每条用例一个**真实存在**的工程目录。
 *
 * 不能拿 `D:/Games/Demo` 这种编出来的路径：`--project` 会先 `stat` 它，
 * 不存在就报 INVALID_ARGUMENT 直接退出 —— 这是设计要的行为（§5：显式路径
 * 不是有效工程目录时不能进入回退），所以测试也得给真路径。
 */
let PROJECT = ''

beforeEach(async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'gdbox 工程-'))
  dirs.push(root)
  const dir = join(root, 'Demo')
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(join(dir, 'project.godot'), 'config/name="Demo"\n')
  PROJECT = dir.replace(/\\/g, '/')
})

afterEach(async () => {
  await Promise.all(boxes.splice(0).map((box) => box.close().catch(() => undefined)))
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

const TOKEN = 'test-token-0123456789'

async function tempDir(prefix = 'gdbox 截图-'): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

interface Call {
  args: Record<string, unknown>
  projectPath: string | undefined
}

/**
 * 假的 `godot_screenshot`。
 *
 * - `path`：像真工具那样把原图存在盒子自己的目录里，结果里报路径
 * - `inline`：只在图片块里交回原图（PNG）
 * - `jpeg`：只交回压缩过的预览图 —— 那不是原图，CLI 不能拿它交付
 * - `fail`：工具报错（没渲染出帧）
 */
function screenshotTool(
  calls: Call[],
  options: {
    mode?: 'path' | 'inline' | 'jpeg' | 'fail'
    boxDir?: string
    width?: number
    height?: number
    reportedWidth?: number
    missingFile?: boolean
  } = {}
): FakeTool {
  const width = options.width ?? 1152
  const height = options.height ?? 648
  return {
    name: 'godot_screenshot',
    inputSchema: { properties: { project_path: { type: 'string' } } },
    meta: { namespace: 'godot', risk: 'safe', projectScoped: false },
    handle: (args, projectPath) => {
      calls.push({ args, projectPath })
      const png = fakePng(width, height)
      const preview = { type: 'image', data: 'AAAA', mimeType: 'image/jpeg' }

      switch (options.mode ?? 'path') {
        case 'fail':
          return {
            content: [{ type: 'text', text: 'No frame was rendered.' }],
            isError: true,
            _meta: { unrealBox: { errorCode: 'TOOL_FAILED' } }
          }
        case 'inline':
          return {
            content: [
              { type: 'text', text: 'Frame 30 of the main scene.' },
              { type: 'image', data: png.toString('base64'), mimeType: 'image/png' }
            ]
          }
        case 'jpeg':
          return { content: [{ type: 'text', text: 'Frame 30 of the main scene.' }, preview] }
        default: {
          const saved = join(options.boxDir ?? tmpdir(), `${Date.now()}.png`)
          if (!options.missingFile) writeFileSync(saved, png)
          return {
            content: [{ type: 'text', text: 'Frame 30 of the main scene.' }, preview],
            structuredContent: {
              path: saved,
              ...(options.reportedWidth ? { width: options.reportedWidth, height } : {})
            }
          }
        }
      }
    }
  }
}

async function startBox(
  tools: FakeTool[],
  editors: Array<{ name: string; path: string; editorConnected?: boolean }> = []
): Promise<NodeJS.ProcessEnv> {
  // 一个编辑器都不连：截图是无头跑的，不该依赖编辑器
  const box = await startFakeBox({
    token: TOKEN,
    tools: [projectListTool(editors), ...tools],
    connectedProjects: editors.filter((e) => e.editorConnected).map((e) => e.path)
  })
  boxes.push(box)
  return { GDBOX_URL: box.url, GDBOX_TOKEN: TOKEN }
}

async function listing(dir: string): Promise<string[]> {
  return (await fs.readdir(dir)).sort()
}

describe('screenshot', () => {
  it('把原图交付到 --output，工程目录走参数，不需要编辑器', async () => {
    const calls: Call[] = []
    const boxDir = await tempDir('gdbox-box-')
    const out = await tempDir()
    const env = await startBox([screenshotTool(calls, { boxDir })])

    const result = await run(
      ['screenshot', '--project', PROJECT, '--output', join(out, 'shot.png'), '--json'],
      env
    )

    expect(result.exitCode).toBe(0)
    const envelope = JSON.parse(result.stdout)
    expect(envelope.data).toMatchObject({ width: 1152, height: 648, scene: null })
    expect(envelope.project).toEqual({ name: 'Demo', path: PROJECT })
    expect(envelope.artifacts[0]).toMatchObject({ mimeType: 'image/png', role: 'image' })
    expect((await fs.readFile(join(out, 'shot.png'))).readUInt32BE(16)).toBe(1152)
    expect(calls[0]).toEqual({ args: { project_path: PROJECT }, projectPath: undefined })
    // 盒子自己的那份原图不归 CLI 删
    expect(await listing(boxDir)).toHaveLength(1)
  })

  it('结果里没报路径时，用图片块里的 PNG 原图', async () => {
    const calls: Call[] = []
    const out = await tempDir()
    const env = await startBox([screenshotTool(calls, { mode: 'inline', width: 64, height: 32 })])

    const result = await run(
      ['screenshot', '--project', PROJECT, '--output', join(out, 'a.png'), '--json'],
      env
    )

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout).data).toMatchObject({ width: 64, height: 32 })
  })

  /** 压过的预览不是原图：交付它等于给用户一张不是他要的图 */
  it('只有压缩预览时拒绝交付，退出码 8，目标位置什么都不留', async () => {
    const calls: Call[] = []
    const out = await tempDir()
    const env = await startBox([screenshotTool(calls, { mode: 'jpeg' })])

    const result = await run(
      ['screenshot', '--project', PROJECT, '--output', join(out, 'a.png'), '--json'],
      env
    )

    expect(result.exitCode).toBe(8)
    expect(JSON.parse(result.stdout).error.code).toBe('OUTPUT_INVALID')
    expect(await listing(out)).toEqual([])
  })

  it('不把返回值里的 base64 图片打到输出里', async () => {
    const calls: Call[] = []
    const out = await tempDir()
    const env = await startBox([screenshotTool(calls, { mode: 'inline' })])

    const result = await run(
      ['screenshot', '--project', PROJECT, '--output', join(out, 'a.png')],
      env
    )

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('截图已保存')
    expect(result.stdout.length).toBeLessThan(1000)
  })

  it('临时文件不留在目标目录里', async () => {
    const calls: Call[] = []
    const out = await tempDir()
    const env = await startBox([screenshotTool(calls, { boxDir: await tempDir('gdbox-box-') })])

    await run(['screenshot', '--project', PROJECT, '--output', join(out, 'a.png')], env)

    expect(await listing(out)).toEqual(['a.png'])
  })

  it('目标已存在时默认不覆盖，退出码 2，原文件一个字节不动，也不去跑 Godot', async () => {
    const calls: Call[] = []
    const out = await tempDir()
    const target = join(out, 'a.png')
    await fs.writeFile(target, 'old')
    const env = await startBox([screenshotTool(calls)])

    const result = await run(
      ['screenshot', '--project', PROJECT, '--output', target, '--json'],
      env
    )

    expect(result.exitCode).toBe(2)
    expect(JSON.parse(result.stdout).error.code).toBe('OUTPUT_EXISTS')
    expect(await fs.readFile(target, 'utf8')).toBe('old')
    expect(calls).toHaveLength(0)
  })

  it('--overwrite 才覆盖', async () => {
    const calls: Call[] = []
    const out = await tempDir()
    const target = join(out, 'a.png')
    await fs.writeFile(target, 'old')
    const env = await startBox([screenshotTool(calls, { boxDir: await tempDir('gdbox-box-') })])

    const result = await run(
      ['screenshot', '--project', PROJECT, '--output', target, '--overwrite'],
      env
    )

    expect(result.exitCode).toBe(0)
    expect((await fs.readFile(target)).subarray(1, 4).toString('ascii')).toBe('PNG')
  })

  it('缺少的父目录会自动建出来', async () => {
    const calls: Call[] = []
    const out = await tempDir()
    const target = join(out, '新建 目录', '深一层', 'a.png')
    const env = await startBox([screenshotTool(calls, { boxDir: await tempDir('gdbox-box-') })])

    const result = await run(['screenshot', '--project', PROJECT, '--output', target], env)

    expect(result.exitCode).toBe(0)
    expect((await fs.stat(target)).size).toBeGreaterThan(0)
  })

  it('只接受 .png', async () => {
    const result = await run(['screenshot', '--output', 'a.jpg', '--json'], {})
    expect(result.exitCode).toBe(2)
    expect(JSON.parse(result.stdout).error.message).toContain('.png')
  })

  it('不给 --output 时报用法错误', async () => {
    const result = await run(['screenshot', '--json'], {})
    expect(result.exitCode).toBe(2)
    expect(JSON.parse(result.stdout).error.hint).toContain('gdbox screenshot --output')
  })

  it('报了路径但文件不在时报 OUTPUT_INVALID', async () => {
    const calls: Call[] = []
    const out = await tempDir()
    const env = await startBox([
      screenshotTool(calls, { boxDir: await tempDir('gdbox-box-'), missingFile: true })
    ])

    const result = await run(
      ['screenshot', '--project', PROJECT, '--output', join(out, 'a.png'), '--json'],
      env
    )

    expect(result.exitCode).toBe(8)
    expect(JSON.parse(result.stdout).error.code).toBe('OUTPUT_INVALID')
  })

  /** 尺寸对不上说明拿到的可能不是这次那张图 —— 那种「成功」最危险 */
  it('文件尺寸和工具报的对不上时拒绝交付', async () => {
    const calls: Call[] = []
    const out = await tempDir()
    const env = await startBox([
      screenshotTool(calls, { boxDir: await tempDir('gdbox-box-'), reportedWidth: 1920 })
    ])

    const result = await run(
      ['screenshot', '--project', PROJECT, '--output', join(out, 'a.png'), '--json'],
      env
    )

    expect(result.exitCode).toBe(8)
    expect(JSON.parse(result.stdout).error.message).toContain('对不上')
    expect(await listing(out)).toEqual([])
  })

  it('工具失败时退出码 8，输出目录里什么都不留', async () => {
    const calls: Call[] = []
    const out = await tempDir()
    const env = await startBox([screenshotTool(calls, { mode: 'fail' })])

    const result = await run(
      ['screenshot', '--project', PROJECT, '--output', join(out, 'a.png'), '--json'],
      env
    )

    expect(result.exitCode).toBe(8)
    expect(JSON.parse(result.stdout).error.message).toContain('No frame was rendered')
    expect(await listing(out)).toEqual([])
  })

  it('--scene 和 --frames 原样发给工具', async () => {
    const calls: Call[] = []
    const out = await tempDir()
    const env = await startBox([screenshotTool(calls, { boxDir: await tempDir('gdbox-box-') })])

    const result = await run(
      [
        'screenshot',
        '--project',
        PROJECT,
        '--scene',
        'res://levels/level_1.tscn',
        '--frames',
        '90',
        '--output',
        join(out, 'a.png'),
        '--json'
      ],
      env
    )

    expect(result.exitCode).toBe(0)
    expect(calls[0]!.args).toEqual({
      project_path: PROJECT,
      scene: 'res://levels/level_1.tscn',
      frames: 90
    })
    expect(JSON.parse(result.stdout).data).toMatchObject({
      scene: 'res://levels/level_1.tscn',
      frames: 90
    })
  })

  it('没给 --project 时用唯一连着的那个编辑器的工程', async () => {
    const calls: Call[] = []
    const out = await tempDir()
    const env = await startBox(
      [screenshotTool(calls, { boxDir: await tempDir('gdbox-box-') })],
      [{ name: 'Demo', path: PROJECT, editorConnected: true }]
    )

    const result = await run(['screenshot', '--output', join(out, 'a.png'), '--json'], env)

    expect(result.exitCode).toBe(0)
    expect(calls[0]!.args.project_path).toBe(PROJECT)
  })

  it('定不下工程时退出码 5，不去跑 Godot', async () => {
    const calls: Call[] = []
    const out = await tempDir()
    // cwd 往上没有 project.godot，也没有编辑器连着
    const env = await startBox([screenshotTool(calls)])

    const result = await run(['screenshot', '--output', join(out, 'a.png'), '--json'], env)

    expect(result.exitCode).toBe(5)
    expect(JSON.parse(result.stdout).error.hint).toContain('--project')
    expect(calls).toHaveLength(0)
  })
})
