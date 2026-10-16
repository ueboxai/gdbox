import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'

import { electronMock, servicesMock, targetContextMock } from '../testSupport/toolMocks'

// registry 会 eager import 全部 V2 工具模块，其中几个在加载时就有副作用。
// 打桩的理由见 testSupport/toolMocks.ts 文件头。
// 包一层箭头：vi.mock 会被提升到 import 之上，直接传标识符会在初始化前访问它
// （ReferenceError: Cannot access '__vi_import_0__' before initialization）。
// 箭头把标识符的求值推迟到工厂真正被调用时。
vi.mock('electron', () => electronMock())
vi.mock('../../services', () => servicesMock())
vi.mock('../../agent-v3/core/projectTargetContext', async (importOriginal) =>
  targetContextMock(importOriginal)
)

import {
  allToolNames,
  buildAllTools,
  listToolCatalog,
  listToolRisks,
  resetToolCacheForTest,
  rewriteCrossReferences
} from './registry'
import { invalidateSettingsCache } from '../../ai/store'
import { estimateTokens } from '../../../shared/tokenBudget'

beforeEach(() => resetToolCacheForTest())

describe('rewriteCrossReferences', () => {
  it('不误伤无关的点号文本', () => {
    expect(rewriteCrossReferences('路径 /Game/M_Wood.M_Wood')).toBe('路径 /Game/M_Wood.M_Wood')
  })
})

describe('buildAllTools', () => {
  it('全部工具都能造出来（schema 转换不炸）', () => {
    const tools = buildAllTools()
    expect(tools.length).toBeGreaterThan(40)
  })

  it('工具名全局唯一 —— 重名会静默覆盖，模型看到的行为与描述对不上', () => {
    const names = buildAllTools().map((t) => t.name)
    expect(new Set(names).size).toBe(names.length)
  })

  /**
   * 工具**几乎都是**无状态的，唯一的例外是 `generate_3d_model`：它的入参表取决于
   * 用户给「3D 生成」绑的是哪家厂商。不跟着配置作废的话，用户在偏好设置里换完
   * 厂商要重启应用才生效 —— 而那种「改了没反应」最难查，因为界面上配置明明是新的。
   */
  it('用户改了 AI 配置之后工具表重造，而不是一直吃缓存', () => {
    const first = buildAllTools()
    expect(buildAllTools(), '同一份配置下应当命中缓存').toBe(first)

    invalidateSettingsCache()

    expect(buildAllTools()).not.toBe(first)
  })

  /**
   * 浏览器工具**不能**出现在这里。
   *
   * `/api/debug/tool` 直接从 `buildAllTools()` 取工具 execute，既不过
   * `resolveTools` 的过滤，也不过审批门。它们只在 `resolveTools` 里现造 ——
   * 这一条测的就是那个闸门没被人顺手拆掉。
   */
  it('不含浏览器工具：那条路绕开了审批门', () => {
    const names = buildAllTools().map((t) => t.name)

    expect(names.filter((name) => name.startsWith('browser_'))).toEqual([])
  })

  it('但 allToolNames() 要有它们，否则 skill 体检会误报', () => {
    const names = allToolNames()

    expect(names.has('browser_open')).toBe(true)
    expect(names.has('browser_interact')).toBe(true)
  })

  it('工具名符合厂商约定，否则请求会被直接拒', () => {
    for (const tool of buildAllTools()) {
      expect(tool.name, `非法工具名: ${tool.name}`).toMatch(/^[a-zA-Z0-9_-]{1,64}$/)
    }
  })

  it('每个工具都有可用的 JSON Schema', () => {
    for (const tool of buildAllTools()) {
      const params = tool.parameters as { type?: string }
      expect(params, `${tool.name} 缺 parameters`).toBeTruthy()
      expect(params.type, `${tool.name} 的 schema 不是 object`).toBe('object')
    }
  })

  it('每个工具都有非空描述 —— 模型全靠它选工具', () => {
    for (const tool of buildAllTools()) {
      expect(tool.description.length, `${tool.name} 描述为空`).toBeGreaterThan(10)
    }
  })

  it('每个工具都带 V3 元数据（审批门和过滤依赖它）', () => {
    for (const tool of buildAllTools()) {
      expect(tool.unrealBox.namespace, `${tool.name} 缺 namespace`).toBeTruthy()
      expect(['safe', 'mutating', 'destructive']).toContain(tool.unrealBox.risk)
    }
  })

  it('描述里不再残留 V2 的点号工具名', () => {
    const stale: string[] = []
    for (const tool of buildAllTools()) {
      const hit = tool.description.match(/\b(blueprint|material|widget)\.[a-z_]+\b/g)
      if (hit) stale.push(`${tool.name}: ${hit.join(', ')}`)
    }
    expect(stale).toEqual([])
  })

  it('旧笔记工具不再暴露，知识库来源工具只在绑定知识库后出现', () => {
    const legacyNoteTools = [
      'get_note',
      'search_notes',
      'create_note',
      'update_note',
      'delete_note'
    ]
    const defaultTools = buildAllTools().map((t) => t.name)
    expect(defaultTools).not.toEqual(expect.arrayContaining(legacyNoteTools))

    resetToolCacheForTest()
    const notebook = { id: 'notebook-1', title: '研究资料' }
    const withoutSender = buildAllTools({ notebook }).map((t) => t.name)
    expect(withoutSender).toContain('search_notebook_sources')
    expect(withoutSender).not.toContain('add_notebook_source')

    resetToolCacheForTest()
    const fakeSender = { send: () => undefined } as unknown as WebContents
    const withSender = buildAllTools({ notebook, sender: fakeSender }).map((t) => t.name)
    expect(withSender).toContain('add_notebook_source')

    resetToolCacheForTest()
    const unboundWithSender = buildAllTools({ sender: fakeSender }).map((t) => t.name)
    expect(unboundWithSender).toContain('add_notebook_source')
  })

  it('覆盖了全部预期的命名空间', () => {
    const namespaces = new Set(buildAllTools().map((t) => t.unrealBox.namespace))
    expect([...namespaces].sort()).toEqual([
      // 生图、视频、3D。用用户自己配的 Provider 直连厂商
      'aigc',
      'asset',
      // 盒子本身：对话记录、状态、技能 / MCP / 导入 / 备份的管理（builtin/box.ts）
      'box',
      // 检查、试玩、截图：起一个无头 Godot，不需要编辑器开着
      'godot',
      // 精灵、瓦片、音效、循环音乐、配音：直接写成工程里的 Godot 资源
      'godot.asset',
      // 用户开着的那个编辑器：要 GDBox Link 连着（见 toolNames.ts 的 needsEditor）
      'godot.editor',
      // 工程的美术风格包
      'godot.style',
      // 本地文件读写 / 查找 / 搜索
      'local',
      // 跑 shell 命令。单独一个命名空间，好让 resolveTools 在没有 shell 的机器上整个不注册
      'local.shell',
      // 接入第三方 MCP server（connect_mcp_server）
      'mcp',
      'note',
      'project',
      'video.production',
      // 无头检索（web_search / web_read）。只读、不开窗口、不弹审批
      'web'
    ])
  })

  it('Godot 的检查、试玩、截图都是只读且串行：两个 Godot 同时导入同一个工程会互相踩缓存', () => {
    const byName = new Map(buildAllTools().map((t) => [t.name, t]))
    for (const name of ['godot_check', 'godot_run', 'godot_screenshot']) {
      const tool = byName.get(name)
      expect(tool, name).toBeDefined()
      expect(tool!.unrealBox.risk, name).toBe('safe')
      expect(tool!.executionMode, name).toBe('sequential')
    }
  })

  it('动编辑器的工具都在 godot.editor 下，编辑器没连上时整组拿掉', () => {
    const editorTools = buildAllTools()
      .filter((t) => t.name.startsWith('editor_'))
      .map((t) => [t.name, t.unrealBox.namespace])
    expect(editorTools.length).toBeGreaterThan(0)
    for (const [name, namespace] of editorTools) expect(namespace, name).toBe('godot.editor')
  })
})

/**
 * 「设置 → 工具」那一页的清单。
 *
 * 它比后端窄的话，用户会在清单里找不到一个正在跑的工具 —— 然后以为盒子
 * 根本没有这个能力。
 */
describe('listToolCatalog', () => {
  it('覆盖全部工具，并补上按会话现造的浏览器那一摊', () => {
    const names = listToolCatalog().map((entry) => entry.name)
    for (const tool of buildAllTools()) expect(names).toContain(tool.name)
    expect(names).toContain('browser_open')
  })

  it('每一条都带得起设置页要显示的东西', () => {
    for (const entry of listToolCatalog()) {
      expect(entry.namespace).toBeTruthy()
      expect(entry.description).toBeTruthy()
      expect(['safe', 'mutating', 'destructive']).toContain(entry.risk)
      expect(typeof entry.defaultResident).toBe('boolean')
      // 0 会让设置页把「每次对话多付多少」算少，而那正是这个数存在的理由
      expect(entry.tokens).toBeGreaterThan(0)
    }
  })

  // 一份工具定义里最贵的常常是参数表，不是说明。只量说明会把复杂入参的工具
  // 算得比实际便宜一大截，用户照着这个数去瘦身就会砍错人
  it('token 估算把参数表也算进去', () => {
    const byName = new Map(listToolCatalog().map((entry) => [entry.name, entry]))
    const tool = buildAllTools().find((entry) => entry.name === 'godot_run')!
    expect(byName.get('godot_run')!.tokens).toBeGreaterThan(estimateTokens(tool.description))
  })

  // 第三方 MCP 归「MCP」设置页管。同一批工具两个页面各有一个开关，
  // 用户关了一个发现还在，只会以为开关坏了
  it('不含第三方 MCP', () => {
    expect(listToolCatalog().filter((entry) => entry.namespace.startsWith('mcp.'))).toEqual([])
  })

  // 默认常驻清单是这一页每个开关的起手状态，读错了用户看到的就是一页假开关
  it('默认常驻状态跟着内置清单走', () => {
    const byName = new Map(listToolCatalog().map((entry) => [entry.name, entry.defaultResident]))
    expect(byName.get('godot_check')).toBe(true)
    // 生成资源说明长、只在要素材时用，留在折叠区
    expect(byName.get('gen_sprite')).toBe(false)
  })
})

/*
 * 「工具定义总量」那道门禁已经没有了，这里不要再加回来。
 *
 * 它先是在本文件里用 `字符数 / 3.6` 估算、只量 `buildAllTools()`、阈值 60,000。
 * 2026-09-17 拿真 tokenizer 复核，三个方向同时是错的：换算低估中文 1.84 倍、
 * 范围漏掉 skill 与系统提示词、而且因为只有中文被低估，工具之间的偏差不均匀
 * （1.33x ~ 2.15x）—— 等于一张会把「描述很长」的工具藏起来的排行榜。
 *
 * 换上的逐工具棘轮（`core/toolBudget.test.ts`）量得准，但把前缀钉成了**零和**：
 * 任何一个工具多写一行、任何一个新工具，都要先从别处砍等量的字。真用起来，
 * 它拦下的不是「描述变胖」，而是「新能力写不进文档」—— 而那正是这个仓库在做的事。
 * 2026-09-20 整个删掉。前缀成本该在设计工具时权衡，不该由一道只准变小的棘轮代劳；
 * 真正解决零和的是工具搜索（延迟加载），不是记账。
 */

/**
 * 渲染层「本轮改动」按这张表认哪些调用改了东西 —— 表里没有的一律当只读略过。
 * 漏一个写工具，它做的事就从用户眼前消失了（原来 connect_mcp_server 就不在表里）。
 */
describe('listToolRisks', () => {
  it('每个会改东西的工具都在风险表里，而且级别一致', () => {
    const table = listToolRisks()
    const wrong = buildAllTools()
      .filter((tool) => tool.unrealBox.risk !== 'safe' && table[tool.name] !== tool.unrealBox.risk)
      .map((tool) => `${tool.name}:${tool.unrealBox.risk}->${table[tool.name]}`)
    expect(wrong).toEqual([])
  })
})
