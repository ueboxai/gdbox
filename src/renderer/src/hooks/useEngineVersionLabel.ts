/** 工程卡片上的引擎版本文案：project.godot 里 config/features 的版本号，没有就显示 N/A */
const FALLBACK_LABEL = 'N/A'

export function useEngineVersionLabel(): {
  engineLabel: (version: string | null | undefined) => string
} {
  const engineLabel = (version: string | null | undefined): string =>
    String(version || '').trim() || FALLBACK_LABEL
  return { engineLabel }
}
