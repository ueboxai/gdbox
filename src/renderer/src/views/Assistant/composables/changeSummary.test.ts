import { describe, expect, it } from 'vitest'

import type { AgentProcessItem } from '../components/AgentProcessLog.types'
import type { ChangeEntry } from './changeSummary'
import {
  changeKindOf,
  changeLabelKey,
  extractChangeDetail,
  extractChangeOutcomes,
  extractChangeTarget,
  groupChanges,
  isEditorAction,
  isLocalFileChange,
  isMcpChange,
  isResPath,
  isReversibleTool,
  summarizeChanges
} from './changeSummary'

const RISKS = {
  write_local_file: 'mutating',
  edit_local_file: 'mutating',
  read_local_file: 'safe',
  import_to_project: 'mutating',
  gen_sprite: 'mutating',
  gen_sfx: 'mutating',
  gen_music: 'mutating',
  gen_voice: 'mutating',
  art_style: 'mutating',
  editor_play: 'mutating',
  editor_stop: 'mutating',
  editor_open_scene: 'mutating',
  editor_select: 'mutating',
  editor_save_all: 'mutating',
  godot_check: 'safe',
  godot_run: 'safe',
  run_shell_command: 'destructive',
  delete_note: 'destructive',
  browser_interact: 'mutating'
} as const

function call(name: string, args: Record<string, unknown>, risk?: string): AgentProcessItem {
  return {
    type: 'tool-call',
    data: {
      id: `c-${name}`,
      function: { name, arguments: JSON.stringify(args) },
      ...(risk ? { risk } : {})
    },
    timestamp: 1
  }
}

function result(toolName: string, isError = false): AgentProcessItem {
  return { type: 'tool-result', data: { toolName, isError, result: {} }, timestamp: 2 }
}

/** 带返回值（工具的 details）的结果项 —— 「真写出了哪些文件」只有它知道 */
function resultWith(toolName: string, payload: unknown, isError = false): AgentProcessItem {
  return { type: 'tool-result', data: { toolName, isError, result: payload }, timestamp: 2 }
}

function entry(over: Partial<ChangeEntry>): ChangeEntry {
  return {
    toolName: 'edit_local_file',
    risk: 'mutating',
    target: 'D:/game/player.gd',
    reversible: true,
    failed: false,
    ...over
  }
}

describe('路径判断', () => {
  it('盘符、UNC、POSIX 绝对路径算本地文件', () => {
    expect(isLocalFileChange({ target: 'D:/game/player.gd' })).toBe(true)
    expect(isLocalFileChange({ target: 'C:\\Users\\me\\game\\main.tscn' })).toBe(true)
    expect(isLocalFileChange({ target: '\\\\nas\\share\\a.gd' })).toBe(true)
    expect(isLocalFileChange({ target: '/Users/me/game/player.gd' })).toBe(true)
  })

  it('res:// 路径、资产名、空目标不算本地文件', () => {
    expect(isLocalFileChange({ target: 'res://player.gd' })).toBe(false)
    expect(isLocalFileChange({ target: 'hero' })).toBe(false)
    expect(isLocalFileChange({ target: '' })).toBe(false)
  })

  it('只有 res:// 路径能在编辑器里打开', () => {
    expect(isResPath('res://scenes/main.tscn')).toBe(true)
    expect(isResPath('res://')).toBe(false)
    expect(isResPath('D:/game/main.tscn')).toBe(false)
    expect(isResPath('hero')).toBe(false)
  })
})

describe('MCP 与文案 key', () => {
  it('认得出 MCP 来的改动', () => {
    expect(isMcpChange({ toolName: 'mcp_my-server_do_thing' })).toBe(true)
    expect(isMcpChange({ toolName: 'write_local_file' })).toBe(false)
  })

  it('拼出 i18n key', () => {
    expect(changeLabelKey('gen_sprite')).toBe('assistant.changes.tools.gen_sprite')
  })
})

describe('summarizeChanges', () => {
  it('只留真的动了东西的调用：只读工具和验证工具不算', () => {
    const items = [
      call('read_local_file', { path: 'D:/game/player.gd' }),
      result('read_local_file'),
      call('godot_check', {}),
      result('godot_check'),
      call('edit_local_file', { path: 'D:/game/player.gd' }),
      result('edit_local_file')
    ]

    expect(summarizeChanges(items, RISKS)).toEqual([
      {
        toolName: 'edit_local_file',
        risk: 'mutating',
        target: 'D:/game/player.gd',
        reversible: true,
        failed: false
      }
    ])
  })

  it('失败的调用标出来，别读成已经改了', () => {
    const items = [call('delete_note', { name: '设计' }), result('delete_note', true)]

    expect(summarizeChanges(items, RISKS)[0]).toMatchObject({ failed: true, risk: 'destructive' })
  })

  it('同名工具的多次调用按顺序配对结果', () => {
    const items = [
      call('edit_local_file', { path: 'D:/game/a.gd' }),
      call('edit_local_file', { path: 'D:/game/b.gd' }),
      result('edit_local_file', false),
      result('edit_local_file', true)
    ]

    expect(summarizeChanges(items, RISKS).map((change) => change.failed)).toEqual([false, true])
  })

  it('风险表里没有的工具不算', () => {
    expect(summarizeChanges([call('unknown_tool', { path: 'x' })], RISKS)).toEqual([])
  })

  it('本地命令行照常记进台账，带着命令原文和不可回滚', () => {
    const items = [
      call('run_shell_command', { command: 'git status' }),
      result('run_shell_command')
    ]

    expect(summarizeChanges(items, RISKS)[0]).toMatchObject({
      toolName: 'run_shell_command',
      detail: 'git status',
      reversible: false
    })
  })

  it('主进程按参数算出 safe 的调用不进台账，也不打乱后面的结果配对', () => {
    const items = [
      call('art_style', { action: 'show' }, 'safe'),
      call('art_style', { action: 'load_preset', preset: 'pixel_16' }),
      result('art_style', false),
      result('art_style', true)
    ]

    const changes = summarizeChanges(items, RISKS)
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ detail: 'pixel_16', failed: true })
  })

  it('写出一个原来不存在的文件时标 created —— 返回值的 fileChange 说的', () => {
    const items = [
      call('write_local_file', { path: 'D:/game/enemy.gd' }),
      resultWith('write_local_file', {
        fileChange: { path: 'D:/game/enemy.gd', before: '', after: 'extends Node', created: true }
      })
    ]

    expect(summarizeChanges(items, RISKS)[0]).toMatchObject({
      target: 'D:/game/enemy.gd',
      created: true
    })
  })

  it('覆盖已有文件不标 created', () => {
    const items = [
      call('write_local_file', { path: 'D:/game/enemy.gd' }),
      resultWith('write_local_file', {
        fileChange: { path: 'D:/game/enemy.gd', before: 'a', after: 'b', created: false }
      })
    ]

    expect(summarizeChanges(items, RISKS)[0].created).toBeUndefined()
  })

  it('二进制 / 太大没抓快照时，路径照样取返回值里的', () => {
    const items = [
      call('write_local_file', { path: 'D:/game/big.tscn' }),
      resultWith('write_local_file', { fileChangeUnavailable: 'D:/game/big.tscn' })
    ]

    expect(summarizeChanges(items, RISKS)[0].target).toBe('D:/game/big.tscn')
  })
})

describe('生成与导入：以真写出来的文件为准', () => {
  it('gen_sprite 只收一个名字，写出来的是图集和 .tres 两个文件', () => {
    const items = [
      call('gen_sprite', { project_path: 'D:/game', name: 'hero', description: '骑士' }),
      resultWith('gen_sprite', {
        outputs: ['res://assets/gen/sprites/hero.png', 'res://assets/gen/sprites/hero.tres']
      })
    ]

    expect(summarizeChanges(items, RISKS).map((change) => change.target)).toEqual([
      'res://assets/gen/sprites/hero.png',
      'res://assets/gen/sprites/hero.tres'
    ])
  })

  it('一次出三个音效候选就是三行', () => {
    const outputs = [1, 2, 3].map((n) => `res://assets/gen/sfx/jump_${n}.wav`)
    const items = [
      call('gen_sfx', { name: 'jump', kind: 'jump' }),
      resultWith('gen_sfx', { outputs })
    ]

    expect(summarizeChanges(items, RISKS).map((change) => change.target)).toEqual(outputs)
  })

  it('gen_voice 只算这次真合成的，没变化跳过的不算', () => {
    const items = [
      call('gen_voice', { lines: [{ id: 'intro_01', text: '你好' }] }),
      resultWith('gen_voice', {
        outputs: ['res://assets/gen/voice/intro_01.wav', 'res://assets/gen/voice/intro_02.wav'],
        generated: ['res://assets/gen/voice/intro_01.wav'],
        skipped: ['res://assets/gen/voice/intro_02.wav']
      })
    ]

    expect(summarizeChanges(items, RISKS).map((change) => change.target)).toEqual([
      'res://assets/gen/voice/intro_01.wav'
    ])
  })

  it('调用失败时没有返回值可读，退回参数里的名字，整行标未生效', () => {
    const items = [call('gen_music', { name: 'level1_bgm' }), result('gen_music', true)]

    expect(summarizeChanges(items, RISKS)).toEqual([
      expect.objectContaining({ target: 'level1_bgm', failed: true })
    ])
  })

  it('gen_voice 失败时退回第一条台词的 id', () => {
    expect(extractChangeTarget({ lines: [{ id: 'intro_01', text: '你好' }] })).toBe('intro_01')
  })

  it('导入只算真放进去的，同名跳过的不算', () => {
    const items = [
      call('import_to_project', {
        files: ['E:/lib/a.png', 'E:/lib/b.png'],
        destination: 'res://art'
      }),
      resultWith('import_to_project', {
        imported: ['res://art/a.png'],
        skipped: ['res://art/b.png']
      })
    ]

    expect(summarizeChanges(items, RISKS).map((change) => change.target)).toEqual([
      'res://art/a.png'
    ])
  })

  it('全是同名跳过的导入什么都没改，不进台账', () => {
    const items = [
      call('import_to_project', { files: ['E:/lib/a.png'], destination: 'res://art' }),
      resultWith('import_to_project', { imported: [], skipped: ['res://art/a.png'] })
    ]

    expect(summarizeChanges(items, RISKS)).toEqual([])
  })

  it('一次导入太多就退回一行目标目录，宁可粗也不要一堵墙', () => {
    const imported = Array.from({ length: 30 }, (_, i) => `res://art/t_${i}.png`)
    const items = [
      call('import_to_project', { files: ['x'], destination: 'res://art' }),
      resultWith('import_to_project', { imported })
    ]

    const changes = summarizeChanges(items, RISKS)
    expect(changes).toHaveLength(1)
    expect(changes[0].target).toBe('res://art')
  })

  it('覆盖导入撤不回来，默认的不覆盖导入可以', () => {
    const items = [
      call('import_to_project', { files: ['E:/a.png'], destination: 'res://art', overwrite: true }),
      call('import_to_project', { files: ['E:/b.png'], destination: 'res://art' })
    ]

    expect(summarizeChanges(items, RISKS).map((change) => change.reversible)).toEqual([false, true])
  })

  it('认不出返回值形状时退回参数那套，不会因此丢行', () => {
    expect(extractChangeOutcomes('gen_sprite', { something: 1 })).toBeNull()
    expect(extractChangeOutcomes('art_style', { style: {} })).toBeNull()
    expect(extractChangeOutcomes('gen_sprite', 'text')).toBeNull()
  })
})

describe('编辑器里的操作', () => {
  it('path 是「打开哪个场景」，进 detail，不当成改了哪个文件', () => {
    const items = [
      call('editor_open_scene', { path: 'res://main.tscn' }),
      result('editor_open_scene')
    ]

    expect(summarizeChanges(items, RISKS)[0]).toMatchObject({
      target: '',
      detail: 'res://main.tscn'
    })
  })

  it('选中的节点和运行的场景都写进 detail', () => {
    expect(extractChangeDetail('editor_select', { paths: ['Player', 'Camera2D'] })).toBe(
      'Player, Camera2D'
    )
    expect(extractChangeDetail('editor_play', { scene: 'res://level1.tscn' })).toBe(
      'res://level1.tscn'
    )
    expect(extractChangeDetail('editor_play', {})).toBe('')
  })

  it('认得出哪些是编辑器操作', () => {
    expect(isEditorAction('editor_play')).toBe(true)
    expect(isEditorAction('editor_open_scene')).toBe(true)
    expect(isEditorAction('write_local_file')).toBe(false)
  })

  it('打开两个不同的场景是两行，同一个场景打开两次是一行 ×2', () => {
    const groups = groupChanges([
      entry({ toolName: 'editor_open_scene', target: '', detail: 'res://a.tscn' }),
      entry({ toolName: 'editor_open_scene', target: '', detail: 'res://b.tscn' }),
      entry({ toolName: 'editor_open_scene', target: '', detail: 'res://a.tscn' })
    ])

    expect(groups).toHaveLength(2)
    expect(groups[0].steps[0].count).toBe(2)
  })

  it('打开的场景和写过的那个场景不并成一行 —— 打开不是改', () => {
    const groups = groupChanges([
      entry({ toolName: 'write_local_file', target: 'res://main.tscn' }),
      entry({ toolName: 'editor_open_scene', target: '', detail: 'res://main.tscn' })
    ])

    expect(groups).toHaveLength(2)
  })

  it('保存全部、停止运行是内务，不单独占行', () => {
    const groups = groupChanges([
      entry({ toolName: 'editor_save_all', target: '' }),
      entry({ toolName: 'editor_play', target: '' }),
      entry({ toolName: 'editor_stop', target: '' })
    ])

    expect(groups.map((group) => group.steps[0].toolName)).toEqual(['editor_play'])
  })

  it('整轮只有内务时清单为空', () => {
    expect(groupChanges([entry({ toolName: 'editor_save_all', target: '' })])).toEqual([])
  })

  it('destructive 的一律占一行，哪怕它长得像内务', () => {
    const groups = groupChanges([
      entry({ toolName: 'editor_save_all', target: '', risk: 'destructive' })
    ])

    expect(groups).toHaveLength(1)
  })
})

describe('美术风格', () => {
  it('套用 / 存的是哪个预设进 detail，没有预设时是新的风格描述', () => {
    expect(extractChangeDetail('art_style', { action: 'load_preset', preset: 'pixel_16' })).toBe(
      'pixel_16'
    )
    expect(extractChangeDetail('art_style', { action: 'set', prompt: 'warm pixel art' })).toBe(
      'warm pixel art'
    )
  })

  it('detail 有长度上限 —— 它随聊天记录进 localStorage', () => {
    const detail = extractChangeDetail('art_style', { action: 'set', prompt: 'x'.repeat(500) })

    expect(detail.length).toBeLessThanOrEqual(121)
    expect(detail.endsWith('…')).toBe(true)
  })

  it('没有目标，归到「风格」这一类', () => {
    const [group] = groupChanges([entry({ toolName: 'art_style', target: '', detail: 'pixel_16' })])

    expect(group).toMatchObject({ target: '', kind: 'style', local: false })
  })
})

describe('changeKindOf', () => {
  it('路径按扩展名认：同一个写文件工具，写的可能是脚本也可能是场景', () => {
    expect(changeKindOf('write_local_file', 'D:/game/player.gd')).toBe('script')
    expect(changeKindOf('write_local_file', 'D:/game/main.tscn')).toBe('scene')
    expect(changeKindOf('edit_local_file', 'D:/game/project.godot')).toBe('config')
    expect(changeKindOf('edit_local_file', 'D:/game/water.gdshader')).toBe('shader')
    expect(changeKindOf('gen_sprite', 'res://assets/gen/sprites/hero.tres')).toBe('resource')
    expect(changeKindOf('gen_sprite', 'res://assets/gen/sprites/hero.png')).toBe('image')
    expect(changeKindOf('gen_music', 'res://assets/gen/music/bgm.wav')).toBe('audio')
    expect(changeKindOf('import_to_project', 'res://models/tree.glb')).toBe('model')
  })

  it('扩展名认不出来时按工具名', () => {
    expect(changeKindOf('write_local_file', 'D:/game/README')).toBe('file')
    expect(changeKindOf('gen_sfx', 'jump')).toBe('audio')
    expect(changeKindOf('import_to_project', 'res://art')).toBe('folder')
    expect(changeKindOf('browser_interact', '提交')).toBe('web')
  })

  it('素材库的资产名不按扩展名认 —— 它是素材库资产，不是工程里的一张图', () => {
    expect(changeKindOf('annotate_asset', 'hero.png')).toBe('asset')
  })

  it('认不出来就不标 —— 一个错的类型比没有类型更误导', () => {
    expect(changeKindOf('mcp_x_do', '')).toBe('')
  })
})

describe('isReversibleTool', () => {
  it('命令行和网页交互撤不回来，其余可以', () => {
    expect(isReversibleTool('run_shell_command')).toBe(false)
    expect(isReversibleTool('browser_interact')).toBe(false)
    expect(isReversibleTool('edit_local_file')).toBe(true)
    expect(isReversibleTool('gen_sprite')).toBe(true)
  })
})

describe('groupChanges', () => {
  it('同一个脚本写一次改七次是一行，施工步骤合并计数收在展开区', () => {
    const groups = groupChanges([
      entry({ toolName: 'write_local_file' }),
      ...Array.from({ length: 7 }, () => entry({}))
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ stepCount: 8, kind: 'script', local: true })
    expect(groups[0].steps).toEqual([
      { toolName: 'write_local_file', count: 1, failedCount: 0 },
      { toolName: 'edit_local_file', count: 7, failedCount: 0 }
    ])
  })

  it('不同文件分开，各算各的', () => {
    const groups = groupChanges([
      entry({ target: 'D:/game/a.gd' }),
      entry({ target: 'D:/game/b.gd' }),
      entry({ target: 'D:/game/a.gd' })
    ])

    expect(groups.map((group) => [group.target, group.stepCount])).toEqual([
      ['D:/game/a.gd', 2],
      ['D:/game/b.gd', 1]
    ])
  })

  it('同一个磁盘文件的斜杠、大小写写法不同也并成一行', () => {
    const groups = groupChanges([
      entry({ target: 'D:\\Game\\player.gd' }),
      entry({ target: 'd:/game/player.gd' })
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].target).toBe('D:\\Game\\player.gd')
  })

  it('生成的 res:// 文件和之后按磁盘路径改的是同一个，并成一行，以磁盘路径为准', () => {
    const groups = groupChanges([
      entry({ toolName: 'gen_sprite', target: 'res://assets/gen/sprites/hero.tres' }),
      entry({ toolName: 'edit_local_file', target: 'D:/game/assets/gen/sprites/hero.tres' })
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      target: 'D:/game/assets/gen/sprites/hero.tres',
      local: true,
      action: 'created',
      kind: 'resource'
    })
  })

  it('对不上唯一一个磁盘路径时不合并 —— 分不清就别猜', () => {
    const groups = groupChanges([
      entry({ toolName: 'gen_sprite', target: 'res://icon.png' }),
      entry({ target: 'D:/game/a/icon.png' }),
      entry({ target: 'D:/game/b/icon.png' })
    ])

    expect(groups).toHaveLength(3)
  })

  it('失败时只有名字的那次，并到同名的完整路径上', () => {
    const groups = groupChanges([
      entry({ toolName: 'gen_music', target: 'level1_bgm', failed: true }),
      entry({ toolName: 'gen_music', target: 'res://assets/gen/music/level1_bgm.wav' })
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      target: 'res://assets/gen/music/level1_bgm.wav',
      stepCount: 2,
      failedCount: 1,
      action: 'created'
    })
  })

  it('名字对得上好几个文件时不合并（hero.png 和 hero.tres 都叫 hero）', () => {
    const groups = groupChanges([
      entry({ toolName: 'gen_sprite', target: 'hero', failed: true }),
      entry({ toolName: 'gen_sprite', target: 'res://assets/gen/sprites/hero.png' }),
      entry({ toolName: 'gen_sprite', target: 'res://assets/gen/sprites/hero.tres' })
    ])

    expect(groups).toHaveLength(3)
  })

  it('改已有文件是「修改」；写出新文件、生成、导入是「新建」', () => {
    const groups = groupChanges([
      entry({ target: 'D:/game/a.gd' }),
      entry({ toolName: 'write_local_file', target: 'D:/game/b.gd', created: true }),
      entry({ toolName: 'gen_sfx', target: 'res://sfx/jump.wav' }),
      entry({ toolName: 'import_to_project', target: 'res://art/a.png' })
    ])

    expect(groups.map((group) => group.action)).toEqual([
      'modified',
      'created',
      'created',
      'created'
    ])
  })

  it('新写出来的文件之后又改了几次，净结果仍是新建', () => {
    const groups = groupChanges([
      entry({ toolName: 'write_local_file', created: true }),
      entry({}),
      entry({})
    ])

    expect(groups[0].action).toBe('created')
  })

  it('失败的那一步不改变净结果', () => {
    const groups = groupChanges([
      entry({ toolName: 'gen_sfx', target: 'res://sfx/jump.wav', failed: true })
    ])

    expect(groups[0].action).toBe('modified')
  })

  it('删掉的是「删除」', () => {
    const groups = groupChanges([
      entry({ toolName: 'delete_note', target: '设计笔记', risk: 'destructive' })
    ])

    expect(groups[0]).toMatchObject({ action: 'deleted', kind: 'note' })
  })

  it('撤不回去的步数按组算，失败的那步没干成也就没什么可撤的', () => {
    const groups = groupChanges([
      entry({ toolName: 'import_to_project', target: 'res://art/a.png', reversible: false }),
      entry({
        toolName: 'import_to_project',
        target: 'res://art/a.png',
        reversible: false,
        failed: true
      })
    ])

    expect(groups[0]).toMatchObject({ irreversibleCount: 1, failedCount: 1 })
  })

  it('本地命令行聚合时才滤掉 —— 台账留着给统计，面板上不显示', () => {
    const groups = groupChanges([
      entry({ toolName: 'run_shell_command', target: '', detail: 'ls', reversible: false }),
      entry({})
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].steps[0].toolName).toBe('edit_local_file')
  })

  it('本地文件和 res:// 资源分得开 —— 前者能看对比、能在资源管理器里定位', () => {
    const groups = groupChanges([
      entry({}),
      entry({ toolName: 'gen_sprite', target: 'res://assets/gen/sprites/hero.png' })
    ])

    expect(groups.map((group) => group.local)).toEqual([true, false])
  })
})

describe('浏览器操作', () => {
  it('操作网页显示元素标签，不显示输入内容', () => {
    expect(extractChangeTarget({ label: '搜索框', value: '我的密码' })).toBe('搜索框')
  })

  it('点出去的那一下撤不回来，归到「网页」这一类', () => {
    const items = [call('browser_interact', { label: '提交' }), result('browser_interact')]
    const [change] = summarizeChanges(items, RISKS)

    expect(change).toMatchObject({ target: '提交', reversible: false })
    expect(groupChanges([change])[0].kind).toBe('web')
  })
})
