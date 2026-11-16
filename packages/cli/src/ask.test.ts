/** @vitest-environment node */
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { run } from './cli.js'
import { projectListTool, startFakeBox, type FakeBox, type FakeTool } from './testServer.js'

const TOKEN = 'test-token-0123456789'
const boxes: FakeBox[] = []
const dirs: string[] = []

afterEach(async () => {
  await Promise.all(boxes.splice(0).map((box) => box.close().catch(() => undefined)))
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

const PROJECT = 'D:/Games/Demo'

function projects(online: boolean): FakeTool {
  return projectListTool([{ name: 'Demo', path: PROJECT, editorConnected: online }])
}

/** 清单里摆几类命名空间，看 ask 放行了哪些 */
function tool(name: string, namespace: string, risk = 'safe'): FakeTool {
  return { name, meta: { namespace, risk }, handle: () => ({ content: [] }) }
}

const CATALOG = [
  tool('godot_check', 'godot'),
  tool('editor_play', 'godot.editor', 'mutating'),
  tool('gen_sprite', 'godot.asset', 'mutating'),
  tool('search_assets', 'asset'),
  tool('load_skill', 'core'),
  tool('generate_video', 'aigc', 'mutating'),
  tool('run_shell_command', 'local.shell', 'destructive'),
  tool('write_local_file', 'local', 'destructive'),
  tool('browser_navigate', 'browser'),
  tool('mcp_other', 'mcp.other', 'destructive'),
  tool('box_manage', 'box', 'destructive')
]

/** 假的 task：记下收到的参数，按剧本报进度、交结论 */
function taskTool(
  calls: Array<{ args: Record<string, unknown>; project: string | undefined }>,
  script: (progress: (m: string) => Promise<void>) => Promise<string> = async () => '做完了'
): FakeTool {
  return {
    name: 'task',
    // 真盒子对外把 task 按最坏情况报成破坏性
    meta: { namespace: 'core', risk: 'destructive' },
    handle: async (args, project, progress) => {
      calls.push({ args, project })
      return { content: [{ type: 'text', text: await script(progress) }] }
    }
  }
}

async function startBox(
  tools: FakeTool[],
  online = true,
  connectedProjects: string[] = online ? [PROJECT] : []
): Promise<NodeJS.ProcessEnv> {
  const box = await startFakeBox({
    token: TOKEN,
    tools: [projects(online), ...tools],
    connectedProjects
  })
  boxes.push(box)
  return { GDBOX_URL: box.url, GDBOX_TOKEN: TOKEN }
}

async function godotProject(): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'gdbox 工程-'))
  dirs.push(dir)
  await fs.writeFile(join(dir, 'project.godot'), 'config/name="跳跳乐"\n')
  return dir.replace(/\\/g, '/')
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

describe('gdbox ask', () => {
  it('默认只读、不带历史，结论打到 stdout', async () => {
    const calls: Parameters<typeof taskTool>[0] = []
    const env = await startBox([...CATALOG, taskTool(calls)])

    const result = await run(['ask', '检查', '主场景的脚本'], env)

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('做完了')
    expect(calls[0]!.args).toMatchObject({ context_mode: 'fresh', read_only: true })
    // 恰好一个编辑器连着：绑到它，并把目录写进给子任务的那句话
    expect(calls[0]!.project).toBe(PROJECT)
    expect(calls[0]!.args.prompt).toBe(`目标 Godot 工程：${PROJECT}\n\n检查 主场景的脚本`)
  })

  /**
   * 无头工具不需要编辑器：点名的工程编辑器没开时，盒子在执行前就拒了元数据，
   * 这时去掉绑定再发一次，子任务照样拿得到工程目录。
   */
  it('点名的工程编辑器没连着时退回无绑定，路径仍在任务里', async () => {
    const calls: Parameters<typeof taskTool>[0] = []
    const dir = await godotProject()
    const env = await startBox([...CATALOG, taskTool(calls)], false)

    const result = await run(['ask', '给主角加二段跳并验证', '--project', dir, '--json'], env)

    expect(result.exitCode).toBe(0)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.project).toBeUndefined()
    expect(calls[0]!.args.prompt).toContain(`目标 Godot 工程：${dir}`)
    const envelope = JSON.parse(result.stdout)
    expect(envelope.project).toEqual({ name: '跳跳乐', path: dir })
    expect(envelope.warnings.join('')).toContain('editor_*')
  })

  /** 子任务在外部会话里每一步都自动批准，范围只能靠白名单收住 */
  it('只放行 Godot、工程文件、素材库、工程库和技能，shell / 浏览器 / 第三方 MCP 都不给', async () => {
    const calls: Parameters<typeof taskTool>[0] = []
    const env = await startBox([...CATALOG, taskTool(calls)])

    await run(['ask', '随便', '--allow-write'], env)

    expect(calls[0]!.args.namespaces).toEqual([
      'asset',
      'core',
      'godot',
      'godot.asset',
      'godot.editor',
      'local',
      'project'
    ])
    expect(calls[0]!.args.read_only).toBeUndefined()
  })

  it('进度实时交给调用方，--json 时 stdout 仍然只有一个 JSON', async () => {
    const calls: Parameters<typeof taskTool>[0] = []
    const env = await startBox([
      ...CATALOG,
      taskTool(calls, async (progress) => {
        await progress('调用 godot_check')
        await progress('调用 godot_run')
        return '调好了'
      })
    ])
    const seen: string[] = []

    const result = await run(['ask', '调跳跃', '--json'], env, {
      progress: (message) => seen.push(message)
    })

    expect(seen).toEqual(['调用 godot_check', '调用 godot_run'])
    expect(JSON.parse(result.stdout).data.answer).toBe('调好了')
  })

  /** 在素材库里找东西不需要工程，没点名、也没编辑器连着时不该报错 */
  it('定不下工程时照跑，并说明只能用素材库和工程库', async () => {
    const calls: Parameters<typeof taskTool>[0] = []
    const env = await startBox([...CATALOG, taskTool(calls)], false)

    const result = await run(['ask', '找几张砖墙贴图', '--json'], env)

    expect(result.exitCode).toBe(0)
    expect(calls[0]!.project).toBeUndefined()
    expect(calls[0]!.args.prompt).toBe('找几张砖墙贴图')
    expect(JSON.parse(result.stdout).warnings.join('')).toContain('--project')
  })

  describe('--model', () => {
    /** 盒子配了多个模型时 task 的参数表里才有 model */
    function withModelParam(tool: FakeTool): FakeTool {
      return { ...tool, inputSchema: { type: 'object', properties: { model: { type: 'string' } } } }
    }

    it('原样交给 task 的 model 参数', async () => {
      const calls: Parameters<typeof taskTool>[0] = []
      const env = await startBox([...CATALOG, withModelParam(taskTool(calls))])

      const result = await run(['ask', '列出灯', '--model', 'deepseek-chat'], env)

      expect(result.exitCode).toBe(0)
      expect(calls[0]!.args.model).toBe('deepseek-chat')
    })

    it('不给就不带 model，用盒子的默认模型', async () => {
      const calls: Parameters<typeof taskTool>[0] = []
      const env = await startBox([...CATALOG, withModelParam(taskTool(calls))])

      await run(['ask', '列出灯'], env)

      expect(calls[0]!.args).not.toHaveProperty('model')
    })

    /** 盒子只配了一个模型时多给的字段会被悄悄丢掉，用户以为换了模型其实没换 */
    it('盒子只配了一个模型时报用法错误，不派任务', async () => {
      const calls: Parameters<typeof taskTool>[0] = []
      const env = await startBox([...CATALOG, taskTool(calls)])

      const result = await run(['ask', '列出灯', '--model', 'deepseek-chat', '--json'], env)

      expect(result.exitCode).toBe(2)
      expect(JSON.parse(result.stdout).error.message).toContain('只配了一个模型')
      expect(calls).toHaveLength(0)
    })
  })

  it('没给要做的事时报用法错误', async () => {
    const result = await run(['ask'], {})
    expect(result.exitCode).toBe(2)
  })

  describe('--timeout 算的是多久没有进度', () => {
    it('一直在报进度的长任务不会被判超时', async () => {
      const calls: Parameters<typeof taskTool>[0] = []
      const env = await startBox([
        ...CATALOG,
        taskTool(calls, async (progress) => {
          // 总时长 2.4 秒，超过 --timeout 1，但每 0.2 秒报一次（留够余量，满载跑门禁时不误判）
          for (let i = 0; i < 12; i++) {
            await sleep(200)
            await progress(`第 ${i + 1} 步`)
          }
          return '跑完了'
        })
      ])

      const result = await run(['ask', '长任务', '--timeout', '1'], env)

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('跑完了')
    }, 15_000)

    it('长时间不出声就判超时，结局不明，退出码 7', async () => {
      const calls: Parameters<typeof taskTool>[0] = []
      const env = await startBox([
        ...CATALOG,
        taskTool(calls, async () => {
          await sleep(2500)
          return '太晚了'
        })
      ])

      const result = await run(['ask', '卡住的任务', '--timeout', '1', '--json'], env)

      expect(result.exitCode).toBe(7)
      const envelope = JSON.parse(result.stdout)
      expect(envelope.error.code).toBe('TIMEOUT')
      expect(envelope.error.execution).toBe('unknown')
    }, 15_000)
  })
})

describe('tools call 不许直接调 task', () => {
  /**
   * 直接调的话子任务不带命名空间白名单，shell、浏览器、要求逐次审批的工具
   * 都在它手上 —— 绕过了 CLI「逐次审批的工具不给」那条规则。
   */
  it('加了 --allow-write 也拒绝，并指向 ask', async () => {
    const calls: Parameters<typeof taskTool>[0] = []
    const env = await startBox([...CATALOG, taskTool(calls)])

    const result = await run(['tools', 'call', 'task', '--allow-write', '--json'], env)

    expect(result.exitCode).toBe(6)
    expect(JSON.parse(result.stdout).error.message).toContain('gdbox ask')
    expect(calls).toHaveLength(0)
  })
})
