import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ProjectAssets } from './projectAssets'

describe('ProjectAssets', () => {
  it('名字转成安全的文件名', () => {
    expect(ProjectAssets.slug('Hero Fox (v2)!')).toBe('hero_fox_v2')
    expect(ProjectAssets.slug('小狐狸')).toBe('asset')
  })

  it('写进 res://assets/gen，覆盖前备份，记录生成，.gdbox 带 .gdignore', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gdbox-assets-'))
    const assets = new ProjectAssets(dir)
    const { abs, res } = assets.path('sfx', 'jump_1.wav')
    expect(res).toBe('res://assets/gen/sfx/jump_1.wav')

    assets.write(abs, 'v1')
    assets.write(abs, 'v2')
    expect(readFileSync(abs, 'utf8')).toBe('v2')
    const history = join(dir, '.gdbox', 'history')
    const [stamp] = readdirSync(history)
    expect(readFileSync(join(history, stamp, 'assets', 'gen', 'sfx', 'jump_1.wav'), 'utf8')).toBe(
      'v1'
    )
    expect(existsSync(join(dir, '.gdbox', '.gdignore'))).toBe(true)

    assets.record({ tool: 'gen_sfx', api: 'sfxr', outputs: [res] })
    const line = JSON.parse(readFileSync(join(dir, '.gdbox', 'generations.jsonl'), 'utf8').trim())
    expect(line).toMatchObject({ tool: 'gen_sfx', api: 'sfxr', outputs: [res] })
  })
})
