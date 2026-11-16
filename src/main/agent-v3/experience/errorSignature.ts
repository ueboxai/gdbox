/**
 * 工具报错的两件事：它值不值得学，以及把它压成能拿来比对的形状。
 *
 * ## 为什么先分「环境类」和「可学类」
 *
 * 2026-09-30 从一台开发机最近 400 个会话里抽过真实报错：7084 次工具调用、594 次失败，
 * 其中约 43% 是环境噪声 —— 用户按了停止、RPC 超时、编辑器没连、别的会话持锁、
 * 参数没过 schema、网络断了、生图配额用完。这些失败和「这一步该怎么做」无关，
 * 下一次同样的调用换个时间就成了。拿它们当经验，经验库第一天就是垃圾场 ——
 * 旧长期记忆下线的头号原因正是垃圾太多。
 *
 * 剩下的才是真知识：API 用错（那次抽样来自虚幻盒子，最多的是引擎 Python 的
 * `'Character' object has no attribute ...`；Godot 这边对应 GDScript 的解析和运行错误）、
 * 节点找不到、编译诊断、磁盘只读。
 *
 * 虚幻盒子时期的特征（UE 连接、Python 回执、`/Game/` 路径）留着：旧经验库里有，
 * 认得出它们不碍事。
 *
 * ## 为什么归一化而不是原文比对
 *
 * 同一个错误每次带着不同的 RPC id、文件路径、行号、GUID。不抹掉的话，
 * 「这个错之前见过」永远是假。抹的是**会变的部分**，留的是**说明问题的部分** ——
 * `Nonexistent function 'instance' in base 'PackedScene'` 里的 `instance` 就是知识本身，不能抹。
 */

/**
 * 环境类报错的特征。命中任意一条就不学。
 *
 * 每一条都来自真实报错抽样，写宽不写窄：误判成环境类的代价是少学一条，
 * 误判成可学类的代价是经验库进一条垃圾。
 */
const ENVIRONMENTAL_PATTERNS: RegExp[] = [
  // 不认光秃秃的 `timeout`：Godot 的 Timer 信号就叫 timeout，连错它的报错是真知识
  /请求超时|E_TIMEOUT|\btimed[ -]out\b/i,
  // 同理不认光秃秃的 `not connected`：信号没连上是脚本的事
  /没有可用的客户端连接|No Unreal Editor connection|(?:editor|client|websocket) (?:is )?not connected|连接已断开|编辑器已经关闭/i,
  // Python 发出去了但没拿到结果：执行了没有都不知道，谈不上知识
  /没有连接的虚幻引擎项目|未收到 Python 完成结果|Python 执行未确认|未确认执行结果/,
  // 编辑器没连、本机没找到 Godot、没告诉它是哪个工程：装好、指对了就成了，
  // 不是「这一步该怎么做」
  /Godot 编辑器未连接|没有找到 Godot|不知道要操作哪个工程|没有 project\.godot|不是 Godot 工程/,
  // godot_check / godot_run 跑超时、引擎自己崩了（退出码不对但一条错都没打）：
  // 死循环、弹窗卡住、驱动问题，从报错里学不到「该怎么写」（文案见 tools/godot/runtime.ts）
  /did not (?:exit|finish) in time|exited abnormally|ended early \(crash or quit\)/i,
  /Operation aborted|aborted|已取消|用户按了停止/i,
  /另一条 AI (?:会话|对话)|正被.*修改中/,
  /Validation failed for tool/,
  /^Tool \S+ not found/,
  /net::ERR_|ECONNRESET|ECONNREFUSED|ENOTFOUND|socket hang up|fetch failed/i,
  /quota|rate limit|HTTP 4(01|03|29)|HTTP 5\d\d/i,
  /已经失败 \d+ 次，这次调用被拦下了/,
  /拒绝|denied|未批准/i
]

export function isEnvironmentalError(text: string): boolean {
  return ENVIRONMENTAL_PATTERNS.some((pattern) => pattern.test(text))
}

/** Godot 日志里一条报错的开头（`digestGodotLog` 按它切条目，见 `godot/run.ts`） */
const GODOT_ENTRY = /^\s*(SCRIPT ERROR|USER ERROR|ERROR):\s*(.*)$/

/**
 * 加载失败的连带报错：脚本解析错了，后面必跟一句「脚本加载失败」「场景实例化失败」。
 * 它们说的是后果不是原因，同一个原因在不同文件里还会带出不同的后果。
 */
const CONSEQUENCE =
  /failed to load script|failed loading resource|failed to instantiate|couldn't load|cannot open file/i

/**
 * Godot 输出里最说明问题的那一条报错，只留信息那一行。
 *
 * `godot_check` 交回的是好几条报错连在一起，每条后面跟着 `at: GDScript::reload (res://player.gd:12)`
 * 这种位置行。位置每次都变、不说明问题；`SCRIPT ERROR` 才是原因 ——
 * 后面的 `ERROR: Failed to load script ... with error "Parse error"` 只是它的后果。
 * 挑的顺序：脚本报错 > 带 Parse Error 的引擎报错 > 其余报错 > 连带的加载失败，同档取第一条。
 * 不是 Godot 日志（工具自己抛的话）回 undefined，照原文归一化。
 */
export function primaryGodotError(text: string): string | undefined {
  let best: { rank: number; message: string } | undefined
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(GODOT_ENTRY)
    if (!match) continue
    const message = match[2].trim()
    const rank =
      match[1] === 'SCRIPT ERROR'
        ? 0
        : CONSEQUENCE.test(message)
          ? 3
          : /parse error/i.test(message)
            ? 1
            : 2
    if (!best || rank < best.rank) best = { rank, message }
  }
  return best?.message
}

/**
 * 把报错压成能比对的形状：小写、会变的部分换成占位符、空白压成一个。
 *
 * 占位符用尖括号，是为了经验里的 `errorPattern` 也能写成同样的形状
 * （整理员拿到的就是归一化后的文本），比对时两边同一套规则。
 *
 * 数字只抹**独立的**：`CharacterBody2D`、`Node3D` 里的数字是类名的一部分，抹成
 * `characterbody<n>d` 就再也对不上执行前提醒要找的那个写法了。
 */
export function normalizeError(text: string): string {
  const core = primaryGodotError(text) ?? text
  return (
    core
      // 工具自己加的前缀：「godot_check 失败：」
      .replace(/^[a-z0-9_]+ 失败[:：]\s*/i, '')
      .replace(/详情[:：]\s*\{\}/g, '')
      // Godot 有时把出错位置写在前面：`res://player.gd:12 - Parse Error: ...`。
      // 同一个错换个文件、换一行也得认得出来，位置整段去掉
      .replace(/^(?:res|user):\/\/\S+?:\d+\s+-\s+/i, '')
      // 基类后面带的脚本名：`in base 'CharacterBody2D (player.gd)'` —— 说的是引擎类，脚本是哪个不重要
      .replace(/\s\((?:res:\/\/)?[\w./-]+\.gd\)/g, '')
      // 同一条每帧都报，`digestGodotLog` 会在后面标出现次数
      .replace(/\(×\d+\)/g, '')
      // GUID / UUID（RPC id）
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>')
      .replace(/\b[0-9A-F]{32}\b/g, '<id>')
      // 磁盘路径先于工程内路径。盘符前要有单词边界：不然 `res://` 的 `s:/` 会被当成盘符
      .replace(/\b[A-Za-z]:[\\/][^\s'"，,；;）)]+/g, '<path>')
      .replace(/\b(?:res|user):\/\/[^\s'"，,；;：:）)]+/g, '<path>')
      // 虚幻时期的资产路径：旧经验库里有，认得出不碍事
      .replace(/\/(?:Game|Script|Engine|Plugins)\/[^\s'"，,；;：:）)]+/g, '<path>')
      // 独立的数字（行号、参数个数、下标、实例 id）
      .replace(/\b\d+(?:\.\d+)?\b/g, '<n>')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
  )
}

/**
 * 报错的指纹：「同一个错又出现了」的判据。
 *
 * 取归一化文本的开头一段。不取全文，是因为批量工具会把几条失败拼在一起，
 * 顺序一变全文就不同，而第一条失败往往就是那一类问题。
 */
export function errorFingerprint(text: string): string {
  return normalizeError(text).slice(0, 120)
}
