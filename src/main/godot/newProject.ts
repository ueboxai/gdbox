/**
 * 新建一个空的 Godot 工程：一个文件夹里放一份 project.godot。
 *
 * 和 Godot 项目管理器「新建项目」得到的东西对齐到够用的程度：工程名、引擎特性版本、
 * 一个 icon.svg（编辑器里工程列表要它）。渲染器用默认值，不替用户挑。
 *
 * 只往空文件夹里建，或者往不存在的文件夹里建 —— 往一个已经有东西的文件夹里塞
 * project.godot，等于把用户别的文件都收进一个工程，导入时 Godot 会扫一遍全部。
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs'
import { basename, join } from 'path'

const ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="124" height="124" x="2" y="2" fill="#363d52" stroke="#212532" stroke-width="4" rx="14"/><path fill="#478cbf" d="M40 36h48v56H40z"/></svg>\n'

/** project.godot 的工程名是带引号的字符串：引号和反斜杠要转义 */
function quote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export function projectGodotText(name: string, engineVersion?: string): string {
  const features = engineVersion?.match(/^(\d+\.\d+)/)?.[1] ?? '4.3'
  return [
    '; Engine configuration file.',
    "; It's best edited using the editor UI and not directly,",
    '; since the parameters that go here are not all obvious.',
    ';',
    '; Format:',
    ';   [section] ; section goes between []',
    ';   param=value ; assign values to parameters',
    '',
    'config_version=5',
    '',
    '[application]',
    '',
    `config/name=${quote(name)}`,
    `config/features=PackedStringArray("${features}")`,
    'config/icon="res://icon.svg"',
    ''
  ].join('\n')
}

export type NewProjectResult = { ok: true; projectDir: string } | { ok: false; error: string }

export function createEmptyProject(projectDir: string, engineVersion?: string): NewProjectResult {
  if (existsSync(projectDir)) {
    const entries = readdirSync(projectDir).filter((name) => !/^(\.DS_Store|Thumbs\.db|desktop\.ini)$/i.test(name))
    if (entries.includes('project.godot')) return { ok: false, error: '这个文件夹里已经有一个 Godot 工程了，请用「选择 project.godot 文件」导入它' }
    if (entries.length) return { ok: false, error: '请选一个空文件夹，或者新建一个文件夹' }
  }
  mkdirSync(projectDir, { recursive: true })
  writeFileSync(join(projectDir, 'project.godot'), projectGodotText(basename(projectDir), engineVersion))
  writeFileSync(join(projectDir, 'icon.svg'), ICON_SVG)
  return { ok: true, projectDir }
}
