/** @vitest-environment node */
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { electronMock, servicesMock, targetContextMock } from '../testSupport/toolMocks'

// 工厂要包一层箭头函数：`vi.mock` 提升到 import 之前，直接传引用会在初始化前访问它
vi.mock('electron', () => electronMock())
vi.mock('../../services', () => servicesMock())
vi.mock('../core/projectTargetContext', async (importOriginal) => targetContextMock(importOriginal))

import { lintSkillFile } from '../capabilities/skillLint'
import { allToolNames, buildAllTools } from './registry'

/**
 * 工具名不许指向不存在的工具 —— 常驻上下文的那两处都查：**工具自己的描述**，
 * 和**仓库自带的 skill**。
 *
 * ## 为什么补这道
 *
 * `material_add_node` / `material_connect_pins` 早就下线了
 * （registry.test.ts 里有断言守着它们不许出现），可 `ue-material` 的工具描述和
 * 参数说明里还有 **12 处**在教模型「创建后用 material_add_node 添加节点」，
 * 其中几处还写在 `toOutcome` 里 —— 也就是调用成功之后**当场**递给模型一句
 * 「下一步调这个不存在的工具」。`blueprint_search_nodes` 同样指着
 * `blueprint_add_node`。
 *
 * 这类错不会报错：模型照着调，拿一句「工具不存在」，然后换个名字反复试。
 * 而工具描述是**每一轮都在上下文里**的，代价按会话数计。
 *
 * `skillLint` 已经会查这件事，但它只挂在写入工具的返回值上
 * （registry.ts 的 `lintWrittenSkill`），只体检**模型现写的**那一份；
 * 仓库自带的 skill 和工具描述本身从来没走过那条路。
 *
 * `scripts/check-skills.mjs` 也接不了：它是纯 node 脚本，拿不到注册表
 * （注册表要 import electron 和 services）。所以这道只能是测试。
 *
 * ## 为什么不扫 packages/cli/skills
 *
 * 那批随 gdbox 命令行 发给**外部** agent，教的是命令行子命令，不是这份注册表里的
 * 工具名。拿这里的清单去判它，判出来全是误报。
 */

const known = allToolNames()

/** 真工具名的首段，用来判「这个 token 长得像不像我们的工具名」 */
const PREFIXES = new Set([...known].map((n) => n.split('_')[0]!))

/**
 * 人工过目确认**不是**工具名的 token。
 *
 * 每条都写清它到底是什么 —— 空写一个名字进来，下一个人无从判断该不该删。
 * 加新条目之前先确认它真的不是工具名；这张表变长本身就是个信号。
 */
const NOT_TOOL_NAMES: Record<string, string> = {
  // —— 工具返回体里的字段 ——
  library_sample: 'search_assets 零命中回退时返回的字段',
  // `project_` 是真前缀（project_list / project_organize），所以参数和字段被当成了工具名
  project_path: 'godot_* / gen_* 的参数（工程目录）',
  // `rig_3d_model` 让 `rig` 成了已知前缀，于是它自己的参数被当成了工具名
  rig_type: 'rig_3d_model 的参数（骨骼类型）',

  // —— action 取值 ——
  list_projects: 'project_list 的旧 action 取值',
  // 这两个撞上 update_* / delete_* 两个真前缀，另外三个动作（group_projects 等）
  // 首段不是任何工具的前缀，压根不会被扫到
  update_collection: 'project_organize 的 action 取值',
  delete_collection: 'project_organize 的 action 取值',
  list_presets: 'art_style 的 action 取值',
  load_preset: 'art_style 的 action 取值',
  save_preset: 'art_style 的 action 取值'
}

/**
 * 已下线的工具，**裸名**。
 *
 * 单列，不走下面 `PREFIXES` 那条路：它们的首段可能不是任何现有工具的前缀，
 * 按前缀判压根扫不到。描述或技能里出现这些名字，只能是在教模型调一个不存在的工具。
 */
const RETIRED_BARE_NAMES = ['project_manage', 'list_engines', 'inspect_uasset_file'] as const

/** 从一段文字里挑出「长得像我们的工具名、但注册表里没有」的 token */
function suspects(text: string, wrap: 'backtick' | 'bare'): string[] {
  const pattern =
    wrap === 'backtick'
      ? /`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`/g
      : /\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/g
  const found = new Set<string>()
  for (const m of text.matchAll(pattern)) {
    const token = m[1]!
    // 已下线的裸名先判：它们既不在注册表里，也不该被 NOT_TOOL_NAMES 豁免掉
    if ((RETIRED_BARE_NAMES as readonly string[]).includes(token)) {
      found.add(token)
      continue
    }
    if (known.has(token) || NOT_TOOL_NAMES[token]) continue
    if (!PREFIXES.has(token.split('_')[0]!)) continue
    found.add(token)
  }
  return [...found]
}

describe('工具描述里不许出现不存在的工具名', () => {
  const tools = buildAllTools()

  it('扫得到工具（扫不到说明这道检查是空的）', () => {
    expect(tools.length).toBeGreaterThan(40)
  })

  it('这道检查真的会咬人 —— 编一个带真前缀的假工具名试一次', () => {
    expect(suspects('改完用 godot_compile 编译一下', 'bare')).toEqual(['godot_compile'])
  })

  it('已下线的裸名一个都不许漏', () => {
    for (const name of RETIRED_BARE_NAMES) {
      expect(suspects(`照着 ${name} 写一段逻辑`, 'bare')).toContain(name)
    }
  })

  it.each(tools.map((t) => [t.name, t] as const))('%s', (_name, tool) => {
    // 描述 + 参数说明一起查：`.describe()` 的文字也是模型看得到的，
    const text = `${tool.description ?? ''}\n${JSON.stringify(tool.parameters ?? {})}`
    expect(suspects(text, 'bare')).toEqual([])
  })
})

describe('自带 skill 的机器体检', () => {
  const SKILLS_DIR = join(process.cwd(), 'resources', 'skills')
  const skillNames = readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()

  it('扫得到 skill（扫不到说明这道检查是空的）', () => {
    expect(skillNames.length).toBeGreaterThan(5)
  })

  it.each(skillNames)('%s 结构完好、没有不存在的工具名', async (name) => {
    const problems = await lintSkillFile(join(SKILLS_DIR, name, 'SKILL.md'), known)

    // blocking = 这个 skill 根本加载不进来。文件躺在盘上、清单里没有，
    // 开发机上完全看不出来，用户那边表现为「这功能时灵时不灵」
    expect(problems.filter((p) => p.severity === 'blocking').map((p) => p.message)).toEqual([])

    // warn 里混着字段名和取值，靠上面那张表认领；剩下的必须是真问题
    const body = problems.map((p) => p.message).join('\n')
    expect(suspects(body, 'backtick')).toEqual([])
  })
})
