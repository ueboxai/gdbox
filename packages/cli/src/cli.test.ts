/** @vitest-environment node */
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { run } from './cli.js'
import { projectListTool, startFakeBox, type FakeBox, type FakeTool } from './testServer.js'

const boxes: FakeBox[] = []
const dirs: string[] = []

afterEach(async () => {
  await Promise.all(boxes.splice(0).map((box) => box.close().catch(() => undefined)))
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

const TOKEN = 'test-token-0123456789'

/** 「我的项目」清单：`projects list` 和第 3 级工程解析都靠它 */
function healthTool(
  projects: Array<{ id: string; name: string; path: string; connected?: boolean }>
): FakeTool {
  return projectListTool(
    projects.map((p) => ({ name: p.name, path: p.path, editorConnected: p.connected !== false }))
  )
}

/** 报出这次收到的目标工程路径 —— 绑定生没生效只有它说了算 */
const SELECTION_TOOL: FakeTool = {
  name: 'editor_scene_tree',
  description: '读用户 Godot 编辑器里当前打开的场景树。',
  meta: { namespace: 'godot.editor', risk: 'safe', projectScoped: true },
  handle: (_args, projectPath) => ({
    content: [{ type: 'text', text: `目标=${projectPath ?? 'none'}` }],
    structuredContent: { targetEcho: projectPath ?? null }
  })
}

/** 无头工具：工程目录走 `project_path` 参数，不需要编辑器 */
const CHECK_TOOL: FakeTool = {
  name: 'godot_check',
  description: '无头导入并运行工程，报脚本错误。',
  inputSchema: { properties: { project_path: { type: 'string' } } },
  meta: { namespace: 'godot', risk: 'safe', projectScoped: false },
  handle: (args, projectPath) => ({
    content: [{ type: 'text', text: 'No errors.' }],
    structuredContent: { argsEcho: args, targetEcho: projectPath ?? null }
  })
}

async function startBox(
  tools: FakeTool[],
  options: {
    declareContract?: boolean
    contractVersion?: number
    connectedProjects?: string[]
  } = {}
): Promise<FakeBox> {
  const box = await startFakeBox({ token: TOKEN, tools, ...options })
  boxes.push(box)
  return box
}

function envFor(box: FakeBox, token = TOKEN): NodeJS.ProcessEnv {
  return { GDBOX_URL: box.url, GDBOX_TOKEN: token }
}

async function projectDir(name: string): Promise<string> {
  const root = await fs.mkdtemp(join(tmpdir(), 'gdbox 工程-'))
  dirs.push(root)
  const dir = join(root, name)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(join(dir, 'project.godot'), `config/name="${name}"\n`)
  return dir.replace(/\\/g, '/')
}

// ── 不连服务就能跑的那些 ────────────────────────────────────────────────────

describe('--help / --version', () => {
  /** 想知道怎么用的时候，不该被「先去配置一下」挡住（§4） */
  it('不读凭据、不连服务，也不因为没配置就失败', async () => {
    const result = await run(['--help'], {})

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('gdbox')
    expect(result.stderr).toBe('')
  })

  it('有英文版帮助', async () => {
    const result = await run(['--help', '--lang', 'en-US'], {})

    expect(result.stdout).toContain('GDBox CLI')
    expect(result.stdout).toContain('Exit codes')
  })

  /** `gdbox --version` 没有位置参数，不能因此掉进「你没给命令」那条路 */
  it('--version 只打版本号，退出码 0', async () => {
    const result = await run(['--version'], {})

    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/)
  })

  /** 光敲 gdbox 不是用法错误 —— 用户没说错什么，他只是还没说要干什么 */
  it('光敲 gdbox 给帮助，退出码 0', async () => {
    const result = await run([], {})

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('用法')
  })
})

describe('用法错误', () => {
  it('未知命令返回 2', async () => {
    const result = await run(['frobnicate', '--json'], {})

    expect(result.exitCode).toBe(2)
    expect(JSON.parse(result.stdout).error.code).toBe('INVALID_ARGUMENT')
  })

  it('tools show 不给名字返回 2', async () => {
    const result = await run(['tools', 'show', '--json'], {})

    expect(result.exitCode).toBe(2)
    expect(JSON.parse(result.stdout).error.hint).toContain('gdbox tools list')
  })
})

// ── 信封形状 ────────────────────────────────────────────────────────────────

describe('--json 输出', () => {
  /**
   * 只要有一次在 stdout 上多打了一行日志，所有解析它的脚本就都碎了。
   * 成功和失败两条路都要守住。
   */
  it('成功时 stdout 只有一个 JSON 对象加换行', async () => {
    const box = await startBox([healthTool([])])
    const result = await run(['projects', 'list', '--json'], envFor(box))

    expect(result.stdout.endsWith('\n')).toBe(true)
    expect(result.stdout.trimEnd().split('\n')).toHaveLength(1)
    expect(() => JSON.parse(result.stdout)).not.toThrow()
    expect(result.stderr).toBe('')
  })

  it('失败时也只有一个 JSON 对象', async () => {
    const box = await startBox([healthTool([])])
    const result = await run(['projects', 'list', '--json'], envFor(box, 'wrong-token'))

    expect(result.exitCode).not.toBe(0)
    expect(() => JSON.parse(result.stdout)).not.toThrow()
    expect(result.stderr).toBe('')
  })

  it('成功的信封有 data 没有 error，失败反过来', async () => {
    const box = await startBox([healthTool([])])

    const ok = JSON.parse((await run(['projects', 'list', '--json'], envFor(box))).stdout)
    expect(ok).toMatchObject({ schemaVersion: 1, ok: true, artifacts: [], project: null })
    expect(ok.data).toBeDefined()
    expect(ok.error).toBeUndefined()

    const bad = JSON.parse((await run(['frobnicate', '--json'], {})).stdout)
    expect(bad.ok).toBe(false)
    expect(bad.error).toBeDefined()
    expect(bad.data).toBeUndefined()
    expect(Array.isArray(bad.warnings)).toBe(true)
  })
})

// ── 连接与认证 ──────────────────────────────────────────────────────────────

describe('连不上 / 令牌不对', () => {
  it('令牌不对时报 AUTH_FAILED，退出码 3', async () => {
    const box = await startBox([healthTool([])])
    const result = await run(['projects', 'list', '--json'], envFor(box, 'wrong-token'))

    expect(result.exitCode).toBe(3)
    const envelope = JSON.parse(result.stdout)
    expect(envelope.error.code).toBe('AUTH_FAILED')
    expect(envelope.error.hint).toContain('gdbox doctor')
  })

  it('服务没开时报 SERVICE_UNAVAILABLE，退出码 4', async () => {
    const box = await startBox([healthTool([])])
    const url = box.url
    await box.close()
    boxes.length = 0

    const result = await run(['projects', 'list', '--json'], { GDBOX_URL: url, GDBOX_TOKEN: TOKEN })

    expect(result.exitCode).toBe(4)
    expect(JSON.parse(result.stdout).error.code).toBe('SERVICE_UNAVAILABLE')
  }, 20_000)

  it('环境变量只给一半时报配置错误，不去别处补', async () => {
    const result = await run(['projects', 'list', '--json'], { GDBOX_URL: 'http://127.0.0.1:1/' })

    expect(result.exitCode).toBe(3)
    expect(JSON.parse(result.stdout).error.message).toContain('必须同时提供')
  })

  it('GDBOX_URL 指向非回环地址时拒绝发送令牌', async () => {
    const result = await run(['projects', 'list', '--json'], {
      GDBOX_URL: 'http://192.168.1.5:17871/',
      GDBOX_TOKEN: TOKEN
    })

    expect(result.exitCode).toBe(3)
    expect(JSON.parse(result.stdout).error.message).toContain('回环')
  })
})

/**
 * 旧盒子。
 *
 * 连通性是好的，但它会**静默忽略** `--project` —— 命令看起来成功，
 * 实际可能发给了另一个工程。所以要干活的命令必须先确认契约在。
 */
describe('旧盒子（没有契约声明）', () => {
  it('报 INCOMPATIBLE_SERVER，退出码 4，不静默继续', async () => {
    const box = await startBox([healthTool([])], { declareContract: false })
    const result = await run(['tools', 'list', '--json'], envFor(box))

    expect(result.exitCode).toBe(4)
    const envelope = JSON.parse(result.stdout)
    expect(envelope.error.code).toBe('INCOMPATIBLE_SERVER')
    expect(envelope.error.hint).toContain('升级')
  })

  it('契约版本对不上时同样报不兼容', async () => {
    const box = await startBox([healthTool([])], { contractVersion: 99 })
    const result = await run(['tools', 'list', '--json'], envFor(box))

    expect(result.exitCode).toBe(4)
    expect(JSON.parse(result.stdout).error.message).toContain('99')
  })

  it('doctor 在旧盒子上仍然给出逐层结果', async () => {
    const box = await startBox([healthTool([])], { declareContract: false })
    const result = await run(['doctor', '--json'], envFor(box))

    expect(result.exitCode).toBe(4)
    const envelope = JSON.parse(result.stdout)
    // 连通性那一层是通过的，契约那一层才是失败的 —— 两者要能分辨
    expect(envelope.error.message).toContain('connection')
    expect(envelope.error.message).toContain('contract')
  })
})

// ── projects / tools ────────────────────────────────────────────────────────

describe('projects list', () => {
  /** 「我问一下有没有」的正确答案就是「零个」，不是失败（§4） */
  it('没有工程时成功返回空数组，退出码 0', async () => {
    const box = await startBox([healthTool([])])
    const result = await run(['projects', 'list', '--json'], envFor(box))

    expect(result.exitCode).toBe(0)
    const envelope = JSON.parse(result.stdout)
    expect(envelope.ok).toBe(true)
    expect(envelope.data.projects).toEqual([])
    expect(envelope.warnings.length).toBeGreaterThan(0)
  })

  it('有工程时列出名字、路径和编辑器连接', async () => {
    const box = await startBox([healthTool([{ id: 'c1', name: 'Demo', path: 'D:/Games/Demo' }])])
    const result = await run(['projects', 'list', '--json'], envFor(box))

    const data = JSON.parse(result.stdout).data
    expect(data.projects).toEqual([
      {
        name: 'Demo',
        path: 'D:/Games/Demo',
        godotVersion: '4.4',
        onDisk: true,
        editorConnected: true,
        projectKey: 'key-0'
      }
    ])
    expect(data.editorConnectedCount).toBe(1)
  })

  /** 只把清单写在文字里的盒子不能当接口用：报不兼容，不去拆文字 */
  it('盒子没给结构化清单时报 INCOMPATIBLE_SERVER，退出码 4', async () => {
    const box = await startBox([
      {
        name: 'project_list',
        meta: { namespace: 'project', risk: 'safe' },
        handle: () => ({ content: [{ type: 'text', text: '- Demo（k1）｜D:/Games/Demo' }] })
      }
    ])
    const result = await run(['projects', 'list', '--json'], envFor(box))

    expect(result.exitCode).toBe(4)
    expect(JSON.parse(result.stdout).error.code).toBe('INCOMPATIBLE_SERVER')
  })
})

describe('tools list', () => {
  const MUTATING: FakeTool = {
    name: 'editor_save_all',
    meta: { namespace: 'godot.editor', risk: 'mutating', projectScoped: true },
    handle: () => ({ content: [{ type: 'text', text: '存了' }] })
  }
  const LOCAL: FakeTool = {
    name: 'search_assets',
    meta: { namespace: 'asset', risk: 'safe' },
    handle: () => ({ content: [{ type: 'text', text: 'ok' }] })
  }
  const NO_META: FakeTool = {
    name: 'mystery_tool',
    handle: () => ({ content: [{ type: 'text', text: 'ok' }] })
  }

  /**
   * 命名空间不再参与判断：`search_assets` 是 `asset`，照样列出来。
   * 挡的只剩两类 —— 会改东西的（没开 `--allow-write`）和说不清自己是什么的。
   */
  it('默认列出全部只读工具，不分命名空间', async () => {
    const box = await startBox([healthTool([]), SELECTION_TOOL, MUTATING, LOCAL, NO_META])
    const result = await run(['tools', 'list', '--json'], envFor(box))

    const names = JSON.parse(result.stdout).data.tools.map((t: { name: string }) => t.name)
    expect(names).toContain('editor_scene_tree')
    expect(names).toContain('project_list')
    // 素材库是 asset 命名空间 —— 外部 harness 就是靠它找资产的，不能挡
    expect(names).toContain('search_assets')
    expect(names).not.toContain('editor_save_all')
    expect(names).not.toContain('mystery_tool')
  })

  it('加 --allow-write 之后写工具才列出来', async () => {
    const box = await startBox([healthTool([]), SELECTION_TOOL, MUTATING, LOCAL])
    const result = await run(['tools', 'list', '--allow-write', '--json'], envFor(box))

    const names = JSON.parse(result.stdout).data.tools.map((t: { name: string }) => t.name)
    expect(names).toContain('editor_save_all')
  })

  it('说清楚盒子一共开放了多少、有多少超出范围', async () => {
    const box = await startBox([healthTool([]), SELECTION_TOOL, MUTATING, LOCAL, NO_META])
    const data = JSON.parse((await run(['tools', 'list', '--json'], envFor(box))).stdout).data

    expect(data.exposedByHost).toBe(5)
    // 超出范围的只有没元数据那个；写工具算「这次没列」，不算超范围
    expect(data.outOfScope).toBe(1)
    expect(data.writeToolCount).toBe(1)
  })

  it('--search 按名字和描述筛', async () => {
    const box = await startBox([healthTool([]), SELECTION_TOOL])
    const result = await run(['tools', 'list', '--search', 'scene_tree', '--json'], envFor(box))

    const names = JSON.parse(result.stdout).data.tools.map((t: { name: string }) => t.name)
    expect(names).toEqual(['editor_scene_tree'])
  })

  /**
   * 不加开关就不调写工具 —— 这一头没有任何人能在弹窗上点确认，
   * 一条命令下去就直接执行了。`--allow-write` 顶替的就是那个弹窗。
   */
  it('没加 --allow-write 就调写工具，退出码 6', async () => {
    const box = await startBox([healthTool([]), MUTATING])
    const result = await run(['tools', 'call', 'editor_save_all', '--json'], envFor(box))

    expect(result.exitCode).toBe(6)
    expect(JSON.parse(result.stdout).error.code).toBe('RISK_NOT_SUPPORTED')
  })

  /** 把「不知道」当成「安全」，正是这类判断出事的固定方式 */
  it('没有元数据的工具不被默认为只读', async () => {
    const box = await startBox([healthTool([]), NO_META])
    const result = await run(['tools', 'call', 'mystery_tool', '--json'], envFor(box))

    expect(result.exitCode).toBe(6)
    expect(JSON.parse(result.stdout).error.message).toContain('无法确认它是只读的')
  })

  it('tools show 给完整描述和参数定义', async () => {
    const box = await startBox([healthTool([]), SELECTION_TOOL])
    const result = await run(['tools', 'show', 'editor_scene_tree', '--json'], envFor(box))

    const data = JSON.parse(result.stdout).data
    expect(data.description).toContain('场景树')
    expect(data.inputSchema).toMatchObject({ type: 'object' })
    expect(data.projectScoped).toBe(true)
  })

  it('tools show 一个不存在的工具报 TOOL_UNAVAILABLE', async () => {
    const box = await startBox([healthTool([])])
    const result = await run(['tools', 'show', 'nope', '--json'], envFor(box))

    expect(result.exitCode).toBe(6)
    expect(JSON.parse(result.stdout).error.code).toBe('TOOL_UNAVAILABLE')
  })

  /**
   * 看懂一个工具怎么调，不该先证明自己有权改它 —— 调用方正是要先看 schema
   * 才拼得出那条带 --allow-write 的命令。
   */
  it('tools show 写工具不用 --allow-write，但会说明调用时要加', async () => {
    const box = await startBox([healthTool([]), MUTATING])
    const result = await run(['tools', 'show', 'editor_save_all', '--json'], envFor(box))

    const envelope = JSON.parse(result.stdout)
    expect(result.exitCode).toBe(0)
    expect(envelope.data.requiresAllowWrite).toBe(true)
    expect(envelope.warnings.join(' ')).toContain('--allow-write')
  })
})

/**
 * 命名空间那道门拆掉之后真正解锁的东西。
 *
 * 早先外部 harness（Codex 这类）在盒子里搜不到素材库、也碰不到工程库：
 * `search_assets` 是 `asset`、`project_organize` 是 `project`，都被
 * 「只调用引擎命名空间」挡在外面，于是「找资产 → 放进工程 → 验证」
 * 这条链子从中间断开。
 */
describe('盒子自己的能力，外部 harness 也能调', () => {
  const SEARCH_ASSETS: FakeTool = {
    name: 'search_assets',
    meta: { namespace: 'asset', risk: 'safe', projectScoped: false },
    handle: () => ({
      content: [{ type: 'text', text: '找到 1 个' }],
      structuredContent: { assets: [{ assetKey: 'k1', name: '椅子' }] }
    })
  }

  const IMPORT_ASSETS: FakeTool = {
    name: 'project_organize',
    meta: { namespace: 'project', risk: 'destructive', projectScoped: false },
    handle: () => ({
      content: [{ type: 'text', text: '导入完成' }],
      structuredContent: { imported: 1 }
    })
  }

  const NEEDS_APPROVAL: FakeTool = {
    name: 'browser_interact',
    meta: {
      namespace: 'browser',
      risk: 'mutating',
      projectScoped: false,
      requiresExplicitApproval: true
    },
    handle: () => ({ content: [{ type: 'text', text: '点了' }] })
  }

  it('搜素材库是只读的，不用开关', async () => {
    const box = await startBox([healthTool([]), SEARCH_ASSETS])
    const result = await run(
      ['tools', 'call', 'search_assets', '--args', '{"query":"椅子"}', '--json'],
      envFor(box)
    )

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout).data.structured).toMatchObject({
      assets: [{ assetKey: 'k1' }]
    })
  })

  it('整理工程库 —— 加 --allow-write 就能调', async () => {
    const box = await startBox([healthTool([]), IMPORT_ASSETS])
    const args = JSON.stringify({ action: 'move', collection: 'Prototypes' })
    const result = await run(
      ['tools', 'call', 'project_organize', '--args', args, '--allow-write', '--json'],
      envFor(box)
    )

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout).data.structured).toMatchObject({ imported: 1 })
  })

  it('同一个工具不加开关仍然拒', async () => {
    const box = await startBox([healthTool([]), IMPORT_ASSETS])
    const result = await run(['tools', 'call', 'project_organize', '--json'], envFor(box))

    expect(result.exitCode).toBe(6)
    expect(JSON.parse(result.stdout).error.code).toBe('RISK_NOT_SUPPORTED')
  })

  /** 要求逐次审批的工具仍然不给：它的前提就是有人当场看着 */
  it('要求逐次审批的工具，开了写也还是不给', async () => {
    const box = await startBox([healthTool([]), NEEDS_APPROVAL])
    const result = await run(
      ['tools', 'call', 'browser_interact', '--allow-write', '--json'],
      envFor(box)
    )

    expect(result.exitCode).toBe(6)
    expect(JSON.parse(result.stdout).error.message).toContain('没有审批界面')
  })
})

// ── 工程解析 ────────────────────────────────────────────────────────────────

describe('tools call 的工程解析', () => {
  it('编辑器类工具：显式 --project 会随请求发到服务端', async () => {
    const dir = await projectDir('Demo')
    const box = await startBox([SELECTION_TOOL], { connectedProjects: [dir] })

    const result = await run(
      ['tools', 'call', 'editor_scene_tree', '--project', dir, '--json'],
      envFor(box)
    )

    expect(result.exitCode).toBe(0)
    const envelope = JSON.parse(result.stdout)
    expect(envelope.data.structured.targetEcho).toBe(dir)
    expect(envelope.project).toEqual({ name: 'Demo', path: dir })
  })

  it('带中文和空格的工程路径也发得过去', async () => {
    const dir = await projectDir('我的工程')
    const box = await startBox([SELECTION_TOOL], { connectedProjects: [dir] })

    const result = await run(
      ['tools', 'call', 'editor_scene_tree', '--project', dir, '--json'],
      envFor(box)
    )

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout).data.structured.targetEcho).toBe(dir)
  })

  it('指定工程的编辑器没连上时退出码 5，且不改发给在线的那个', async () => {
    const mine = await projectDir('Mine')
    const other = await projectDir('Other')
    const box = await startBox(
      [healthTool([{ id: 'c1', name: 'Other', path: other }]), SELECTION_TOOL],
      { connectedProjects: [other] }
    )

    const result = await run(
      ['tools', 'call', 'editor_scene_tree', '--project', mine, '--json'],
      envFor(box)
    )

    expect(result.exitCode).toBe(5)
    const envelope = JSON.parse(result.stdout)
    expect(envelope.error.code).toBe('PROJECT_NOT_CONNECTED')
    // 绝不能有任何迹象表明命令被发给了 Other
    expect(result.stdout).not.toContain('targetEcho')
  })

  it('恰好一个编辑器连着又没给 --project 时用它', async () => {
    const box = await startBox([
      healthTool([
        { id: 'c1', name: 'A', path: 'D:/A' },
        { id: 'c2', name: 'B', path: 'D:/B', connected: false }
      ]),
      SELECTION_TOOL
    ])

    const result = await run(['tools', 'call', 'editor_scene_tree', '--json'], envFor(box))

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout).data.structured.targetEcho).toBe('D:/A')
  })

  it('两个编辑器连着又没给 --project 时报歧义，退出码 5', async () => {
    const box = await startBox([
      healthTool([
        { id: 'c1', name: 'A', path: 'D:/A' },
        { id: 'c2', name: 'B', path: 'D:/B' }
      ]),
      SELECTION_TOOL
    ])

    // cwd 往上找不到 project.godot，所以会落到第三级
    const result = await run(['tools', 'call', 'editor_scene_tree', '--json'], envFor(box))

    expect(result.exitCode).toBe(5)
    expect(JSON.parse(result.stdout).error.code).toBe('PROJECT_AMBIGUOUS')
  })

  /**
   * 无头工具不需要编辑器。工程目录要是走请求元数据，盒子会因为编辑器没连着
   * 直接拒掉 —— 所以它走的是工具自己的 `project_path` 参数。
   */
  it('无头工具：--project 补进 project_path，不走元数据，编辑器没开也能调', async () => {
    const dir = await projectDir('Demo')
    const box = await startBox([CHECK_TOOL], { connectedProjects: [] })

    const result = await run(
      ['tools', 'call', 'godot_check', '--project', dir, '--json'],
      envFor(box)
    )

    expect(result.exitCode).toBe(0)
    const envelope = JSON.parse(result.stdout)
    expect(envelope.data.structured.argsEcho).toEqual({ project_path: dir })
    expect(envelope.data.structured.targetEcho).toBeNull()
    expect(envelope.project).toEqual({ name: 'Demo', path: dir })
  })

  it('无头工具：调用方自己给了 project_path 就不动它', async () => {
    const dir = await projectDir('Demo')
    const box = await startBox([CHECK_TOOL])

    const result = await run(
      [
        'tools',
        'call',
        'godot_check',
        '--project',
        dir,
        '--args',
        '{"project_path":"E:/X"}',
        '--json'
      ],
      envFor(box)
    )

    expect(JSON.parse(result.stdout).data.structured.argsEcho).toEqual({ project_path: 'E:/X' })
  })

  /** 与工程无关的工具不强绑目标 —— 强绑会让它们在没有工程时也失败 */
  it('与工程无关的工具在没有工程时照样调得通', async () => {
    const box = await startBox([healthTool([])])
    const result = await run(['tools', 'call', 'project_list', '--json'], envFor(box))

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout).project).toBeNull()
  })
})

// ── 工具失败 ────────────────────────────────────────────────────────────────

describe('工具失败', () => {
  const BOOM: FakeTool = {
    name: 'godot_check',
    meta: { namespace: 'godot', risk: 'safe', projectScoped: false },
    handle: () => ({
      content: [{ type: 'text', text: 'Godot 那边炸了' }],
      isError: true,
      _meta: { unrealBox: { errorCode: 'TOOL_FAILED' } }
    })
  }

  /** HTTP 200 和 MCP 请求成功都不等于工具成功（§6.2） */
  it('isError 的结果不会被当成成功', async () => {
    const box = await startBox([healthTool([]), BOOM])
    const result = await run(['tools', 'call', 'godot_check', '--json'], envFor(box))

    expect(result.exitCode).toBe(8)
    const envelope = JSON.parse(result.stdout)
    expect(envelope.ok).toBe(false)
    expect(envelope.error.code).toBe('TOOL_FAILED')
    expect(envelope.error.message).toContain('Godot 那边炸了')
    // failed 表示收到了明确的失败结果，不是「不知道」
    expect(envelope.error.execution).toBe('failed')
  })
})

// ── 参数输入 ────────────────────────────────────────────────────────────────

describe('tools call 的参数', () => {
  const ECHO: FakeTool = {
    name: 'search_assets',
    meta: { namespace: 'asset', risk: 'safe', projectScoped: false },
    handle: (args) => ({
      content: [{ type: 'text', text: 'ok' }],
      structuredContent: { echo: args }
    })
  }

  it('--args 的 JSON 原样发过去', async () => {
    const box = await startBox([healthTool([]), ECHO])
    const result = await run(
      ['tools', 'call', 'search_assets', '--args', '{"limit":10}', '--json'],
      envFor(box)
    )

    expect(JSON.parse(result.stdout).data.structured.echo).toEqual({ limit: 10 })
  })

  it('--args-file 从文件读，带 BOM 也认', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'gdbox-args-'))
    dirs.push(dir)
    const file = join(dir, 'query.json')
    await fs.writeFile(file, `\uFEFF${JSON.stringify({ limit: 3 })}`, 'utf8')

    const box = await startBox([healthTool([]), ECHO])
    const result = await run(
      ['tools', 'call', 'search_assets', '--args-file', file, '--json'],
      envFor(box)
    )

    expect(JSON.parse(result.stdout).data.structured.echo).toEqual({ limit: 3 })
  })

  it('参数不是对象时在连服务之前就挡下', async () => {
    const result = await run(['tools', 'call', 'search_assets', '--args', '[1,2]', '--json'], {
      GDBOX_URL: 'http://127.0.0.1:1/',
      GDBOX_TOKEN: 'x'
    })

    expect(result.exitCode).toBe(2)
    expect(JSON.parse(result.stdout).error.message).toContain('必须是一个 JSON 对象')
  })

  it('两种参数输入同时给时报错', async () => {
    const result = await run(
      ['tools', 'call', 'x', '--args', '{}', '--args-file', 'a.json', '--json'],
      {}
    )

    expect(result.exitCode).toBe(2)
    expect(JSON.parse(result.stdout).error.message).toContain('只能给一个')
  })
})

// ── 默认（非 JSON）模式 ─────────────────────────────────────────────────────

describe('默认输出', () => {
  it('成功走 stdout，失败走 stderr', async () => {
    const box = await startBox([healthTool([{ id: 'c1', name: 'Demo', path: 'D:/Games/Demo' }])])

    const ok = await run(['projects', 'list'], envFor(box))
    expect(ok.stdout).toContain('Demo')
    expect(ok.stderr).toBe('')

    const bad = await run(['projects', 'list'], envFor(box, 'wrong'))
    expect(bad.stdout).toBe('')
    expect(bad.stderr).toContain('AUTH_FAILED')
  })

  /** 人读错误信息是先看「哪儿不对」再看「怎么办」 */
  it('补救建议跟在错误后面，不是前面', async () => {
    const box = await startBox([healthTool([])])
    const result = await run(['projects', 'list'], envFor(box, 'wrong'))

    expect(result.stderr.indexOf('失败')).toBeLessThan(result.stderr.indexOf('怎么办'))
  })

  /** 这些输出经常被重定向进文件或被别的程序读，控制码在那里是垃圾字符 */
  it('不含终端控制码', async () => {
    const box = await startBox([healthTool([])])
    const result = await run(['projects', 'list'], envFor(box))

    // eslint-disable-next-line no-control-regex
    expect(result.stdout).not.toMatch(/\u001b\[/)
  })
})
