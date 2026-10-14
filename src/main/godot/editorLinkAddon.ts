/**
 * GDBox Link —— 装进 Godot 工程的编辑器插件（`addons/gdbox_link`）。
 *
 * 它在编辑器里主动连盒子的 WebSocket 服务，报上工程信息，之后盒子就能问编辑器
 * 「选中了什么」「打开某个场景」「运行 / 停止游戏」。连接方向和虚幻盒子的
 * UnrealAgentLink 一样：盒子是服务端，插件断了自己重连。
 *
 * 插件就是两个文本文件，装 = 拷进工程 + 在 project.godot 的 `[editor_plugins]` 里启用。
 */

import { app } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { getConfigValue, packedStrings, parsePackedStrings, setConfigValue } from './configFile'

export const PLUGIN_CFG = 'res://addons/gdbox_link/plugin.cfg'

/** 随包的 Godot 资源目录（插件源、无头试玩运行器） */
export function godotResourcesDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'godot')
    : join(app.getAppPath(), 'resources', 'godot')
}

function copyDir(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true })
  for (const name of readdirSync(src)) {
    const from = join(src, name)
    const to = join(dest, name)
    // 打包后插件源可能在 asar 里，用逐个读写而不是 cpSync
    if (statSync(from).isDirectory()) copyDir(from, to)
    else writeFileSync(to, readFileSync(from))
  }
}

/** 拷 addons/gdbox_link 进工程并在 project.godot 里启用。返回是否有改动 */
export function installEditorLink(projectDir: string, sourceDir = godotResourcesDir()): boolean {
  const dest = join(projectDir, 'addons', 'gdbox_link')
  const src = join(sourceDir, 'addons', 'gdbox_link')
  let changed = false
  const current = existsSync(join(dest, 'gdbox_link.gd'))
    ? readFileSync(join(dest, 'gdbox_link.gd'), 'utf8')
    : ''
  if (current !== readFileSync(join(src, 'gdbox_link.gd'), 'utf8')) {
    copyDir(src, dest)
    changed = true
  }
  const projectFile = join(projectDir, 'project.godot')
  const text = readFileSync(projectFile, 'utf8')
  const enabled = parsePackedStrings(getConfigValue(text, 'editor_plugins', 'enabled'))
  if (!enabled.includes(PLUGIN_CFG)) {
    writeFileSync(
      projectFile,
      setConfigValue(text, 'editor_plugins', 'enabled', packedStrings([...enabled, PLUGIN_CFG]))
    )
    changed = true
  }
  return changed
}

export function isEditorLinkInstalled(projectDir: string): boolean {
  const projectFile = join(projectDir, 'project.godot')
  if (!existsSync(join(projectDir, 'addons', 'gdbox_link', 'plugin.cfg')) || !existsSync(projectFile)) {
    return false
  }
  return parsePackedStrings(
    getConfigValue(readFileSync(projectFile, 'utf8'), 'editor_plugins', 'enabled')
  ).includes(PLUGIN_CFG)
}
