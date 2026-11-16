/**
 * Godot 资产生成工具集：精灵、视频序列帧精灵、瓦片、音效、音乐、配音、角色音色、听音频、美术风格。
 *
 * 产物一律写进工程的 res://assets/gen/<类别>/，同名重出覆盖并把旧文件备份到 .gdbox/history/，
 * 每次生成在 .gdbox/generations.jsonl 记一行（见 `godot/aigc/projectAssets.ts`）。
 * 生图、音乐、配音走用户在设置里绑定的模型（`ai/` 那一层），音效在本地合成。
 */

import type { UnrealAgentTool } from '../defineTool'
import { createArtStyleTool } from './artStyle'
import { createGenMusicTool } from './genMusic'
import { createGenSfxTool } from './genSfx'
import { createGenSpriteTool } from './genSprite'
import { createGenSpriteVideoTool } from './genSpriteVideo'
import { createGenTilesetTool } from './genTileset'
import { createGenVoiceTool } from './genVoice'
import { createInspectAudioTool } from './inspectAudio'
import { voiceDesignTools } from './voiceDesign'
import { defaultPresetsDir, type PresetsDirResolver } from './shared'

export function godotAssetTools(
  options: { presetsDir?: PresetsDirResolver } = {}
): UnrealAgentTool<never>[] {
  const presetsDir = options.presetsDir ?? defaultPresetsDir
  return [
    createGenSpriteTool(presetsDir),
    createGenSpriteVideoTool(presetsDir),
    createGenTilesetTool(presetsDir),
    createGenSfxTool(),
    createGenMusicTool(),
    createGenVoiceTool(),
    ...voiceDesignTools(),
    createInspectAudioTool(),
    createArtStyleTool(presetsDir)
  ] as unknown as UnrealAgentTool<never>[]
}

/** 会话开场要把工程风格写进提示词时用：`summarizeStyle(new StyleStore(dir, presets).get())` */
export { summarizeStyle, StyleStore } from '../../../godot/aigc/style'
