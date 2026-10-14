/**
 * 到引擎里验真：Python 经验写入前，用只读探针确认它说的是事实。
 *
 * ## 为什么 Python 经验能验、而且值得验
 *
 * 「Character 没有 is_hidden、要用 is_hidden_ed」是一条可以直接问引擎的事实：
 * 找到 `unreal.Character`，看 `dir()` 里有没有这两个名字。研究里让整理员先到环境里实测
 * 再写记忆，通过率从 39% 升到 73%（2609.11060）。别的工具的经验没有这么便宜的验法。
 *
 * ## 三种结论
 *
 * - confirmed：旧写法确实不存在（给了新写法的话，新写法确实存在）—— 写入时注明「编辑器里核实过」；
 * - refuted：旧写法其实存在，或新写法也不存在 —— 这条经验是错的，不写；
 * - unknown：编辑器没开、类没找到、脚本没跑通 —— 照旧以试用身份写入，交给试用期去验。
 *
 * 探针只读：只做 `dir()`，不改任何东西。
 */

export interface ProbeQuery {
  projectRoot: string
  /** 类名（小写，来自报错），`unreal` 表示模块本身 */
  owner: string
  /** 不存在的那个成员（小写） */
  member: string
  /** 成功那次换上的成员（小写）。抽不出来就不查 */
  prefer?: string
}

export type ProbeVerdict = 'confirmed' | 'refuted' | 'unknown'

export type EditorProbe = (query: ProbeQuery) => Promise<ProbeVerdict>

/** 「类.成员」→ 探针要查的东西。函数参数那种（`f(p)`）不查 */
export function probeTarget(symbol: string): { owner: string; member: string } | undefined {
  const match = symbol.match(/^([\w]+)\.(\w+)$/)
  return match ? { owner: match[1], member: match[2] } : undefined
}

/**
 * 探针脚本。名字全部按小写比：报错归一化成了小写，而引擎里是 `Character`、`LevelEditorPlaySettings`。
 * 结果放进 `output_data`，由 `runEditorPython` 读回来。
 */
export function buildProbeScript(query: Omit<ProbeQuery, 'projectRoot'>): string {
  const args = JSON.stringify({
    owner: query.owner,
    member: query.member,
    prefer: query.prefer ?? null
  })
  return `import unreal, json
_q = json.loads(${JSON.stringify(args)})
def _find(name):
    for n in dir(unreal):
        if n.lower() == name:
            return getattr(unreal, n)
    return None
_owner = unreal if _q['owner'] == 'unreal' else _find(_q['owner'])
if _owner is None:
    output_data = {'verdict': 'unknown'}
else:
    _names = set(n.lower() for n in dir(_owner))
    if _q['member'] in _names:
        output_data = {'verdict': 'refuted'}
    elif _q['prefer'] and _q['prefer'] not in _names:
        output_data = {'verdict': 'refuted'}
    else:
        output_data = {'verdict': 'confirmed'}
`
}

export function readProbeVerdict(output: Record<string, unknown> | undefined): ProbeVerdict {
  const verdict = output?.verdict
  return verdict === 'confirmed' || verdict === 'refuted' ? verdict : 'unknown'
}

/**
 * 真正去问引擎的那个探针。
 *
 * 虚幻版本是到连着的编辑器里跑 Python 的 `dir()`；Godot 这边还没接上
 * （对应做法是问 `ClassDB.class_has_method`），先一律回 unknown ——
 * 经验照旧以试用身份写入，交给试用期去验。
 */
export function createEditorProbe(_timeoutMs = 30_000): EditorProbe {
  return async () => 'unknown'
}
