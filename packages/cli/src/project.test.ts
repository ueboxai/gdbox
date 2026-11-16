/** @vitest-environment node */
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { GdboxError } from './errors.js'
import {
  canonicalizeProjectPath,
  findProjectUpwards,
  localProject,
  pickConnected,
  projectName,
  type RegisteredProject
} from './project.js'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

async function projectDir(name = 'Demo', godotName?: string): Promise<string> {
  // 目录名带空格和中文：真机上这两样最容易出问题，而它们完全是常态
  const root = await fs.mkdtemp(join(tmpdir(), 'gdbox 工程-'))
  dirs.push(root)
  const dir = join(root, name)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(
    join(dir, 'project.godot'),
    godotName ? `[application]\n\nconfig/name="${godotName}"\n` : '[application]\n'
  )
  return dir.replace(/\\/g, '/')
}

function registered(
  ...entries: Array<{ path: string; editorConnected?: boolean }>
): RegisteredProject[] {
  return entries.map((entry, index) => ({
    name: entry.path.split('/').pop() ?? `P${index}`,
    path: entry.path,
    godotVersion: '4.4',
    onDisk: true,
    editorConnected: entry.editorConnected === true,
    projectKey: `key-${index}`
  }))
}

describe('canonicalizeProjectPath', () => {
  it('给目录就用目录', async () => {
    const dir = await projectDir()
    expect(await canonicalizeProjectPath(dir)).toBe(dir)
  })

  /** 用户手上有哪个就给哪个，逼他先想清楚该给哪种是没必要的负担 */
  it('给 project.godot 文件就落到它所在的目录', async () => {
    const dir = await projectDir()
    expect(await canonicalizeProjectPath(join(dir, 'project.godot'))).toBe(dir)
  })

  it('带空格和中文的路径照常处理', async () => {
    const dir = await projectDir('我的工程')
    expect(await canonicalizeProjectPath(dir)).toBe(dir)
    expect(dir).toContain(' ')
  })

  it('路径不存在时报 INVALID_ARGUMENT', async () => {
    try {
      await canonicalizeProjectPath(join(tmpdir(), 'gdbox-不存在-12345'))
      expect.unreachable('应该抛出')
    } catch (error) {
      expect((error as GdboxError).code).toBe('INVALID_ARGUMENT')
    }
  })

  it('目录里没有 project.godot 时说清楚', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'gdbox-empty-'))
    dirs.push(root)

    await expect(canonicalizeProjectPath(root)).rejects.toThrow(/没有 project\.godot/)
  })

  it('指到别的文件上时拒绝', async () => {
    const dir = await projectDir()
    await fs.writeFile(join(dir, 'main.tscn'), '')

    await expect(canonicalizeProjectPath(join(dir, 'main.tscn'))).rejects.toThrow(
      /不是 project\.godot/
    )
  })
})

describe('findProjectUpwards', () => {
  it('从子目录往上找到最近的工程', async () => {
    const dir = await projectDir()
    const deep = join(dir, 'scenes', 'levels')
    await fs.mkdir(deep, { recursive: true })

    expect(await findProjectUpwards(deep)).toBe(dir)
  })

  it('找到根还没有就返回 undefined，不是报错', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'gdbox-none-'))
    dirs.push(root)

    expect(await findProjectUpwards(root)).toBeUndefined()
  })
})

describe('projectName', () => {
  it('用 project.godot 里的 config/name', async () => {
    const dir = await projectDir('folder', '跳跳乐')
    expect(await projectName(dir)).toBe('跳跳乐')
  })

  it('没写名字时退回目录名', async () => {
    const dir = await projectDir('folder')
    expect(await projectName(dir)).toBe('folder')
  })
})

describe('localProject', () => {
  it('显式 --project 优先于当前目录', async () => {
    const mine = await projectDir('Mine')
    const here = await projectDir('Here')

    expect(await localProject(mine, here)).toMatchObject({ path: mine, source: 'explicit' })
  })

  it('没给 --project 时用当前目录所在的工程', async () => {
    const dir = await projectDir()
    expect(await localProject(undefined, join(dir))).toMatchObject({ path: dir, source: 'cwd' })
  })

  it('两级都没有线索时返回 undefined', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'gdbox-none-'))
    dirs.push(root)
    expect(await localProject(undefined, root)).toBeUndefined()
  })
})

describe('pickConnected', () => {
  it('恰好一个编辑器连着就用它', () => {
    const picked = pickConnected(
      registered({ path: 'D:/A', editorConnected: true }, { path: 'D:/B' })
    )
    expect(picked).toMatchObject({ path: 'D:/A', source: 'single' })
  })

  /** 登记了但编辑器没开的工程不算候选 —— 「只登记一个」不等于用户要的就是它 */
  it('一个编辑器都没连着时报 PROJECT_NOT_CONNECTED', () => {
    try {
      pickConnected(registered({ path: 'D:/A' }))
      expect.unreachable('应该抛出')
    } catch (error) {
      expect((error as GdboxError).code).toBe('PROJECT_NOT_CONNECTED')
      expect((error as GdboxError).hint).toContain('--project')
    }
  })

  it('两个编辑器连着时报歧义，不挑', () => {
    try {
      pickConnected(
        registered({ path: 'D:/A', editorConnected: true }, { path: 'D:/B', editorConnected: true })
      )
      expect.unreachable('应该抛出')
    } catch (error) {
      expect((error as GdboxError).code).toBe('PROJECT_AMBIGUOUS')
    }
  })
})
