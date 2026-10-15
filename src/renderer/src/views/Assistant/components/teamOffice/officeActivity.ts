/**
 * 队员此刻在干什么 → 办公室里的小人该做什么动作。
 *
 * 只按工具名的词根粗分五类，分错了顶多是小人换个姿势，不影响任何判断；
 * 小人头顶的悬停卡片照样写着真实的工具名。
 */

export type ToolKind =
  /** 改东西：建、设、连、删、存 —— 敲键盘 */
  | 'write'
  /** 看东西：读图表、搜资产、查日志 —— 盯屏幕、翻页 */
  | 'read'
  /** 等机器：编译、跑脚本、执行命令 —— 往后一靠等进度条 */
  | 'run'
  /** 看画面：截图、对准视口 —— 屏幕上是一张小风景 */
  | 'look'
  /** 试玩 —— 拿手柄 */
  | 'play'
  /** 跟队友说话 */
  | 'talk'

const RULES: [RegExp, ToolKind][] = [
  [/^team_/, 'talk'],
  // godot_run 是按时间表按键试玩；editor_play 是在编辑器里跑起来
  [/(^godot_run$|^editor_play$|playtest)/, 'play'],
  [/(screenshot|capture|preview|analyze_(image|video))/, 'look'],
  // 检查、生图生音、跑命令：等机器
  [/(^godot_check$|^gen_|compile|run_|build|restart)/, 'run'],
  [
    /(describe|_get_|search|list|inspect|audit|dependencies|referencers|read|find|scene_tree|log|stats|ranking|refs)/,
    'read'
  ]
]

export function toolKind(tool: string | undefined): ToolKind {
  const name = (tool ?? '').toLowerCase()
  for (const [pattern, kind] of RULES) if (pattern.test(name)) return kind
  return 'write'
}
