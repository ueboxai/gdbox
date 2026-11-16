/**
 * Godot 工具集。
 *
 * - `godot`：检查、试玩、截图 —— 起一个无头 Godot，不需要编辑器开着
 * - `godot.editor`：用户开着的那个编辑器 —— 要 GDBox Link 连着
 *
 * 生成资源（精灵、瓦片、音效、音乐、配音）在 `../godot-asset/`。
 */

export { godotRuntimeTools, summarizeWatch } from './runtime'
export { godotEditorTools, reloadEditedScene, describeSelection } from './editor'
export { resolveProjectDir, requireGodot, NO_GODOT } from './project'
