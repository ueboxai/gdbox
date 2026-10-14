/**
 * 到引擎里验真：「类.成员」的经验写入前，用只读探针确认它说的是事实。
 *
 * ## 为什么这类经验能验、而且值得验
 *
 * 「PackedScene 没有 instance()、要用 instantiate()」是一条可以直接问引擎的事实：
 * `ClassDB.class_has_method("PackedScene", "instance")`。研究里让整理员先到环境里实测
 * 再写记忆，通过率从 39% 升到 73%（2609.11060）。别的经验没有这么便宜的验法。
 *
 * ## 三种结论
 *
 * - confirmed：旧写法确实不存在（给了新写法的话，新写法确实存在）—— 写入时注明「编辑器里核实过」；
 * - refuted：旧写法其实存在，或新写法也不存在 —— 这条经验是错的，不写；
 * - unknown：编辑器没开、类没找到、没问出来 —— 照旧以试用身份写入，交给试用期去验。
 */

export interface ProbeQuery {
  projectRoot: string
  /** 类名（小写，来自报错） */
  owner: string
  /** 不存在的那个成员（小写） */
  member: string
  /** 成功那次换上的成员（小写）。抽不出来就不查 */
  prefer?: string
}

export type ProbeVerdict = 'confirmed' | 'refuted' | 'unknown'

export type EditorProbe = (query: ProbeQuery) => Promise<ProbeVerdict>

/** 「类.成员」→ 探针要查的东西。裸名字（`rand_range`、`onready`）不查 */
export function probeTarget(symbol: string): { owner: string; member: string } | undefined {
  const match = symbol.match(/^(\w+)\.(\w+)$/)
  return match ? { owner: match[1], member: match[2] } : undefined
}

/**
 * 真正去问引擎的那个探针。
 *
 * 虚幻版本是到连着的编辑器里跑 Python 的 `dir()`；Godot 这边还没接上
 * （对应做法是让 GDBox Link 插件问 `ClassDB.class_has_method` / `class_get_property_list`），
 * 先一律回 unknown —— 经验照旧以试用身份写入，交给试用期去验。
 */
export function createEditorProbe(): EditorProbe {
  return async () => 'unknown'
}
