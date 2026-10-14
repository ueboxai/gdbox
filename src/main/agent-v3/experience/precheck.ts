/**
 * 执行前提醒：往 `.gd` 里写东西之前，新写的文字就看得见；里面用了已验证的错误写法就先拦一次。
 *
 * ## 为什么值得
 *
 * 报错后再挂经验，是事后补救；而研究显示正确的经验摆在眼前，模型也只有一半时候照做。
 * 模型照着 Godot 3 的旧文档写 `extends KinematicBody2D`、`yield(...)`、`.instance()`，
 * 在本版本已经确认不行 —— 没必要先写进去、跑一遍 `godot_check`、等引擎报错、再绕回来改。
 *
 * ## 为什么只拦一次
 *
 * 规则是死的，场景是活的：`.instance` 在 PackedScene 上不存在，换个类也许就有。
 * 拦下时说清楚「确定没问题就原样再发一次」，同一次写入第二次发来直接放行。
 * 放行之后下一次检查过了，说明这次拦错了 —— 那条经验从已验证降回试用，不再拦（`runtime.ts`）。
 *
 * ## 只用已验证的
 *
 * 试用中的经验还没证明自己，拿它拦路的代价比挂在报错后面大得多。
 */

import { createHash } from 'crypto'

import type { LayeredEntry } from './recall'

/** 一次写入的指纹（文件 + 新文字），用来认「同一次又发了一遍」 */
export function codeDigest(code: string): string {
  return createHash('sha1').update(code).digest('hex').slice(0, 16)
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 错误写法 → 在代码里找它的正则。
 *
 * 两头都要看边界：
 * - 结尾补单词边界：`.instance` 不能命中 `.instance_from_id()`；
 * - 以字母开头的（`onready`、`rand_range`、`kinematicbody2d`）前面不能是字母、`@` 或 `.`：
 *   `@onready` 恰恰是正确写法，`my_rand_range` 是工程自己的函数，`obj.yield` 是别的东西。
 * 不分大小写：报错归一化成了小写，从报错推出来的写法也是小写，而脚本里写的是 `KinematicBody2D`。
 */
export function avoidPattern(avoid: string): RegExp {
  const head = /^\w/.test(avoid) ? '(?<![\\w@.])' : ''
  const tail = /\w$/.test(avoid) ? '\\b' : ''
  return new RegExp(`${head}${escapeRegExp(avoid)}${tail}`, 'i')
}

/**
 * 新文字里**新引入**了哪些已验证的错误写法。
 *
 * 「新引入」是和旧文字比：只改了文件里别处一行，而这个文件本来就有那个写法，
 * 这一次写入不是罪魁，拦它只会让模型困惑。旧文字不知道（新建文件）就只看新的。
 */
export function findAvoided(
  code: string,
  entries: LayeredEntry[],
  engine: string | undefined,
  previous?: string
): LayeredEntry[] {
  const count = (text: string, pattern: RegExp): number =>
    text.match(new RegExp(pattern.source, 'gi'))?.length ?? 0
  return entries.filter((entry) => {
    if (entry.status !== 'proven' || !entry.avoid) return false
    if (engine && entry.notFor?.includes(engine)) return false
    const pattern = avoidPattern(entry.avoid)
    const now = count(code, pattern)
    return now > 0 && now > (previous === undefined ? 0 : count(previous, pattern))
  })
}

/** 拦下时交给模型的那段话。写成对模型的指示：怎么改、以及确定没问题时怎么放行 */
export function formatPrecheck(entries: LayeredEntry[], engine: string | undefined): string {
  const lines = entries.map((entry) => {
    const versions = entry.engines?.length ? entry.engines.join(', ') : entry.verified?.engine
    return (
      `- \`${entry.avoid}\`: ${entry.advice}` +
      ` (it failed before with "${entry.errorPattern}"${versions ? ` on Godot ${versions}` : ''})`
    )
  })
  return (
    '[Experience check — not written] This GDScript uses something that is known to fail' +
    (engine ? ` on Godot ${engine}` : '') +
    ':\n' +
    lines.join('\n') +
    '\nFix it and write again. If you are sure it is fine here, send the exact same write again and it will go through.'
  )
}
