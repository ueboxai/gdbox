/**
 * 报错片段够不够具体：太宽的片段会命中不相干的报错。以及：这条报错说的是哪个 API。
 *
 * ## 为什么要管
 *
 * 召回的判据是「归一化后的报错里原样含有这一段」。片段写成 `not found`，
 * 所有 not found 都会命中；写成 `nonexistent function`，GDScript 里一半的运行错误都会命中。
 * 研究里叫负迁移：召回了不相关的经验，比不召回更糟。
 *
 * ## 验证工具要更严
 *
 * `godot_check` 和 `godot_run` 跑的是模型现写的 GDScript，报错来自脚本里任何地方。
 * 同一个工具名下，今天是「`KinematicBody2D` 找不到」，明天是「`move_and_slide()` 参数太多」——
 * 工具名这把钥匙几乎不起区分作用，区分全压在片段上。所以对它们：
 *
 * - 不学脚本自己的 bug：自己的变量名打错（`Identifier "velocity_y" not declared`）、
 *   语法错、空引用（`on a base object of type 'Nil'`）、越界、节点路径写错。
 *   那是这一次现写的代码写错了，不是引擎的规矩，下次写的是另一段代码。
 *   例外是 Godot 3 时代的名字（`rand_range`、`KinematicBody2D`）：报的也是「没声明」「找不到」，
 *   但知识正在这里 —— 模型照着旧文档写，Godot 4 里改名了。
 * - 片段必须带一个引号里的名字（类名、方法名、属性名、关键字），知识就在那个名字上。
 *   Godot 的报错单引号双引号都用（`'foo'`、`"move_and_slide()"`），两种都认。
 * - 片段要覆盖报错信息的大半（≥ 50%）。召回时拿**新报错**再算一次：
 *   新报错里只有一小部分和片段重合，说明是另一件事。
 *
 * 同一套判据在两个地方用：整理员写入前（`curator.ts`），召回时（`recall.ts`）——
 * 后者兜住手改过的、以及这条规则之前写下的旧经验。
 */

import { VERIFY_TOOLS } from './godotTools'

/** 片段最短多长。6 太短：`failed` 就满足了 */
export const MIN_PATTERN_LENGTH = 12
/** 验证工具：片段至少覆盖报错信息的这么多 */
export const MIN_COVERAGE = 0.5

/**
 * 报错里的通用词：光靠它们拼出来的片段，什么报错都能对上。
 * 全是小写（归一化之后的样子）。
 */
const GENERIC_WORDS = new Set(
  (
    'error errors failed failure fail fails not found invalid cannot can could unable none null ' +
    'nonetype object attribute value type types missing unknown exception warning the a an to for of in ' +
    'on with is was are has have no at by from and or be been did does expected got given argument ' +
    'arguments parameter parameters property function method class module name file path id line ' +
    'call calling convert when this that must should required no such exist exists does done ' +
    'traceback most recent last str int float bool list dict tuple set real number string ' +
    'parse script identifier declared current scope base nonexistent access key index get too many ' +
    'few received least find member members variable signal node nil self'
  ).split(' ')
)

/** 中文里的通用词。四个字以上的中文串去掉它们后还剩字，才算具体 */
const GENERIC_CJK = /失败|错误|未找到|找不到|无效|不存在|无法|不能|异常|超时|请|重试|检查/g

/** 引号里的名字。Godot 单双引号都用 */
const QUOTED = /['"]([^'"]{2,})['"]/g

/**
 * 引号里出现、但不是「报错在说的那个东西」的词：词法单元名（`Unexpected "Identifier"`）
 * 和内置类型名（`argument 2 should be "Callable"`）。
 */
const GENERIC_QUOTED = new Set(
  // 逗号分隔：`null instance` 是一个词，拆开的话 `instance` 本身（Godot 3 的方法名）会被跳过
  (
    'identifier,annotation,indent,dedent,newline,literal,end of file,int,float,string,bool,nil,' +
    'null,null instance,variant,array,dictionary,callable,object,stringname,nodepath'
  ).split(',')
)

/** 片段里能起区分作用的词：引号里的名字、带下划线/点的标识符、不在通用词表里的词、中文实词 */
export function distinctiveTokens(pattern: string): string[] {
  const text = pattern.toLowerCase().replace(/<(n|id|path)>/g, ' ')
  const tokens: string[] = []
  for (const quoted of text.matchAll(QUOTED)) tokens.push(quoted[1])
  for (const word of text.match(/[a-z_][a-z0-9_.]*/g) ?? []) {
    if (word.length >= 3 && !GENERIC_WORDS.has(word)) tokens.push(word)
  }
  for (const run of text.match(/[一-鿿]{2,}/g) ?? []) {
    if (run.replace(GENERIC_CJK, '').length >= 2) tokens.push(run)
  }
  return [...new Set(tokens)]
}

export type PatternProblem =
  | 'too-short'
  | 'generic'
  | 'not-in-error'
  | 'script-bug'
  | 'no-identifier'
  | 'too-wide'

/**
 * Godot 3 里有、Godot 4 里改了名或删了的名字（全小写）。
 *
 * 「没声明」「找不到类型」「self 上没有这个函数」这几种报错，名字是模型自己起的就是笔误，
 * 是这张表里的就是旧版本 API —— 后者正是最值得学的那类。表只收常见的，漏了的代价是
 * 少学一条，宁可漏。
 */
export const GODOT3_NAMES: ReadonlySet<string> = new Set(
  // 节点和类型
  (
    'kinematicbody2d kinematicbody spatial position2d position3d sprite animatedsprite particles ' +
    'particles2d ysort navigation navigation2d navigationmeshinstance navigationpolygoninstance ' +
    'visibilitynotifier visibilitynotifier2d visibilityenabler visibilityenabler2d rigidbody ' +
    'staticbody area camera meshinstance collisionshape collisionpolygon raycast light ' +
    'directionallight omnilight spotlight listener listener2d giprobe bakedlightmap ' +
    'viewportcontainer toolbutton popupdialog windowdialog arvrcamera arvrorigin cubemesh ' +
    'physicsbody softbody vehiclebody reference funcref file directory quat transform ' +
    'poolbytearray poolintarray poolrealarray poolstringarray poolvector2array poolvector3array ' +
    'poolcolorarray audiostreamsample audiostreamoggvorbis dynamicfont dynamicfontdata ' +
    // 全局函数
    'rand_range stepify deg2rad rad2deg linear2db db2linear range_lerp polar2cartesian ' +
    'cartesian2polar str2var var2str bytes2var var2bytes parse_json to_json validate_json ' +
    'nearest_po2 inst2dict dict2inst colorn decimals dectime yield ' +
    // 关键字（Godot 4 改成了注解或 await）
    'onready export tool remote master puppet remotesync mastersync puppetsync setget ' +
    // 常量
    'button_left button_right button_middle button_wheel_up button_wheel_down'
  ).split(' ')
)

/**
 * 报错在说的 API。形状有三种：
 *
 * - `characterbody2d.foo`：某个引擎类上没有的方法 / 属性；
 * - `move_and_slide`、`rand_range`、`kinematicbody2d`：一个裸的函数名、全局名或类型名；
 * - `onready`、`yield`：Godot 4 删掉的关键字。
 *
 * `kind` 决定它在哪些情况下是脚本自己的 bug（见 `errorProblem`）。
 */
interface SymbolRule {
  pattern: RegExp
  kind: 'member' | 'call' | 'name' | 'keyword' | 'signature'
  symbol: (m: RegExpMatchArray) => string
}

// 规则照 Godot 4 的报错原文写（`modules/gdscript` 的解析器与运行时）；顺序要紧，先窄后宽
const Q = `['"]`
const SYMBOL_RULES: SymbolRule[] = [
  {
    pattern: new RegExp(`nonexistent function ${Q}(\\w+)${Q} in base ${Q}(\\w+)${Q}`),
    kind: 'member',
    symbol: (m) => `${m[2]}.${m[1]}`
  },
  {
    pattern: new RegExp(`invalid call to function ${Q}(\\w+)${Q} in base ${Q}(\\w+)${Q}`),
    kind: 'member',
    symbol: (m) => `${m[2]}.${m[1]}`
  },
  {
    pattern: new RegExp(
      `invalid (?:access to|assignment of) property or key ${Q}(\\w+)${Q}.*?base object of type ${Q}(\\w+)${Q}`
    ),
    kind: 'member',
    symbol: (m) => `${m[2]}.${m[1]}`
  },
  {
    pattern: new RegExp(`invalid (?:get|set) index ${Q}(\\w+)${Q} \\(on base: ${Q}(\\w+)${Q}\\)`),
    kind: 'member',
    symbol: (m) => `${m[2]}.${m[1]}`
  },
  {
    pattern: new RegExp(`function ${Q}(\\w+)\\(\\)${Q} not found in base self`),
    kind: 'name',
    symbol: (m) => m[1]
  },
  {
    pattern: new RegExp(`function ${Q}(\\w+)\\(\\)${Q} not found in base ${Q}?(\\w+)`),
    kind: 'member',
    symbol: (m) => `${m[2]}.${m[1]}`
  },
  {
    pattern: new RegExp(`cannot find member ${Q}(\\w+)${Q} in base ${Q}(\\w+)${Q}`),
    kind: 'member',
    symbol: (m) => `${m[2]}.${m[1]}`
  },
  {
    pattern: new RegExp(
      `(?:too (?:many|few) arguments|invalid arguments?) for ${Q}(\\w+)\\(\\)${Q}`
    ),
    kind: 'call',
    symbol: (m) => m[1]
  },
  {
    pattern: new RegExp(`identifier ${Q}(\\w+)${Q} not declared`),
    kind: 'name',
    symbol: (m) => m[1]
  },
  {
    pattern: new RegExp(`could not (?:find|resolve) (?:type|base class|class) ${Q}(\\w+)${Q}`),
    kind: 'name',
    symbol: (m) => m[1]
  },
  {
    pattern: new RegExp(`${Q}(\\w+)${Q} (?:keyword )?was removed`),
    kind: 'keyword',
    symbol: (m) => m[1]
  },
  {
    pattern: new RegExp(`signature doesn't match the parent\\. parent signature is ${Q}(\\w+)\\(`),
    kind: 'signature',
    symbol: (m) => m[1]
  }
]

function matchSymbol(
  normalizedError: string
): { symbol: string; kind: SymbolRule['kind'] } | undefined {
  for (const rule of SYMBOL_RULES) {
    const match = normalizedError.match(rule.pattern)
    if (match) return { symbol: rule.symbol(match), kind: rule.kind }
  }
  return undefined
}

export function godotSymbol(normalizedError: string): string | undefined {
  return matchSymbol(normalizedError)?.symbol
}

/** 空引用：`on a base object of type 'Nil'`、`(on base: 'null instance')` —— 这是脚本的事 */
const NULL_BASE =
  /(?:base object of type|on base:?|in base) ['"]?(?:nil|null instance|previously freed)\b/
/** 一看就是这段脚本自己写坏了的运行错误和语法错误 */
const OWN_BUG =
  /out of bounds|division by zero|stack overflow|infinite recursion|node not found|cannot find node|^parse error: (?:expected |unexpected |mixed use of tabs|unindent|unterminated|invalid indentation|closing )/

/**
 * 这一次报错本身值不值得学（还没到片段那一步）。只对验证工具有额外要求。
 * 整理员用它提前筛掉，省得为一条注定被丢掉的经验花一次模型调用。
 */
export function errorProblem(tool: string, normalizedError: string): PatternProblem | undefined {
  if (!VERIFY_TOOLS.has(tool)) return undefined
  const e = normalizedError
  if (NULL_BASE.test(e) || OWN_BUG.test(e)) return 'script-bug'
  const found = matchSymbol(e)
  // 名字是自己起的：笔误，不是规矩
  if (found?.kind === 'name' && !GODOT3_NAMES.has(found.symbol)) return 'script-bug'
  if (!found && !subjectName(e)) return 'no-identifier'
  return undefined
}

/** 归一化后的报错去掉 `parse error: ` 这个前缀：覆盖率按真正的信息算 */
function messageBody(normalizedError: string): string {
  return normalizedError.replace(/^parse error:\s*/, '')
}

/**
 * 片段对这条报错来说够不够具体。没问题回 undefined。
 *
 * `normalizedError` 在写入时是学到它的那次报错，在召回时是**这一次**的新报错。
 */
export function patternProblem(
  tool: string,
  pattern: string,
  normalizedError: string
): PatternProblem | undefined {
  const p = pattern.trim().toLowerCase()
  if (p.length < MIN_PATTERN_LENGTH) return 'too-short'
  if (!normalizedError.includes(p)) return 'not-in-error'
  if (distinctiveTokens(p).length === 0) return 'generic'

  const fromError = errorProblem(tool, normalizedError)
  if (fromError) return fromError
  if (!VERIFY_TOOLS.has(tool)) return undefined

  if (!/['"][^'"<>]{2,}['"]/.test(p)) return 'no-identifier'
  // 片段带着 `parse error:` 就和整行比，不带就和后面的信息比
  const target = p.startsWith('parse error') ? normalizedError : messageBody(normalizedError)
  if (p.length / target.length < MIN_COVERAGE) return 'too-wide'
  // 报错在说的那个名字必须在片段里。`in base 'packedscene'` 带了名字、也够长，
  // 可它对 PackedScene 上的任何方法都成立 —— 知识在前面那个 `'instance'` 上
  const subject = subjectName(normalizedError)
  if (subject && !p.includes(`'${subject}'`) && !p.includes(`"${subject}"`)) return 'too-wide'
  return undefined
}

/**
 * 报错在说的那个名字：信息里第一个引号名，跳过带占位符的（每次都变，不是知识）
 * 和词法单元、内置类型名（`"Identifier"`、`"Callable"`）。
 *
 * 「第一个」是看 Godot 的报错定的：`Nonexistent function 'foo' in base 'CharacterBody2D'`、
 * `Too many arguments for "move_and_slide()" call`、`Could not find type "KinematicBody2D"` ——
 * 缺的那个东西在前、所属的类在后。（虚幻的 Python 报错恰好相反。）
 */
export function subjectName(message: string): string | undefined {
  for (const match of message.matchAll(QUOTED)) {
    const name = match[1]
    if (name.includes('<') || GENERIC_QUOTED.has(name.trim())) continue
    return name
  }
  return undefined
}

/**
 * 一次调用的 API 钥匙：验证工具看报错。普通工具没有第二把钥匙，回 undefined。
 *
 * 有了它，召回从「报错里含这一段」收紧到「说的是同一个 API」，还能在改文件**之前**
 * 扫新写的脚本里有没有已知的错误写法（见 `precheck.ts`）。认不出的回 undefined ——
 * 那条经验就只按片段匹配，不做执行前提醒。
 */
export function symbolOf(tool: string, normalizedError: string): string | undefined {
  return VERIFY_TOOLS.has(tool) ? godotSymbol(normalizedError) : undefined
}

/** 「类.成员」里的成员名。裸名字回 undefined */
export function attributeMember(symbol: string): string | undefined {
  const match = symbol.match(/^\w+\.(\w+)$/)
  return match?.[1]
}

/**
 * 钥匙在脚本里长什么样：`packedscene.instance` 在脚本里是 `.instance`（前面是哪个变量不知道），
 * 裸名字（`rand_range`、`kinematicbody2d`、`onready`）就是它本身。
 */
export function avoidOf(symbol: string): string {
  const member = attributeMember(symbol)
  return member ? `.${member}` : symbol
}

/**
 * 这个名字是不是工程自己声明的（`func jump(`、`var speed`、`class_name Player`）。
 * 报错说「`'jump'` 参数不对」，而 `jump` 是工程自己写的函数 —— 那是脚本的事，不是引擎的规矩。
 */
export function declaresName(text: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(
    `(?:^|\\n)\\s*(?:static\\s+)?(?:func|var|const|signal|class_name|class|enum)\\s+${escaped}\\b`,
    'i'
  ).test(text)
}
