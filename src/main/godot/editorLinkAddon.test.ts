import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => process.cwd() } }))

import { installEditorLink } from './editorLinkAddon'

const SOURCE = join(process.cwd(), 'resources', 'godot')
const dirs: string[] = []

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gdbox-link-'))
  dirs.push(dir)
  writeFileSync(join(dir, 'project.godot'), 'config_version=5\n')
  return dir
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('installEditorLink', () => {
  it('只有右键菜单脚本过期时也会重新拷', () => {
    const dir = project()
    expect(installEditorLink(dir, SOURCE)).toBe(true)
    expect(installEditorLink(dir, SOURCE)).toBe(false)

    const menu = join(dir, 'addons', 'gdbox_link', 'gdbox_context_menu.gd')
    writeFileSync(menu, '# old\n')
    expect(installEditorLink(dir, SOURCE)).toBe(true)
    expect(readFileSync(menu, 'utf8')).toBe(
      readFileSync(join(SOURCE, 'addons', 'gdbox_link', 'gdbox_context_menu.gd'), 'utf8')
    )
  })
})
