/**
 * 工具的「大类」。设置页按它折叠，主进程和渲染层共用同一张表。
 *
 * ## 为什么不直接把命名空间当大类
 *
 * 命名空间是给**运行时**用的：动态过滤、审批策略、MCP 暴露范围，
 * 所以它按「谁实现的」切分 —— `ue.mesh` 和 `ue.animation` 各走各的通道。
 * 用户不这么想事情：他要么在做动画，不会因为网格走的是另一条 RPC
 * 就把它当成另一件事。
 *
 * 所以这张表把命名空间**合并**成大类，一条命名空间只能进一个大类。
 * 表里没写的命名空间落到 `other`，不会从清单上消失 —— 一个开关页最不能出现的
 * 失效方向，就是「有个工具在跑，但设置页里找不到它」。
 *
 * ## Godot 的按活分，盒子自己的合成一类
 *
 * Godot 工具分两摊：不开编辑器也能做的检查、运行、截图、回放用例（`godot`），
 * 和必须连着编辑器才能用的选中、开场景、运行停止（`godot.editor`）。
 * 素材库、本机文件、联网、知识库、工程管理这些是**盒子自己的能力**，合成一类 ——
 * 摊成六个大类的话，清单顶上一半是只有两三条工具的分组头。
 *
 * 生成（AIGC）单独一类：它不是「把已有的东西找出来、搬过去」，
 * 而是凭空造新素材，也是唯一一摊按次向外部厂商花钱的。
 * 生成进 Godot 项目的精灵图、音效、音乐、配音（`godot.asset`）和画风（`godot.style`）也归这里。
 *
 * ## 第三方 MCP 不在这儿
 *
 * 那些工具归「MCP」设置页管（接哪台服务器、开不开放写操作）。同一批工具
 * 两个页面各有一个开关，用户关了一个发现还在，只会以为开关坏了。
 */

/** 一个大类：id 用来取 i18n 文案，namespaces 是归它管的命名空间 */
export interface ToolCategory {
  id: string
  namespaces: readonly string[]
}

/** 表里没有的命名空间落到这一类。放在最后 */
export const OTHER_TOOL_CATEGORY = 'other'

/**
 * 大类清单。顺序就是设置页里的显示顺序：
 * 先是 Godot 的两摊，再是生成，最后是盒子自己的那一堆。
 */
export const TOOL_CATEGORIES: readonly ToolCategory[] = [
  { id: 'godot', namespaces: ['godot'] },
  { id: 'editor', namespaces: ['godot.editor'] },
  {
    id: 'aigc',
    namespaces: ['aigc', 'video.production', 'godot.asset', 'godot.style']
  },
  // 盒子自己的能力，合成一类：素材库、工程、本机文件与命令行、
  // 联网与浏览器、知识库
  {
    id: 'box',
    namespaces: [
      'asset',
      'library',
      'project',
      'local',
      'local.shell',
      'web',
      'browser',
      'notebook',
      'note',
      'box'
    ]
  }
]

const CATEGORY_BY_NAMESPACE = new Map<string, string>(
  TOOL_CATEGORIES.flatMap((category) =>
    category.namespaces.map((namespace) => [namespace, category.id] as const)
  )
)

/** 这个命名空间归哪个大类。表里没有就归 `other` */
export function toolCategoryId(namespace: string): string {
  return CATEGORY_BY_NAMESPACE.get(namespace) ?? OTHER_TOOL_CATEGORY
}

/** 设置页要显示的一条工具。`defaultResident` 由主进程算好，见 `toolSearch.ts` */
export interface ToolSummary {
  name: string
  namespace: string
  description: string
  risk: string
  defaultResident: boolean
}

export interface ToolCategoryGroup<T> {
  id: string
  tools: T[]
}

/**
 * 按大类分组。空的大类不返回：一个一条工具都没有的分组头只会让人以为清单坏了。
 */
export function groupToolsByCategory<T extends { namespace: string }>(
  tools: readonly T[]
): ToolCategoryGroup<T>[] {
  const buckets = new Map<string, T[]>()
  for (const tool of tools) {
    const id = toolCategoryId(tool.namespace)
    const bucket = buckets.get(id)
    if (bucket) bucket.push(tool)
    else buckets.set(id, [tool])
  }

  // 按表里的顺序，杂项垫底
  const ordered = [...TOOL_CATEGORIES.map((category) => category.id), OTHER_TOOL_CATEGORY]
  return ordered.flatMap((id) => {
    const tools = buckets.get(id)
    return tools ? [{ id, tools }] : []
  })
}

/**
 * 大类开关此刻该显示成什么样。
 *
 * `some` 是**部分打开**：大类开关画成半开（indeterminate），点它会把整组打开。
 * 没有这一档的话，三个小类开着两个时大类只能二选一地撒谎。
 */
export type CategoryToggleState = 'all' | 'none' | 'some'

export function categoryToggleState<T>(
  tools: readonly T[],
  isOn: (tool: T) => boolean
): CategoryToggleState {
  if (tools.length === 0) return 'none'
  let on = 0
  for (const tool of tools) if (isOn(tool)) on += 1
  if (on === 0) return 'none'
  return on === tools.length ? 'all' : 'some'
}

/**
 * 点大类开关之后，整组该变成开还是关。
 *
 * 部分打开时点一下是**全开**而不是全关：这个开关最常见的用途是「把这一摊全给它」，
 * 而误点全关的代价（模型突然不会做这类事，且用户不知道为什么）比误点全开大得多。
 */
export function nextCategoryValue(state: CategoryToggleState): boolean {
  return state !== 'all'
}
