import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { mainSceneProblem } from './mainScene'

const dirs: string[] = []
function project(godot: string, files: string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), 'gdbox-main-scene-'))
  dirs.push(dir)
  writeFileSync(join(dir, 'project.godot'), godot)
  for (const file of files) {
    mkdirSync(join(dir, file, '..'), { recursive: true })
    writeFileSync(join(dir, file), '')
  }
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('mainSceneProblem', () => {
  it('没设主场景要说出来', () => {
    expect(mainSceneProblem(project('[application]\nconfig/name="CatBoat"\n'))).toMatch(
      /No main scene is set/
    )
  })

  it('主场景文件不存在要说出来', () => {
    const dir = project('[application]\nrun/main_scene="res://main.tscn"\n')
    expect(mainSceneProblem(dir)).toMatch(/res:\/\/main\.tscn does not exist/)
  })

  it('主场景在就没问题', () => {
    const dir = project('[application]\nrun/main_scene="res://scenes/main.tscn"\n', [
      'scenes/main.tscn'
    ])
    expect(mainSceneProblem(dir)).toBeNull()
  })

  it('uid:// 不解析，当作设好了', () => {
    expect(mainSceneProblem(project('[application]\nrun/main_scene="uid://b1x2y3"\n'))).toBeNull()
  })
})
