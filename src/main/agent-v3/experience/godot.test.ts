/**
 * Godot 的学法：GDScript 报错认 API、笔误不学、「检查失败 → 改文件 → 原样检查通过」配对、
 * 往 .gd 里写之前的执行前提醒。
 */

import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { avoidFromDiff, curateSession, editsDiff, findLessonCandidates } from './curator'
import { normalizeError } from './errorSignature'
import type { ExperienceEntry } from './experienceFile'
import { editOf, isGodotTextPath, verifyOutcome } from './godotTools'
import { avoidPattern, findAvoided } from './precheck'
import type { LayeredEntry } from './recall'
import { createExperienceRuntime } from './runtime'
import { isLearnableMeta } from './session'
import { errorProblem, godotSymbol, patternProblem, subjectName } from './specificity'
import { ExperienceStore, experienceDir } from './store'
import { readTrail, TrailWriter, type TrailCall, type TrailHeader } from './trail'

/** godot_check 交回的报错段（`digestGodotLog` 的形状：条目之间空一行，位置行并在后面） */
const check = (message: string, file = 'player.gd', line = 12): string =>
  `SCRIPT ERROR: ${message}\nat: GDScript::reload (res://${file}:${line})\n\n` +
  `ERROR: Failed to load script "res://${file}" with error "Parse error".\nat: load (modules/gdscript/gdscript.cpp:2936)`
const n = (message: string, file?: string, line?: number): string =>
  normalizeError(check(message, file, line))

const KINEMATIC = n('Parse Error: Could not find type "KinematicBody2D" in the current scope.')

describe('报错归一化', () => {
  it('只留最说明问题的那条，位置、文件名、出现次数都抹掉；类名里的数字不动', () => {
    expect(KINEMATIC).toBe(
      'parse error: could not find type "kinematicbody2d" in the current scope.'
    )
    // 同一个错换个文件、换一行，归一化后一样
    expect(
      n('Parse Error: Could not find type "KinematicBody2D" in the current scope.', 'enemy.gd', 3)
    ).toBe(KINEMATIC)
    expect(
      normalizeError(
        'ERROR: res://scenes/enemy.gd:7 - Parse Error: Identifier "rand_range" not declared in the current scope.'
      )
    ).toBe('parse error: identifier "rand_range" not declared in the current scope.')
    expect(
      normalizeError(
        "SCRIPT ERROR: Invalid call. Nonexistent function 'instance' in base 'PackedScene'.\nat: _ready (res://main.gd:5)\n(×3)"
      )
    ).toBe("invalid call. nonexistent function 'instance' in base 'packedscene'.")
    expect(
      normalizeError(
        "SCRIPT ERROR: Invalid call. Nonexistent function 'jump' in base 'CharacterBody2D (player.gd)'."
      )
    ).toBe("invalid call. nonexistent function 'jump' in base 'characterbody2d'.")
    expect(
      n(
        'Parse Error: Too many arguments for "move_and_slide()" call. Expected at most 0 but received 1.'
      )
    ).toBe(
      'parse error: too many arguments for "move_and_slide()" call. expected at most <n> but received <n>.'
    )
  })

  it('验证工具查出错误算失败，只交出报错那一段；超时、崩了交回那一行', () => {
    const text =
      'Godot exited abnormally during run (exit code 1). This can be a crash; run godot_check again to confirm before concluding.\n\n' +
      `2 error(s):\n\n${check('Parse Error: Could not find type "KinematicBody2D" in the current scope.')}\n\n1 warning(s):\n\nWARNING: x`
    const out = verifyOutcome({ tool: 'godot_check', isError: false, text })
    expect(out.isError).toBe(true)
    expect(out.text.startsWith('SCRIPT ERROR:')).toBe(true)
    expect(out.text).not.toContain('WARNING')
    expect(
      verifyOutcome({ tool: 'godot_check', isError: false, text: 'No errors. Ran 120 frames.' })
        .isError
    ).toBe(false)
    expect(
      verifyOutcome({
        tool: 'godot_run',
        isError: false,
        text: 'The run did not finish in time and was stopped.\n\nNo errors during the run.'
      })
    ).toEqual({ isError: true, text: 'The run did not finish in time and was stopped.' })
    // 别的工具原样
    expect(
      verifyOutcome({ tool: 'godot_editor_x', isError: false, text: '1 error(s):\n\nx' })
    ).toMatchObject({ isError: false })
  })
})

describe('API 钥匙', () => {
  it.each([
    [KINEMATIC, 'kinematicbody2d'],
    [n('Parse Error: Could not find base class "KinematicBody2D".'), 'kinematicbody2d'],
    [
      n(
        'Parse Error: Too many arguments for "move_and_slide()" call. Expected at most 0 but received 1.'
      ),
      'move_and_slide'
    ],
    [n('Parse Error: Function "rand_range()" not found in base self.'), 'rand_range'],
    [n('Parse Error: Identifier "rand_range" not declared in the current scope.'), 'rand_range'],
    [
      n("Invalid call. Nonexistent function 'instance' in base 'PackedScene'."),
      'packedscene.instance'
    ],
    [n("Invalid access to property or key 'bar' on a base object of type 'Node2D'."), 'node2d.bar'],
    [n("Invalid get index 'bar' (on base: 'Node2D')."), 'node2d.bar'],
    [
      n(
        'Parse Error: The "onready" keyword was removed in Godot 4. Use the "@onready" annotation instead.'
      ),
      'onready'
    ],
    [
      n(
        'Parse Error: The function signature doesn\'t match the parent. Parent signature is "_input(InputEvent) -> void".'
      ),
      '_input'
    ],
    [
      n(
        'Parse Error: Invalid argument for "connect()" function: argument 2 should be "Callable" but is "res://player.gd".'
      ),
      'connect'
    ]
  ])('%s → %s', (error, symbol) => {
    expect(godotSymbol(error)).toBe(symbol)
  })

  it('报错在说的名字：单双引号都认，跳过词法单元和内置类型名', () => {
    expect(subjectName(KINEMATIC)).toBe('kinematicbody2d')
    expect(
      subjectName(n("Invalid call. Nonexistent function 'instance' in base 'PackedScene'."))
    ).toBe('instance')
    expect(subjectName('parse error: unexpected "identifier" in class body.')).toBeUndefined()
  })
})

describe('笔误和脚本自己的 bug 不学', () => {
  it.each([
    'Parse Error: Identifier "velocity_y" not declared in the current scope.',
    'Parse Error: Function "my_jump()" not found in base self.',
    'Parse Error: Could not find type "PlayerStats" in the current scope.',
    "Invalid access to property or key 'position' on a base object of type 'Nil'.",
    "Invalid get index 'x' (on base: 'null instance').",
    'Parse Error: Expected end of statement after expression, got "Identifier" instead.',
    'Node not found: "Player/Sprite" (relative to "/root/Main").'
  ])('%s', (message) => {
    expect(errorProblem('godot_check', n(message))).toBe('script-bug')
  })

  it('Godot 3 的旧名字是知识，不算笔误；普通工具不管', () => {
    expect(
      errorProblem('godot_check', n('Parse Error: Function "rand_range()" not found in base self.'))
    ).toBeUndefined()
    expect(errorProblem('godot_check', KINEMATIC)).toBeUndefined()
    expect(errorProblem('godot_editor_set', n('Identifier "x" not declared'))).toBeUndefined()
  })

  it('片段要带着名字、覆盖大半', () => {
    expect(
      patternProblem('godot_check', 'could not find type "kinematicbody2d"', KINEMATIC)
    ).toBeUndefined()
    expect(patternProblem('godot_check', 'could not find type', KINEMATIC)).toBe('generic')
    const instance = n("Invalid call. Nonexistent function 'instance' in base 'PackedScene'.")
    // 带了类名、也够长，但缺了报错在说的那个方法名：对 PackedScene 的任何方法都成立
    expect(patternProblem('godot_check', "function 'instance' in base", instance)).toBe('too-wide')
    expect(patternProblem('godot_check', "in base 'packedscene'.", instance)).toBe('too-wide')
    expect(
      patternProblem(
        'godot_check',
        "nonexistent function 'instance' in base 'packedscene'",
        instance
      )
    ).toBeUndefined()
  })
})

describe('执行前提醒的写法匹配', () => {
  it('`onready` 不误伤 `@onready`；裸名字不误伤别人的名字；成员名带单词边界', () => {
    expect(avoidPattern('onready').test('onready var a = $A')).toBe(true)
    expect(avoidPattern('onready').test('@onready var a = $A')).toBe(false)
    expect(avoidPattern('rand_range').test('var x = rand_range(0, 1)')).toBe(true)
    expect(avoidPattern('rand_range').test('var x = my_rand_range(0, 1)')).toBe(false)
    expect(avoidPattern('rand_range').test('var x = randf_range(0, 1)')).toBe(false)
    expect(avoidPattern('kinematicbody2d').test('extends KinematicBody2D')).toBe(true)
    expect(avoidPattern('.instance').test('scene.instance()')).toBe(true)
    expect(avoidPattern('.instance').test('scene.instantiate()')).toBe(false)
  })

  it('错误写法：改掉的行里有、换上的行里没有；只改了参数的不给', () => {
    const edit = (old: string, code: string): TrailCall => ({
      kind: 'call',
      agent: 's',
      i: 1,
      tool: 'edit_local_file',
      ok: true,
      args: '{}',
      path: 'H:/G/player.gd',
      old,
      code
    })
    expect(
      avoidFromDiff(
        'kinematicbody2d',
        editsDiff([edit('extends KinematicBody2D', 'extends CharacterBody2D')])
      )
    ).toBe('kinematicbody2d')
    expect(
      avoidFromDiff(
        'move_and_slide',
        editsDiff([edit('move_and_slide(velocity, Vector2.UP)', 'move_and_slide()')])
      )
    ).toBeUndefined()
    expect(
      avoidFromDiff(
        'packedscene.instance',
        editsDiff([edit('var e = s.instance()', 'var e = s.instantiate()')])
      )
    ).toBe('.instance')
  })
})

describe('改文件的工具也记账', () => {
  it('只认 Godot 文本文件', () => {
    const local = { namespace: 'local', risk: 'mutating' as const }
    expect(isLearnableMeta(local, { path: 'H:/G/player.gd' }, 'write_local_file')).toBe(true)
    expect(isLearnableMeta(local, { path: 'H:/G/main.tscn' }, 'edit_local_file')).toBe(true)
    expect(isLearnableMeta(local, { path: 'H:/G/project.godot' }, 'edit_local_file')).toBe(true)
    expect(isLearnableMeta(local, { path: 'H:/G/README.md' }, 'write_local_file')).toBe(false)
    expect(isLearnableMeta(local, { path: 'H:/G/player.gd' }, 'read_local_file')).toBe(false)
    expect(
      isLearnableMeta({ namespace: 'mcp', risk: 'mutating' }, { path: 'a.gd' }, 'write_local_file')
    ).toBe(false)
    expect(isGodotTextPath('a.gdshader')).toBe(true)
  })

  it('局部改的两种参数形状都认', () => {
    expect(
      editOf('edit_local_file', {
        path: 'a.gd',
        edits: [
          { oldText: 'a', newText: 'b' },
          { oldText: 'c', newText: 'd' }
        ]
      })
    ).toEqual({ path: 'a.gd', oldText: 'a\nc', newText: 'b\nd' })
    expect(editOf('edit_local_file', { path: 'a.gd', oldText: 'x', newText: 'y' })).toEqual({
      path: 'a.gd',
      oldText: 'x',
      newText: 'y'
    })
    expect(editOf('write_local_file', { path: 'a.gd', content: 'z' })).toEqual({
      path: 'a.gd',
      newText: 'z'
    })
  })
})

describe('检查失败 → 改文件 → 原样检查通过', () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'exp-godot-'))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  const header = (): TrailHeader => ({
    kind: 'header',
    sessionId: 'sess-g',
    projectRoot: join(root, 'Game'),
    engineVersion: '4.3.stable',
    skillLearning: 'ask',
    startedAt: ''
  })
  const checkArgs = JSON.stringify({ frames: 120 })
  const failCheck = (i: number, error = KINEMATIC): TrailCall => ({
    kind: 'call',
    agent: 's',
    i,
    tool: 'godot_check',
    ok: false,
    args: checkArgs,
    error,
    fp: error.slice(0, 120)
  })
  const passCheck = (i: number): TrailCall => ({
    kind: 'call',
    agent: 's',
    i,
    tool: 'godot_check',
    ok: true,
    args: checkArgs
  })
  const edit = (i: number, old: string | undefined, code: string): TrailCall => ({
    kind: 'call',
    agent: 's',
    i,
    tool: old === undefined ? 'write_local_file' : 'edit_local_file',
    ok: true,
    args: '{}',
    path: join(root, 'Game', 'player.gd'),
    code,
    ...(old !== undefined ? { old } : {})
  })

  it('参数一字不差，但中间改过 Godot 文件：是候选，做法从改动里来', () => {
    const [c] = findLessonCandidates(
      [failCheck(1), edit(2, 'extends KinematicBody2D', 'extends CharacterBody2D'), passCheck(3)],
      []
    )
    expect(c).toMatchObject({
      tool: 'godot_check',
      symbol: 'kinematicbody2d',
      diff: { removed: ['extends KinematicBody2D'], added: ['extends CharacterBody2D'] },
      edited: ['player.gd'],
      editTool: 'edit_local_file',
      between: ['edit_local_file']
    })
    // 中间没改文件：原样重试就过了，瞬时故障
    expect(findLessonCandidates([failCheck(1), passCheck(2)], [])).toEqual([])
    // 改文件本身失败的不算改动
    expect(
      findLessonCandidates(
        [
          failCheck(1),
          { ...edit(2, 'a', 'b'), ok: false, error: 'could not find edits', fp: 'x' },
          passCheck(3)
        ],
        []
      )
    ).toEqual([])
  })

  it('整文件写没读到旧内容：照样是候选，标成不全', () => {
    const [c] = findLessonCandidates(
      [
        failCheck(1),
        edit(2, undefined, 'extends CharacterBody2D\nfunc _ready():\n\tpass'),
        passCheck(3)
      ],
      []
    )
    expect(c.diff).toMatchObject({ removed: [], partial: true })
    expect(c.diff?.added).toContain('extends CharacterBody2D')
  })

  it('报错说的名字是工程自己声明的函数：不是 Godot 的规矩', () => {
    const error = n(
      'Parse Error: Too many arguments for "shoot()" call. Expected at most 0 but received 1.'
    )
    expect(
      findLessonCandidates(
        [failCheck(1, error), edit(2, 'func shoot():', 'func shoot(dir):'), passCheck(3)],
        []
      )
    ).toEqual([])
  })

  it('写成通用经验：带 API 钥匙、错误写法、Godot 版本；交给模型的是改动的行', async () => {
    const complete = vi.fn(
      async () =>
        '[{"index":0,"title":"Godot 4 没有 KinematicBody2D","errorPattern":"could not find type \\"kinematicbody2d\\"","advice":"改用 CharacterBody2D"}]'
    )
    const globalDir = join(root, 'home')
    const result = await curateSession({
      header: header(),
      calls: [
        failCheck(1),
        edit(2, 'extends KinematicBody2D', 'extends CharacterBody2D'),
        passCheck(3)
      ],
      complete,
      knownTools: new Set(['godot_check', 'edit_local_file']),
      globalDir
    })
    const [system, user] = complete.mock.calls[0] as unknown as [string, string]
    expect(system).toContain('Never write one about a mistake in this project')
    expect(system).toContain('onready → @onready')
    expect(user).toContain('- extends KinematicBody2D')
    expect(user).toContain('+ extends CharacterBody2D')
    expect(user).toContain('files edited before it passed: player.gd')
    expect(result.written).toMatchObject([
      {
        layer: 'global',
        tool: 'godot_check',
        symbol: 'kinematicbody2d',
        avoid: 'kinematicbody2d',
        engines: ['4.3'],
        verified: { engine: '4.3.stable' },
        expect: { tool: 'edit_local_file' }
      }
    ])
    expect(await new ExperienceStore(experienceDir(header().projectRoot)!).readAll()).toEqual([])
  })
})

describe('往 .gd 里写之前的执行前提醒', () => {
  const proven: LayeredEntry = {
    id: 'e-kb',
    title: 'Godot 4 没有 KinematicBody2D',
    tool: 'godot_check',
    errorPattern: 'could not find type "kinematicbody2d"',
    advice: '改用 CharacterBody2D',
    expect: { tool: 'edit_local_file' },
    source: '',
    status: 'proven',
    layer: 'global',
    symbol: 'kinematicbody2d',
    avoid: 'kinematicbody2d',
    engines: ['4.3']
  }

  it('只看已验证的、新引入的写法', () => {
    expect(findAvoided('extends KinematicBody2D', [proven], '4.3')).toHaveLength(1)
    expect(findAvoided('extends KinematicBody2D', [{ ...proven, status: 'trial' }], '4.3')).toEqual(
      []
    )
    expect(findAvoided('extends KinematicBody2D', [{ ...proven, notFor: ['4.4'] }], '4.4')).toEqual(
      []
    )
    // 文件里本来就有，这次只改了别处：不是这次写入引入的
    expect(
      findAvoided(
        'extends KinematicBody2D\nvar a = 2',
        [proven],
        '4.3',
        'extends KinematicBody2D\nvar a = 1'
      )
    ).toEqual([])
  })

  let root: string
  let global: ExperienceStore
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'exp-godot-pre-'))
    global = new ExperienceStore(join(root, 'global'))
    const entry: ExperienceEntry & { layer?: string } = { ...proven }
    delete entry.layer
    await global.updateTool(proven.tool, () => [entry])
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  function runtime(trail?: TrailWriter): ReturnType<typeof createExperienceRuntime> {
    return createExperienceRuntime({
      project: new ExperienceStore(join(root, 'project')),
      global,
      projectKey: 'p',
      engine: '4.3',
      agentId: 's',
      isLearnableTool: (tool, args) =>
        tool.startsWith('godot_') || isGodotTextPath((args as { path?: string }).path),
      random: () => 0.99,
      ...(trail ? { trail } : {})
    })
  }
  const gd = (content: string): { tool: string; args: unknown } => ({
    tool: 'write_local_file',
    args: { path: join(root, 'player.gd'), content }
  })
  const ok = { tool: 'godot_check', args: {}, isError: false, text: 'No errors. Ran 120 frames.' }

  it('拦一次；改好了写进去、检查也过了，记一次采纳成功', async () => {
    const rt = runtime()
    expect(await rt.before(gd('extends KinematicBody2D'))).toContain('not written')
    const good = gd('extends CharacterBody2D')
    expect(await rt.before(good)).toBeUndefined()
    await rt.after({ ...good, isError: false, text: 'ok' })
    await rt.after(ok)
    await rt.flush()
    expect(await global.statsFor(proven.id)).toMatchObject({ shown: 1, adopted: 1, adoptedOk: 1 })
    expect((await global.readTool(proven.tool))[0].status).toBe('proven')
  })

  it('原样再发就放行；随后检查过了说明拦错了，降回试用、不再拦', async () => {
    const rt = runtime()
    const bad = gd('extends KinematicBody2D')
    expect(await rt.before(bad)).toBeDefined()
    expect(await rt.before(bad)).toBeUndefined()
    await rt.after({ ...bad, isError: false, text: 'ok' })
    // 写文件本身成功不算数，要等检查
    await rt.flush()
    expect((await global.readTool(proven.tool))[0].status).toBe('proven')
    await rt.after(ok)
    await rt.flush()
    expect((await global.readTool(proven.tool))[0].status).toBe('trial')
    expect(await runtime().before(gd('extends KinematicBody2D'))).toBeUndefined()
  })

  it('不是 .gd、不是改文件的工具，不提醒', async () => {
    expect(
      await runtime().before({
        tool: 'write_local_file',
        args: { path: join(root, 'main.tscn'), content: 'type="KinematicBody2D"' }
      })
    ).toBeUndefined()
    expect(await runtime().before({ tool: 'godot_check', args: {} })).toBeUndefined()
  })

  it('整文件写之前读回旧内容，和新内容一起记进原始账', async () => {
    const path = join(root, 'player.gd')
    await writeFile(path, 'extends Node2D\nvar a = 1\n', 'utf8')
    const trailDir = join(root, 'trail')
    const rt = runtime(
      new TrailWriter(trailDir, { sessionId: 's', projectRoot: root, skillLearning: 'ask' })
    )
    const call = {
      tool: 'write_local_file',
      args: { path, content: 'extends Node2D\nvar a = 2\n' }
    }
    await rt.before(call)
    await rt.after({ ...call, isError: false, text: 'ok' })
    await rt.after({
      tool: 'edit_local_file',
      args: { path, edits: [{ oldText: 'var a = 2', newText: 'var a = 3' }] },
      isError: false,
      text: 'ok'
    })
    await rt.flush()
    const read = await readTrail(trailDir, 's')
    expect(read?.calls.map((c) => [c.tool, c.old, c.code])).toEqual([
      ['write_local_file', 'extends Node2D\nvar a = 1\n', 'extends Node2D\nvar a = 2\n'],
      ['edit_local_file', 'var a = 2', 'var a = 3']
    ])
  })
})
