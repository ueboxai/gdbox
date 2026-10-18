import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { ExperienceEntry } from './experienceFile'
import { createExperienceRuntime, type ExperienceRuntime, type ToolCallReport } from './runtime'
import { ExperienceStore } from './store'
import { readTrail, TrailWriter } from './trail'

/** godot_check 的原样返回：查出错误时工具本身是成功的，文字里写着几条错误 */
const CHECK_FAILED =
  "1 error(s):\n\nSCRIPT ERROR: Invalid call. Nonexistent function 'instance' in base 'PackedScene'.\nat: _ready (res://main.gd:5)"
const CHECK_OK = 'No errors. Ran 120 frames.'

const entry: ExperienceEntry = {
  id: 'e-instance',
  title: 'PackedScene 用 instantiate()',
  tool: 'godot_check',
  errorPattern: "nonexistent function 'instance' in base 'packedscene'",
  advice: '改用 instantiate()',
  expect: { tool: 'edit_local_file' },
  source: 'test',
  status: 'trial'
}

let root: string
let store: ExperienceStore

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'exp-runtime-'))
  store = new ExperienceStore(join(root, 'experience'))
  await store.updateTool(entry.tool, () => [entry])
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function runtime(
  random: number,
  trail?: TrailWriter,
  layers: { global?: ExperienceStore; engine?: string; projectKey?: string } = {}
): ExperienceRuntime {
  return createExperienceRuntime({
    project: store,
    projectKey: layers.projectKey ?? 'p1',
    ...(layers.global ? { global: layers.global } : {}),
    ...(layers.engine ? { engine: layers.engine } : {}),
    agentId: 's1',
    isLearnableTool: (tool) => tool.startsWith('godot_') || tool === 'edit_local_file',
    random: () => random,
    ...(trail ? { trail } : {})
  })
}

const fail: ToolCallReport = { tool: entry.tool, args: {}, isError: false, text: CHECK_FAILED }
const pass: ToolCallReport = { tool: entry.tool, args: {}, isError: false, text: CHECK_OK }
const edit = (to: string): ToolCallReport => ({
  tool: 'edit_local_file',
  args: { path: 'H:/G/main.gd', edits: [{ oldText: 'scene.instance()', newText: to }] },
  isError: false,
  text: 'ok'
})

describe('experience runtime', () => {
  it('检查报错对得上就挂经验；改了文件、检查过了，记一次采纳成功', async () => {
    const rt = runtime(0.99)
    const note = await rt.after(fail)
    expect(note).toContain('改用 instantiate()')
    expect(note).toContain('may be outdated')

    expect(await rt.after(edit('scene.instantiate()'))).toBeUndefined()
    await rt.after(pass)
    await rt.flush()
    expect(await store.statsFor(entry.id)).toMatchObject({
      shown: 1,
      shownOk: 1,
      adopted: 1,
      adoptedOk: 1
    })
  })

  it('落进对照组时不挂经验，但照样记下随后成没成', async () => {
    const rt = runtime(0.01)
    expect(await rt.after(fail)).toBeUndefined()
    await rt.after(pass)
    await rt.flush()
    expect(await store.statsFor(entry.id)).toMatchObject({ holdout: 1, holdoutOk: 1, shown: 0 })
  })

  it('环境类报错、不记账的工具、对不上的报错、改文件失败都不挂', async () => {
    const rt = runtime(0.99)
    expect(
      await rt.after({ ...fail, text: 'The run did not exit in time and was stopped.' })
    ).toBeUndefined()
    expect(
      await rt.after({ tool: 'read_local_file', args: {}, isError: true, text: CHECK_FAILED })
    ).toBeUndefined()
    expect(
      await rt.after({
        ...fail,
        text: "1 error(s):\n\nSCRIPT ERROR: Invalid call. Nonexistent function 'pack' in base 'PackedScene'."
      })
    ).toBeUndefined()
    expect(await rt.after({ ...edit('x'), isError: true, text: CHECK_FAILED })).toBeUndefined()
  })

  it('照着做了还是同一个错，两次之后这条经验在盘上被标成退休', async () => {
    const rt = runtime(0.99)
    for (let i = 0; i < 2; i++) {
      await rt.after(fail)
      await rt.after(edit(`v${i}`))
      await rt.after(fail)
      await rt.flush()
    }
    expect((await store.readTool(entry.tool))[0]).toMatchObject({
      status: 'retired',
      retiredBecause: 'failed'
    })
  })

  it('原始账只记要记的工具，报错归一化，出场的经验 id 也记下', async () => {
    const trailDir = join(root, 'trail')
    const trail = new TrailWriter(trailDir, {
      sessionId: 's1',
      projectRoot: root,
      skillLearning: 'ask'
    })
    const rt = runtime(0.99, trail)
    await rt.after(fail)
    await rt.after({ tool: 'read_local_file', args: {}, isError: false, text: '' })
    await rt.after(edit('scene.instantiate()'))
    await rt.flush()

    const read = await readTrail(trailDir, 's1')
    expect(read?.calls).toHaveLength(2)
    expect(read?.calls[0]).toMatchObject({
      agent: 's1',
      tool: entry.tool,
      ok: false,
      error: "invalid call. nonexistent function 'instance' in base 'packedscene'.",
      shown: [entry.id]
    })
    expect(read?.calls[1]).toMatchObject({
      tool: 'edit_local_file',
      ok: true,
      path: 'H:/G/main.gd',
      old: 'scene.instance()',
      code: 'scene.instantiate()'
    })
  })
})

describe('两层经验', () => {
  const generalEntry: ExperienceEntry = {
    ...entry,
    id: 'e-general',
    advice: '通用做法：查 Godot 4 的类参考',
    engines: ['4.2']
  }
  let global: ExperienceStore

  beforeEach(async () => {
    global = new ExperienceStore(join(root, 'global'))
    await global.updateTool(entry.tool, () => [generalEntry])
  })

  it('两层一起查，本工程的排前面；跨版本的通用经验注明没在这个版本上验证过', async () => {
    const rt = runtime(0.99, undefined, { global, engine: '4.3' })
    const note = (await rt.after(fail))!
    expect(note.indexOf('改用 instantiate()')).toBeLessThan(note.indexOf('通用做法'))
    expect(note).toContain('not yet confirmed on Godot 4.3')
  })

  it('通用经验在新版本上照着做并且成了：这个版本加进适用列表', async () => {
    await store.updateTool(entry.tool, () => [])
    const rt = runtime(0.99, undefined, { global, engine: '4.3' })
    await rt.after(fail)
    await rt.after(edit('a'))
    await rt.after(pass)
    await rt.flush()
    expect((await global.readTool(entry.tool))[0].engines).toEqual(['4.2', '4.3'])
  })

  it('没验证过的版本上照着做了还是同一个错：记成这个版本不适用，不扣它的分，也不再出场', async () => {
    await store.updateTool(entry.tool, () => [])
    const rt = runtime(0.99, undefined, { global, engine: '4.4' })
    await rt.after(fail)
    await rt.after(edit('a'))
    await rt.after(fail)
    await rt.flush()

    const [saved] = await global.readTool(entry.tool)
    expect(saved.notFor).toEqual(['4.4'])
    expect(saved.status).toBe('trial')
    expect(await global.statsFor(saved.id)).toMatchObject({ adopted: 1, adoptedFail: 0 })
    expect(await runtime(0.99, undefined, { global, engine: '4.4' }).after(fail)).toBeUndefined()
  })

  it('工程经验在两个工程里都转正，自动升为通用', async () => {
    const empty = new ExperienceStore(join(root, 'global-empty'))
    for (const projectKey of ['p1', 'p2']) {
      // 同一个目录模拟两个工程：每轮重置成一条试用经验
      await store.updateTool(entry.tool, () => [{ ...entry, status: 'trial' }])
      await store.updateLedger(() => ({}))
      const rt = runtime(0.99, undefined, { global: empty, engine: '4.3', projectKey })
      for (let i = 0; i < 3; i++) {
        await rt.after(fail)
        await rt.after(edit(`y${i}`))
        await rt.after(pass)
        await rt.flush()
      }
      expect((await store.readTool(entry.tool))[0].status).toBe('proven')
      expect(await empty.readTool(entry.tool)).toHaveLength(projectKey === 'p1' ? 0 : 1)
    }
    const promoted = await empty.readTool(entry.tool)
    expect(promoted).toHaveLength(1)
    expect(promoted[0]).toMatchObject({
      status: 'proven',
      engines: ['4.3'],
      source: 'proven in 2 projects'
    })
  })
})
