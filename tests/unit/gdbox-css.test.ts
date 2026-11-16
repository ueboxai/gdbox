/** @vitest-environment node */
import { execFile } from 'node:child_process'
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

/**
 * GDBox CSS 插件（resources/godot/addons/gdbox_css）的测试外壳。
 *
 * 断言写在 tests/godot/gdbox_css_test.gd 里，要真 Godot 才跑得了：编译器产出的是
 * Theme / StyleBoxFlat，导入走的是编辑器的 EditorImportPlugin，打桩证明不了任何一件。
 * 这里搭一个临时工程、先 `--import` 让插件把 ui.css 导成 Theme，再跑断言脚本。
 * 找 Godot 用 GODOT_BIN，没设就找 PATH 上的 godot；都没有整组跳过（CI 机器上没有 Godot）。
 */

const ROOT = resolve(__dirname, '..', '..')
const GODOT = process.env.GODOT_BIN || 'godot'

const run = (args: string[], cwd: string): Promise<{ code: number; out: string }> =>
  new Promise((done) => {
    execFile(GODOT, args, { cwd, windowsHide: true, timeout: 120_000 }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0
      done({ code, out: `${stdout}\n${stderr}` })
    })
  })

const hasGodot = await run(['--version'], tmpdir()).then((r) => r.code === 0)

describe.skipIf(!hasGodot)('GDBox CSS 插件', { timeout: 180_000 }, () => {
  const project = mkdtempSync(join(tmpdir(), 'gdbox-css-'))
  afterAll(() => rmSync(project, { recursive: true, force: true }))

  it('编译器断言全过，.css 能被编辑器导入成 Theme', async () => {
    cpSync(join(ROOT, 'resources/godot/addons/gdbox_css'), join(project, 'addons/gdbox_css'), {
      recursive: true
    })
    cpSync(join(ROOT, 'tests/godot/gdbox_css_test.gd'), join(project, 'gdbox_css_test.gd'))
    writeFileSync(
      join(project, 'project.godot'),
      'config_version=5\n\n[application]\nconfig/name="gdbox-css-test"\n\n' +
        '[editor_plugins]\nenabled=PackedStringArray("res://addons/gdbox_css/plugin.cfg")\n'
    )
    writeFileSync(join(project, 'ui.css'), 'Button { background: #3b82f6; }\n')

    const imported = await run(['--headless', '--path', '.', '--import'], project)
    expect(imported.out).not.toMatch(/SCRIPT ERROR/)

    const result = await run(
      ['--headless', '--path', '.', '--script', 'res://gdbox_css_test.gd'],
      project
    )
    expect(result.out).toContain('DONE failures=0')
    expect(result.code).toBe(0)
  })
})
