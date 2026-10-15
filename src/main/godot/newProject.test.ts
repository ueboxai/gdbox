import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createEmptyProject, projectGodotText } from './newProject'
import { parseProjectFile } from './projectFile'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'gdbox-new-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('新建空工程', () => {
  it('不存在的文件夹：建出来，工程名取文件夹名，特性版本取装着的 Godot', () => {
    const dir = join(root, 'CoinCatch')
    expect(createEmptyProject(dir, '4.7.1.stable')).toEqual({ ok: true, projectDir: dir })
    const text = readFileSync(join(dir, 'project.godot'), 'utf8')
    expect(text).toContain('config_version=5')
    expect(text).toContain('config/name="CoinCatch"')
    expect(text).toContain('PackedStringArray("4.7")')
    expect(existsSync(join(dir, 'icon.svg'))).toBe(true)
    // 工程名里的引号要转义（macOS 上文件夹名可以带引号）
    expect(projectGodotText('Coin "Catch"')).toContain('config/name="Coin \\"Catch\\""')
  })

  it('空文件夹可以；有东西的不行；已经是工程的提示去导入', () => {
    const empty = join(root, 'empty')
    mkdirSync(empty)
    expect(createEmptyProject(empty).ok).toBe(true)

    const busy = join(root, 'busy')
    mkdirSync(busy)
    writeFileSync(join(busy, 'notes.txt'), 'x')
    expect(createEmptyProject(busy)).toMatchObject({ ok: false, error: expect.stringContaining('空文件夹') })

    expect(createEmptyProject(empty)).toMatchObject({ ok: false, error: expect.stringContaining('导入') })
  })

  it('写出来的 project.godot 自己的解析器读得回来', () => {
    const parsed = parseProjectFile(projectGodotText('Demo', '4.3'))
    expect(parsed.name).toBe('Demo')
  })
})
