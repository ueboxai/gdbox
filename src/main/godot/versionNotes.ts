/**
 * Godot 4.4 以后的版本差异，按工程版本挑出来给模型看。
 *
 * ## 为什么要有
 *
 * 模型对 4.3 及以前很熟，对之后的改动知道得少，而且错法是静默的：照旧版习惯写，
 * 不报错但结果不对（4.7 的 `area_mask` 默认值改成 0，水下音频总线就失效了）。
 * GodotPrompter 的对照评测里，不给这条信息时模型 3 次全错、给了 3 次全对。
 * 反方向也一样：在 4.3 工程里写 typed Dictionary，报错后模型不知道是版本问题。
 *
 * ## 两处用法
 *
 * - `versionNotesForPrompt`：系统提示词 `<environment>` 里的一段，按**工程声明的版本**
 *   （`config/features`）挑。上限 2.5 KB，按数组顺序截断，所以**数组顺序就是优先级**。
 * - `versionHintsForErrors`：`godot_check` / `godot_run` 报错时，按**实际运行的引擎版本**
 *   匹配报错文本，补一句可能的版本原因。报错是那个引擎打的，所以看它的版本。
 *
 * ## 收录标准
 *
 * 只收「模型照旧习惯写会出错」的。纯新增功能只在「旧工程不能用」时有意义，收成 `added`。
 * 默认值类条目在本机 4.7.1 上用 `ClassDB.class_get_property_default_value` 核过；
 * `patterns` 来自真实引擎输出。4.7、4.8 条目参考了 GodotPrompter（MIT，见 THIRD-PARTY-NOTICES.md），
 * 4.4–4.6 来自官方迁移指南。4.8 条目写入时 4.8 还是 beta，本机没有 4.8，
 * 是对着 godotengine/godot master 的 class reference 和源码核的；4.8-stable 发布后要复核。
 */

export interface VersionNote {
  /** 改动出现的版本 */
  since: string
  /** changed = 旧写法的行为变了；added = 这一版才有的 API */
  kind: 'changed' | 'added'
  /** 给模型看的一句话。added 只写名字，例如 "typed Dictionary[K, V]" */
  summary: string
  /** 匹配引擎报错的正则；静默类改动没有报错可匹配，不填 */
  patterns?: RegExp[]
  source: string
}

/** 模型可靠掌握的最后一版。比它新的改动才需要提 */
export const BASELINE_VERSION = '4.3'

/** 提示词里这一段的上限（字节）。约 600 token，每个 Godot 工程会话都要付 */
export const PROMPT_BUDGET_BYTES = 2500

const MIGRATE = 'https://docs.godotengine.org/en/latest/tutorials/migrating/upgrading_to_godot_'
const PR = 'https://github.com/godotengine/godot/pull/'
const CLASSES = 'https://docs.godotengine.org/en/latest/classes/class_'

export const VERSION_NOTES: readonly VersionNote[] = [
  // ---- changed：按踩中的概率排，越靠前越不会被截掉 ----
  {
    since: '4.7',
    kind: 'changed',
    summary:
      'An override of a method with a typed return inherits that return type, so every code path must return (add `return null`).',
    patterns: [/Not all code paths return a value/],
    source: `${PR}115763`
  },
  {
    since: '4.4',
    kind: 'changed',
    summary:
      'Scripts and shaders get a `.uid` sidecar file; move, rename or delete it together with the source file.',
    patterns: [/(invalid|unrecognized) UID/i],
    source: `${MIGRATE}4.4.html`
  },
  {
    since: '4.6',
    kind: 'changed',
    summary:
      '.tscn files no longer write load_steps, and each [node] carries unique_id=N; keep existing unique_id values when editing scene text.',
    source: `${MIGRATE}4.6.html`
  },
  {
    since: '4.7',
    kind: 'changed',
    summary:
      'AudioStreamPlayer2D/3D.area_mask defaults to 0, so Area audio_bus_override ignores players until area_mask is set to 1.',
    source: `${PR}107679`
  },
  {
    since: '4.7',
    kind: 'changed',
    summary:
      'Mouse and keyboard events are no longer device 0: they report InputEvent.DEVICE_ID_MOUSE (32) / DEVICE_ID_KEYBOARD (16).',
    source: `${PR}116274`
  },
  {
    since: '4.8',
    kind: 'changed',
    summary:
      'Every project has a built-in Alt+Enter fullscreen toggle (ui_toggle_fullscreen); a game binding Alt+Enter itself toggles twice.',
    source: `${PR}39708`
  },
  {
    since: '4.8',
    kind: 'changed',
    summary: 'C# projects need .NET 10: TargetFramework net10.0 is the minimum.',
    patterns: [/net10\.0/],
    source: `${PR}123738`
  },
  {
    since: '4.4',
    kind: 'changed',
    summary:
      '@export_file values set in the Inspector are stored as uid:// paths, not res:// (4.5+ adds @export_file_path for res://).',
    source: `${PR}97912`
  },
  {
    since: '4.5',
    kind: 'changed',
    summary:
      'Resource.duplicate(true) no longer copies external sub-resources; use duplicate_deep(Resource.DEEP_DUPLICATE_ALL).',
    source: `${MIGRATE}4.5.html`
  },
  {
    since: '4.5',
    kind: 'changed',
    summary: 'Node.get_rpc_config() was renamed to get_node_rpc_config().',
    patterns: [/get_rpc_config/],
    source: `${PR}106848`
  },
  {
    since: '4.5',
    kind: 'changed',
    summary:
      'TileMapLayer chunks physics (physics_quadrant_size 16), so get_coords_for_body_rid() is approximate unless physics_quadrant_size = 1.',
    source: `${MIGRATE}4.5.html`
  },
  {
    since: '4.7',
    kind: 'changed',
    summary: 'type_exists() is deprecated; use ClassDB.class_exists().',
    patterns: [/type_exists/],
    source: `${PR}116899`
  },
  {
    since: '4.7',
    kind: 'changed',
    summary: 'textureQueryLod() is a compile error outside fragment().',
    patterns: [/textureQueryLod/],
    source: `${MIGRATE}4.7.html`
  },
  {
    since: '4.6',
    kind: 'changed',
    summary:
      'AStar2D/3D.get_point_path and AStarGrid2D.get_id_path/get_point_path return an empty path when the start point is disabled or solid.',
    source: `${PR}113988`
  },
  {
    since: '4.7',
    kind: 'changed',
    summary:
      'AnimationNodeBlendSpace1D/2D: the bool `sync` is deprecated; set `sync_mode` (SYNC_MODE_NONE is the default).',
    source: `${MIGRATE}4.7.html`
  },
  {
    since: '4.7',
    kind: 'changed',
    summary:
      'Setting one element of a packed-array property (obj.arr[i] = x) no longer calls that property’s setter.',
    source: `${PR}113228`
  },
  {
    since: '4.7',
    kind: 'changed',
    summary:
      'RichTextLabel.add_image/update_image take width_unit/height_unit instead of width_in_percent/height_in_percent.',
    patterns: [/width_in_percent|height_in_percent|UPDATE_WIDTH_IN_PERCENT/],
    source: `${PR}112617`
  },
  {
    since: '4.6',
    kind: 'changed',
    summary:
      'New 3D projects use Jolt Physics; with Jolt, Area3D always reports static bodies (4.5+) and SoftBody3D (4.7+).',
    source: `${MIGRATE}4.6.html`
  },
  {
    since: '4.7',
    kind: 'changed',
    summary:
      'Jolt Physics: WorldBoundaryShape3D plane.d uses the opposite sign compared to 4.6; SoftBody3D mass defaults to 1 kg total.',
    source: `${MIGRATE}4.7.html`
  },
  {
    since: '4.6',
    kind: 'changed',
    summary:
      'Environment glow defaults changed (blend mode Screen, intensity 0.3), and volumetric fog renders brighter.',
    source: `${MIGRATE}4.6.html`
  },
  {
    since: '4.7',
    kind: 'changed',
    summary:
      'Antialiased CanvasItem lines (draw_line etc.) no longer add a feather, so they look thinner.',
    source: `${PR}105122`
  },
  {
    since: '4.4',
    kind: 'changed',
    summary:
      'Curve enforces min_value/max_value (default 0–1); points outside the range need the range widened first.',
    source: `${MIGRATE}4.4.html`
  },
  {
    since: '4.4',
    kind: 'changed',
    summary:
      'CSG uses the Manifold library; non-manifold meshes (planes, quads) no longer work in CSG.',
    source: `${PR}94321`
  },
  {
    since: '4.7',
    kind: 'changed',
    summary: 'TabContainer.all_tabs_in_front is deprecated and does nothing.',
    source: `${PR}118623`
  },
  {
    since: '4.8',
    kind: 'changed',
    summary:
      'Projects created in 4.8 ignore joypad input while the window is unfocused and use gui/common/auto_focus_strategy = Balloon.',
    source: `${PR}120399`
  },
  {
    since: '4.8',
    kind: 'changed',
    summary:
      'Editor main-screen plugins are docks: _has_main_screen() is deprecated; add_dock() an EditorDock with DOCK_SLOT_MAIN_SCREEN.',
    patterns: [/_has_main_screen|get_editor_main_screen/],
    source: `${PR}113051`
  },

  // ---- added：旧工程里不能用的写法 ----
  {
    since: '4.4',
    kind: 'added',
    summary: 'typed Dictionary[K, V]',
    source: `${MIGRATE}4.4.html`
  },
  {
    since: '4.4',
    kind: 'added',
    summary: '@export_tool_button',
    patterns: [/@export_tool_button/],
    source: `${MIGRATE}4.4.html`
  },
  {
    since: '4.5',
    kind: 'added',
    summary: '@abstract',
    patterns: [/@abstract/],
    source: `${MIGRATE}4.5.html`
  },
  {
    since: '4.5',
    kind: 'added',
    summary: 'variadic functions (...args)',
    source: `${MIGRATE}4.5.html`
  },
  {
    since: '4.5',
    kind: 'added',
    summary: '@export_file_path',
    patterns: [/@export_file_path/],
    source: `${MIGRATE}4.5.html`
  },
  {
    since: '4.5',
    kind: 'added',
    summary: 'Resource.duplicate_deep()',
    patterns: [/duplicate_deep/],
    source: `${MIGRATE}4.5.html`
  },
  {
    since: '4.7',
    kind: 'added',
    summary: 'VirtualJoystick',
    patterns: [/VirtualJoystick/],
    source: `${MIGRATE}4.7.html`
  },
  {
    since: '4.7',
    kind: 'added',
    summary: 'InputEvent.DEVICE_ID_MOUSE / DEVICE_ID_KEYBOARD',
    patterns: [/DEVICE_ID_(MOUSE|KEYBOARD)/],
    source: `${PR}116274`
  },
  {
    since: '4.8',
    kind: 'added',
    summary: 'Label/RichTextLabel.resize_font_to_fit',
    patterns: [/resize_font_to_fit/],
    source: `${CLASSES}label.html`
  },
  {
    since: '4.8',
    kind: 'added',
    summary: 'Trail3D',
    patterns: [/Trail3D/],
    source: `${CLASSES}trail3d.html`
  },
  {
    since: '4.8',
    kind: 'added',
    summary: 'PhysicsDirectSpaceState2D/3D.intersect_ray_into() and other *_into queries',
    patterns: [/\b(intersect_(ray|point|shape)|cast_motion|collide_shape|get_rest_info)_into\b/],
    source: `${CLASSES}physicsdirectspacestate3d.html`
  }
]

/** 从 "4.7"、"4.7.1.stable.official.xxx" 里取主次版本；取不到返回 null */
export function minorVersion(raw: string | undefined): string | null {
  return raw ? (/^(\d+)\.(\d+)/.exec(raw.trim())?.slice(1, 3).join('.') ?? null) : null
}

/** 逐段按数字比，"4.10" 大于 "4.9" */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/** 这条在这个版本上是否成立：changed 要求版本已包含它，added 要求版本还没有它 */
function appliesTo(note: VersionNote, version: string): boolean {
  return note.kind === 'changed'
    ? compareVersions(note.since, version) <= 0
    : compareVersions(note.since, version) > 0
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

/**
 * 系统提示词里的那一段。版本未知、或者没有要说的，返回空数组。
 * 先放 added（只一行，最便宜），再按顺序放 changed 直到用完预算。
 */
export function versionNotesForPrompt(
  projectVersion: string | undefined,
  notes: readonly VersionNote[] = VERSION_NOTES,
  budget = PROMPT_BUDGET_BYTES
): string[] {
  const version = minorVersion(projectVersion)
  if (!version) return []

  const lines: string[] = []
  const added = notes.filter((n) => n.kind === 'added' && appliesTo(n, version))
  if (added.length) {
    lines.push(
      `Not available in Godot ${version}: ${added.map((n) => `${n.summary} (${n.since})`).join(', ')}.`
    )
  }

  const changed = notes.filter(
    (n) =>
      n.kind === 'changed' &&
      compareVersions(n.since, BASELINE_VERSION) > 0 &&
      appliesTo(n, version)
  )
  if (changed.length) {
    const header = `Godot ${version} differs from what material written for ${BASELINE_VERSION} and earlier describes:`
    let used = byteLength(lines.join('\n')) + byteLength(header) + 1
    const kept: string[] = []
    for (const note of changed) {
      const line = `- ${note.summary} (${note.since})`
      if (used + byteLength(line) + 1 > budget) break
      kept.push(line)
      used += byteLength(line) + 1
    }
    if (kept.length) lines.push(header, ...kept)
  }
  return lines
}

/**
 * 报错里能对上的版本差异，拼成附在工具结果末尾的一段；对不上返回空串。
 * 同一条只出现一次，不管匹配到几次。
 */
export function versionHintsForErrors(
  engineVersion: string | undefined,
  texts: readonly string[],
  notes: readonly VersionNote[] = VERSION_NOTES
): string {
  const version = minorVersion(engineVersion)
  if (!version || texts.length === 0) return ''
  const joined = texts.join('\n')
  const hits = notes.filter((n) => n.patterns?.some((p) => p.test(joined)) && appliesTo(n, version))
  if (!hits.length) return ''
  const lines = hits.map((n) =>
    n.kind === 'changed'
      ? `- Changed in Godot ${n.since}: ${n.summary} ${n.source}`
      : `- ${n.summary} needs Godot ${n.since}+; this engine is ${version}. ${n.source}`
  )
  return `Godot version notes that may explain the errors above:\n${lines.join('\n')}`
}
