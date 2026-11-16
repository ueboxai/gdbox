/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  captureEditorSnapshot,
  EDITOR_SNAPSHOT_RULES,
  formatEditorSnapshotBlock,
  snapshotMatchesScope,
  stripEditorSnapshotBlock,
  type EditorSnapshot
} from './editorSnapshot'
import type { SessionProjectScope } from './sessionScope'

/*
 * WebSocket 服务的替身**不用 `vi.fn()`**。
 *
 * vi.fn 会把每次返回的 promise 记进 `mock.settledResults`，为此它自己挂一个
 * `.then` —— 而那个派生 promise 在返回值是 rejected 时没人接，vitest 当场报
 * 「未处理的拒绝」，把一个明明通过了的用例判成失败（只在同一个 mock 先成功过
 * 一次之后才发作，非常难查）。改用普通函数，自己记调用参数。
 */
let callRequestImpl: (...args: unknown[]) => Promise<unknown> = async () => ({})
const callRequestCalls: unknown[][] = []

vi.mock('../../services', () => ({
  serviceManager: {
    getWebSocketService: () => ({
      callRequest: (...args: unknown[]) => {
        callRequestCalls.push(args)
        return callRequestImpl(...args)
      }
    })
  }
}))

const scopeOf = (overrides: Partial<SessionProjectScope> = {}): SessionProjectScope => ({
  engineAvailable: true,
  targetConnectionId: 'conn-1',
  connectedProject: {
    connectionId: 'conn-1',
    projectName: 'MyGame',
    projectPath: 'D:/Games/MyGame'
  },
  outOfScopeProjects: [],
  ...overrides
})

const snapshotOf = (overrides: Partial<EditorSnapshot> = {}): EditorSnapshot => ({
  capturedAt: '2026-09-07T14:21:33.000Z',
  project: { projectName: 'MyGame', projectPath: 'D:/Games/MyGame', connectionId: 'conn-1' },
  focus: {},
  ...overrides
})

describe('captureEditorSnapshot', () => {
  beforeEach(() => {
    callRequestCalls.length = 0
    callRequestImpl = async () => ({})
  })

  /*
   * 「一个都没连」和「连着但不是你的工程」对用户是两句完全不同的话：
   * 前者要说「先把引擎打开」，后者要说「你开的是另一个工程」。
   * 作用域本身分不出来 —— 两种情况它都只是没有 targetConnectionId。
   */
  it('一个引擎都没连 → not-connected，不发请求', async () => {
    const result = await captureEditorSnapshot({
      scope: { engineAvailable: false, outOfScopeProjects: [] },
      anyConnected: false
    })

    expect(result).toEqual({ ok: false, reason: 'not-connected' })
    expect(callRequestCalls).toHaveLength(0)
  })

  /**
   * 这条是**最要命**的那个：会话属于 A、只有 B 连着。
   *
   * 这时作用域没有目标连接。要是把 `undefined` 传给 `callRequest`，服务端看到只有
   * 一个活连接就会自动选 B（`pickDefaultConnectionId`）—— 拿到的是**另一个工程**
   * 的选区，而结果里没有任何东西能看出这件事。所以这里必须一个请求都不发。
   */
  it('归属工程没连上 → project-offline，一个请求都不发', async () => {
    const result = await captureEditorSnapshot({
      scope: { engineAvailable: false, outOfScopeProjects: ['OtherGame'] },
      anyConnected: true
    })

    expect(result).toEqual({ ok: false, reason: 'project-offline' })
    expect(callRequestCalls).toHaveLength(0)
  })

  it('抓到了 —— 连接 id 是作用域给的那个，绝不是 undefined', async () => {
    callRequestImpl = async () => ({
      editedScene: { name: 'Player', path: 'res://player.tscn' }
    })

    const result = await captureEditorSnapshot({ scope: scopeOf(), anyConnected: true })

    expect(result.ok).toBe(true)
    expect(callRequestCalls).toEqual([['editor.get_focus_context', {}, 'conn-1', 2000]])
    if (!result.ok) throw new Error('unreachable')
    expect(result.snapshot.project).toEqual({
      projectName: 'MyGame',
      projectPath: 'D:/Games/MyGame',
      connectionId: 'conn-1'
    })
  })

  /** 超时被记成「用户什么都没开着」的话，模型会照着一句假话往下答 */
  it('超时 → timeout，不抛', async () => {
    callRequestImpl = async () => {
      throw Object.assign(new Error('timeout'), { code: 'E_TIMEOUT' })
    }

    await expect(captureEditorSnapshot({ scope: scopeOf(), anyConnected: true })).resolves.toEqual({
      ok: false,
      reason: 'timeout'
    })
  })

  it('插件报别的错 → error，不抛', async () => {
    callRequestImpl = async () => {
      throw new Error('boom')
    }

    await expect(captureEditorSnapshot({ scope: scopeOf(), anyConnected: true })).resolves.toEqual({
      ok: false,
      reason: 'error'
    })
  })
})

describe('snapshotMatchesScope', () => {
  /** 编辑器重连一次连接 id 就换，工程还是那个工程 —— 所以认路径 */
  it('路径相同就算同一个工程，连接 id 变了也认', () => {
    expect(
      snapshotMatchesScope(
        snapshotOf({
          project: { projectName: 'MyGame', projectPath: 'D:/Games/MyGame', connectionId: '旧的' }
        }),
        scopeOf()
      )
    ).toBe(true)
  })

  it('斜杠方向和大小写不一致也认', () => {
    expect(
      snapshotMatchesScope(
        snapshotOf({
          project: { projectName: 'MyGame', projectPath: 'd:\\games\\mygame\\', connectionId: 'x' }
        }),
        scopeOf()
      )
    ).toBe(true)
  })

  /** 拦不住的后果是「拿着 A 的选区在 B 上动手」，而且全程不报错 */
  it('路径不同 → 拦下', () => {
    expect(
      snapshotMatchesScope(
        snapshotOf({
          project: { projectName: 'Other', projectPath: 'D:/Games/Other', connectionId: 'x' }
        }),
        scopeOf()
      )
    ).toBe(false)
  })

  it('两边都没记路径时退回比名字', () => {
    const scope = scopeOf({
      connectedProject: { connectionId: 'conn-1', projectName: 'MyGame' }
    })
    expect(
      snapshotMatchesScope(
        snapshotOf({ project: { projectName: 'MyGame', connectionId: 'x' } }),
        scope
      )
    ).toBe(true)
    expect(
      snapshotMatchesScope(
        snapshotOf({ project: { projectName: 'Other', connectionId: 'x' } }),
        scope
      )
    ).toBe(false)
  })

  /** 这一轮压根没有目标工程，块描述的东西这轮碰不到 */
  it('作用域没有目标连接 → 拦下', () => {
    expect(
      snapshotMatchesScope(snapshotOf(), { engineAvailable: false, outOfScopeProjects: [] })
    ).toBe(false)
  })
})

describe('formatEditorSnapshotBlock', () => {
  it('什么都没选：每段报 none，不占篇幅', () => {
    const block = formatEditorSnapshotBlock(
      snapshotOf({
        focus: { editedScene: { name: 'Main', path: 'res://main.tscn' } }
      })
    )

    expect(block).toContain('edited_scene: Main (res://main.tscn)')
    expect(block).toContain('selected_nodes: none')
    expect(block).toContain('filesystem_selection: none')
  })

  it('没开场景时报 none', () => {
    expect(formatEditorSnapshotBlock(snapshotOf({ focus: {} }))).toContain('edited_scene: none')
  })

  it('被插件截断时把总数说出来', () => {
    const block = formatEditorSnapshotBlock(
      snapshotOf({
        focus: {
          selectedNodes: [{ name: 'X', class: 'Node2D', path: 'X' }],
          selectedNodeCount: 73,
          selectedNodesTruncated: true
        }
      })
    )

    expect(block).toContain('selected_nodes (73, showing 1):')
  })

  it('选中的节点和 FileSystem 面板里的文件各自成段', () => {
    const block = formatEditorSnapshotBlock(
      snapshotOf({
        focus: {
          selectedNodes: [{ name: 'Crate', class: 'StaticBody2D', path: 'Level/Crate' }],
          selectedNodeCount: 1,
          fileSystem: {
            selectedFiles: [{ name: 'crate.png', path: 'res://art/crate.png', class: 'Texture2D' }],
            selectedFileCount: 1,
            selectedFilesTruncated: false,
            selectedFolders: ['res://art/']
          }
        }
      })
    )

    expect(block).toContain('- Crate (StaticBody2D) Level/Crate')
    expect(block).toContain('- crate.png res://art/crate.png')
    expect(block).toContain('folders: res://art/')
  })
})

describe('stripEditorSnapshotBlock', () => {
  /**
   * 插话的「已生效」回执是**按文本相等**匹配的（`agentStream.markSteerApplied`）：
   * 界面存的是用户打的原话，模型收到的是「块 + 原话」。不剥的话两边永远对不上，
   * 那条插话会一直显示「未生效」—— 而它其实早就进上下文了。
   */
  it('剥掉开头的块，留下用户真正说的那句', () => {
    const text = `${formatEditorSnapshotBlock(snapshotOf())}\n\n把这个改成 Lerp`

    expect(stripEditorSnapshotBlock(text)).toBe('把这个改成 Lerp')
  })

  it('没有块就原样返回', () => {
    expect(stripEditorSnapshotBlock('把这个改成 Lerp')).toBe('把这个改成 Lerp')
  })

  /** 用户自己在话里打出这串字符不该被动到 —— 只认开头那一个 */
  it('块不在开头就不动它', () => {
    const text = '这段 <editor-snapshot foo>bar</editor-snapshot> 是我贴的日志'

    expect(stripEditorSnapshotBlock(text)).toBe(text)
  })

  it('只有开标签没有闭标签时原样返回，不吞掉正文', () => {
    const text = '<editor-snapshot captured_at="x">\n没写完'

    expect(stripEditorSnapshotBlock(text)).toBe(text)
  })
})

/**
 * 规则常驻在系统提示词里，每一轮都在。点名一个不存在的工具，模型就会照着去调、
 * 拿一句「工具不存在」—— Unreal 时代的 `ue_get_selection` / `ue_bp_*` 就是这么留下的。
 */
describe('EDITOR_SNAPSHOT_RULES', () => {
  const rules = EDITOR_SNAPSHOT_RULES.join('\n')

  it('只点名 Godot 这边真有的工具', () => {
    expect(rules).toContain('editor_scene_tree')
    expect(rules).not.toMatch(/\bue_|Unreal/)
  })

  it('键名就是 Godot 的叫法，规则里不再逐个翻译', () => {
    expect(rules).not.toMatch(/selected_actors|content_browser|last_active_asset_editor/)
  })
})
