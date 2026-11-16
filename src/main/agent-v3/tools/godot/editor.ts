/**
 * 用户开着的那个 Godot 编辑器里的事：看场景树、在编辑器里运行、打开、选中、保存。
 *
 * 全部走 GDBox Link 插件（见 `editorRpc.ts`）。编辑器没连上时这些工具会报
 * 「编辑器未连接」—— 自己验证用 godot_check / godot_run / godot_screenshot，
 * 它们不需要编辑器。
 *
 * 「用户选中了什么」不靠工具问：发送那一刻的选中（闪存）已经随消息带进来了。
 */

import { z } from 'zod'

import { defineTool, type UnrealAgentTool } from '../defineTool'
import { callEditor } from '../editorRpc'

interface EditorNode {
  path: string
  name: string
  type: string
  script?: string
  instance?: string
  position?: string
}

/** 选中的节点写成给模型看的一小段 */
export function describeSelection(
  sel: { scene: string; nodes: EditorNode[] } | null
): string | null {
  if (!sel || !sel.nodes.length) return null
  const nodes = sel.nodes
    .slice(0, 10)
    .map(
      (n) =>
        `- ${n.path} (${n.type}${n.script ? `, script ${n.script}` : ''}${n.instance ? `, instance of ${n.instance}` : ''}${n.position ? `, at ${n.position}` : ''})`
    )
    .join('\n')
  return `Selected in ${sel.scene || 'an unsaved scene'}:\n${nodes}${sel.nodes.length > 10 ? `\n…and ${sel.nodes.length - 10} more` : ''}`
}

export function createEditorSceneTreeTool(): UnrealAgentTool<unknown> {
  return defineTool({
    name: 'editor_scene_tree',
    namespace: 'godot.editor',
    risk: 'safe',
    description:
      'The node tree of the scene open in the Godot editor (names, types, scripts, positions), plus what the user has selected and whether the game is running.',
    input: z.object({ max_depth: z.number().int().min(1).max(20).optional() }),
    async execute(args) {
      const tree = await callEditor<{ scene: string; tree: unknown }>('editor.scene_tree', {
        max_depth: args.max_depth ?? 8
      })
      const [selection, status] = await Promise.all([
        callEditor<{ scene: string; nodes: EditorNode[] }>('editor.selection', {}),
        callEditor<{ playing: boolean; open_scenes: string[] }>('editor.status', {})
      ])
      const parts = [
        tree.tree
          ? `Open scene: ${tree.scene || '(unsaved)'}\n${JSON.stringify(tree.tree, null, 1)}`
          : 'No scene is open in the editor.',
        `Open scenes: ${status.open_scenes.join(', ') || '(none)'}. Game running: ${status.playing ? 'yes' : 'no'}.`
      ]
      const described = describeSelection(selection)
      if (described) parts.push(described)
      return { text: parts.join('\n\n'), details: tree }
    }
  })
}

export function createEditorPlayTool(): UnrealAgentTool<unknown> {
  return defineTool({
    name: 'editor_play',
    namespace: 'godot.editor',
    risk: 'mutating',
    description:
      "Run the game inside the user's Godot editor so they can watch and play it (main scene, or a given scene). For your own verification use godot_run / godot_screenshot instead.",
    input: z.object({
      scene: z.string().optional().describe('res:// scene; default the main scene')
    }),
    async execute(args) {
      await callEditor('editor.play', { scene: args.scene ?? '' })
      return { text: `Running ${args.scene ?? 'the main scene'} in the editor.` }
    }
  })
}

export function createEditorStopTool(): UnrealAgentTool<unknown> {
  return defineTool({
    name: 'editor_stop',
    namespace: 'godot.editor',
    risk: 'mutating',
    description: 'Stop the game running in the Godot editor.',
    input: z.object({}),
    async execute() {
      await callEditor('editor.stop', {})
      return { text: 'Stopped.' }
    }
  })
}

export function createEditorOpenSceneTool(): UnrealAgentTool<unknown> {
  return defineTool({
    name: 'editor_open_scene',
    namespace: 'godot.editor',
    risk: 'mutating',
    description: "Open a scene in the user's Godot editor, e.g. to show them what you built.",
    input: z.object({ path: z.string().describe('res:// scene path') }),
    async execute(args) {
      await callEditor('editor.open_scene', { path: args.path })
      return { text: `Opened ${args.path}.` }
    }
  })
}

export function createEditorSelectTool(): UnrealAgentTool<unknown> {
  return defineTool({
    name: 'editor_select',
    namespace: 'godot.editor',
    risk: 'mutating',
    description:
      'Select nodes in the user\'s Godot editor (paths relative to the open scene root, "." for the root), e.g. to point at what you are talking about.',
    input: z.object({ paths: z.array(z.string()).min(1) }),
    async execute(args) {
      const { selected } = await callEditor<{ selected: string[] }>('editor.select', {
        paths: args.paths
      })
      const missing = args.paths.filter((p) => !selected.includes(p))
      return {
        text: `Selected ${selected.join(', ') || 'nothing'}${missing.length ? `; not found: ${missing.join(', ')}` : ''}.`
      }
    }
  })
}

export function createEditorSaveAllTool(): UnrealAgentTool<unknown> {
  return defineTool({
    name: 'editor_save_all',
    namespace: 'godot.editor',
    risk: 'mutating',
    description:
      "Save all scenes open in the Godot editor. Call it before editing a .tscn the user has open, so their unsaved work is on disk first and your edit doesn't get overwritten when they save.",
    input: z.object({}),
    async execute() {
      await callEditor('editor.save_all', {})
      return { text: 'Saved all open scenes.' }
    }
  })
}

export function godotEditorTools(): UnrealAgentTool<never>[] {
  return [
    createEditorSceneTreeTool(),
    createEditorPlayTool(),
    createEditorStopTool(),
    createEditorOpenSceneTool(),
    createEditorSelectTool(),
    createEditorSaveAllTool()
  ] as unknown as UnrealAgentTool<never>[]
}

/**
 * agent 在磁盘上改了一个场景 / 资源之后，让开着它的编辑器从磁盘重新加载 ——
 * 否则用户一保存，编辑器内存里的旧版本就把改动盖掉了。
 *
 * 挂在本地写文件工具的返回值上（见 registry 的 afterWrite）。编辑器没连、
 * 没开着这个文件、重新加载失败，都安静地什么也不说：写文件本身已经成功了。
 */
export async function reloadEditedScene(params: Record<string, unknown>): Promise<string> {
  const path = typeof params.path === 'string' ? params.path : ''
  if (!/\.(tscn|tres)$/i.test(path)) return ''
  try {
    const { serviceManager } = await import('../../../services')
    if (serviceManager.getWebSocketService().getConnectionCount() === 0) return ''
    const { projectManager } = await import('../../../services/project/projectManager')
    const normalized = path.replace(/\\/g, '/')
    const project = projectManager
      .getInteractiveProjects()
      .find((p) =>
        normalized.toLowerCase().startsWith(p.projectPath.replace(/\\/g, '/').toLowerCase() + '/')
      )
    const resPath = normalized.startsWith('res://')
      ? normalized
      : project
        ? 'res://' + normalized.slice(project.projectPath.replace(/\\/g, '/').length + 1)
        : ''
    if (!resPath) return ''
    const { reloaded } = await callEditor<{ reloaded: boolean }>(
      'editor.reload_scene',
      { path: resPath },
      { timeoutMs: 5_000 }
    )
    return reloaded ? `\n(Reloaded ${resPath} in the open Godot editor.)` : ''
  } catch {
    return ''
  }
}
