// 资产管理相关类型定义

export interface FormattedAsset {
  name: string
  type: string
  path?: string
  assetKey: string
  folderKey: string
  folder?: string
  size?: number
  /** 用户写的备注。annotate_asset 的 note 是覆盖语义，改之前必须先看见它 */
  note?: string
  /** 已有标签，逗号分隔 */
  tags?: string
  /**
   * 这个资产是哪个引擎版本存的（如 `4.3`，目前只有 Godot 工程记录带它）。
   * Godot 3 和 4 的场景、资源互不兼容，给某个工程挑素材时这是先要看的一栏。
   *
   * 沿用自虚幻盒子：那边它一度不在返回里，挑素材完全是盲的，
   * 实测批量导入 34 成 17 败，其中 16 条都是版本不合 —— 而这本来在挑的时候就能看出来。
   *
   * 库里没记录的资产这一栏不出现，不编。
   */
  engineVersion?: string
  /** 资产图片 URL，用于图生图功能 */
  imageUrl?: string
  /**
   * 资产在本地磁盘的真实路径（绝对路径）。
   * 优先是保管库里的那一份，其次才是导入来源，缩略图只在前两者都没有时垫底。
   */
  real_path?: string
}

export interface AssetSearchParams {
  query?: string
  assetType?: string | string[]
  fileSize?: { min?: number; max?: number }
  fileFormat?: string | string[]
  engineVersion?: string | string[]
  hasNoTags?: boolean
  /**
   * 下面这几个筛选**底层一直支持**（见 models/assetSearch.ts 的 AssetSearchCriteria），
   * 但工具层长期没有透出来，于是「Trees 文件夹里有什么」「按标签筛」「我收藏的」
   * 这类最普通的问法只能靠全库翻页去凑。这里补上透传。
   */
  /** 只搜这个文件夹（folderKey）。'ALL' 或不给 = 全库 */
  folderKey?: string
  /** 连子文件夹一起搜。缺省 true —— 用户说「角色文件夹里有什么」通常包含下级 */
  includeSubfolders?: boolean
  /** 按标签筛。标签 id 由调用方解析好（工具层负责把标签名换成 id） */
  tagFilter?: {
    includeTagIds?: number[]
    excludeTagIds?: number[]
    matchMode?: 'any' | 'all'
  }
  /** 只看收藏 / 只看没收藏 */
  favoriteStatus?: 'all' | 'favorite' | 'unfavorite'
  /** 按最近一次变动时间筛。两端都要有值，底层才会生效 */
  dateRange?: { start?: string; end?: string }
  /** 这一页要几个。缺省 100，上限 500 */
  limit?: number
  /** 跳过前几个，用来翻页。缺省 0 */
  offset?: number
  /**
   * 类型/格式过滤落空时要不要自动放宽。缺省 true（单库调用方的老行为）。
   *
   * 跨库的调用方必须传 false、自己在**所有库都落空**时再放宽：逐库放宽的话，
   * 一个库有真命中、另一个库落空放宽，放宽出来的不相干资产就混进了结果里
   * （真机上查 SkeletalMesh，3 个库各自放宽，count 776 里只有 600 是真的）。
   */
  relax?: boolean
}

export interface AssetSearchSuccessResult {
  success: true
  /** 符合条件的总数（不受 limit 影响） */
  count: number
  /** 这一页实际返回的数量 */
  returnedCount?: number
  /** 这一页从第几个开始 */
  offset?: number
  /** 这一页最多取几个 */
  limit?: number
  /** 后面还有没有。为真时用 nextOffset 再调一次就能接着往下看 */
  hasMore?: boolean
  /** 下一页的 offset */
  nextOffset?: number
  assets: FormattedAsset[]
  /**
   * 指定的类型/格式一个都没命中，结果是自动放宽后拿到的。
   *
   * 为真时 `assets` 里的东西**不是**调用方要的那个类型 —— 必须据此
   * 向用户说明，不能当成筛选结果汇报。
   */
  relaxed?: boolean
  message?: string
}

export interface AssetSearchErrorResult {
  success: false
  error: string
  count: number
  assets: FormattedAsset[]
}

export type AssetSearchResult = AssetSearchSuccessResult | AssetSearchErrorResult

export interface AssetNoteParams {
  assetKey: string
  note?: string
  tagNames?: string[]
}

export interface AssetTagsParams {
  assetKey: string
  tagNames?: string | string[]
  tagIds?: number | number[]
}

export interface JumpToFolderParams {
  folderKey: string
}

// 资产类型映射：分类名 → 库里记的 Godot 类型名（见 `GodotAssetProcessor`）
export const ASSET_TYPE_MAP: Record<string, string[]> = {
  // === 贴图 / 材质 / 着色器 ===
  Texture2D: ['Texture2D', 'CompressedTexture2D', 'AtlasTexture', 'ImageTexture'],
  Material: [
    'StandardMaterial3D',
    'ORMMaterial3D',
    'ShaderMaterial',
    'CanvasItemMaterial',
    'ParticleProcessMaterial'
  ],
  Shader: ['Shader', 'ShaderInclude', 'VisualShader'],

  // === 动画 / 2D ===
  Animation: ['Animation', 'AnimationLibrary', 'SpriteFrames'],
  TileSet: ['TileSet'],

  // === 声音 ===
  Audio: ['AudioStreamWAV', 'AudioStreamOggVorbis', 'AudioStreamMP3'],

  // === 其他 ===
  Font: ['FontFile', 'SystemFont', 'FontVariation'],
  Theme: ['Theme'],

  // === 通用文件（认不出类型的文件）===
  File: ['File']
}

/**
 * 文件格式映射字典：把语义化的关键词映射到扩展名和 Godot 类型名。
 *
 * 小写的是扩展名，首字母大写的是类型名，两半按「或」匹配（见 `AssetSearcher`）。
 *
 * 场景和脚本**按扩展名**认，不按类型：库里场景的类型记的是根节点类型
 * （Node2D、CharacterBody2D…），脚本记的是 `GDScript (CharacterBody2D)`，
 * 用类型名去比一个都对不上。
 *
 * 别名里不要放一个「什么都匹配」的值（虚幻盒子时期是 `uasset`）：
 * 那个别名就会匹配全库，筛选等于没做。
 */
export const FORMAT_ALIAS_MAP: Record<string, string[]> = {
  // === 3D 模型 ===
  模型: ['glb', 'gltf', 'fbx', 'obj', 'blend', 'Model3D'],
  网格: ['glb', 'gltf', 'fbx', 'obj', 'blend', 'Model3D'],

  // === 贴图/材质/着色器 ===
  贴图: ['png', 'jpg', 'jpeg', 'webp', 'svg', 'tga', 'exr', 'hdr', 'Texture2D'],
  纹理: ['png', 'jpg', 'jpeg', 'webp', 'svg', 'tga', 'exr', 'hdr', 'Texture2D'],
  精灵: ['png', 'webp', 'svg', 'SpriteFrames', 'AtlasTexture'],
  图片: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tga', 'tiff', 'svg'],
  材质: ['StandardMaterial3D', 'ORMMaterial3D', 'ShaderMaterial', 'CanvasItemMaterial'],
  着色器: ['gdshader', 'gdshaderinc', 'Shader', 'VisualShader'],

  // === 场景 / 脚本 ===
  场景: ['tscn', 'scn'],
  关卡: ['tscn', 'scn'],
  脚本: ['gd', 'cs'],
  代码: ['gd', 'cs', 'gdshader'],

  // === 动画 / 2D ===
  动画: ['Animation', 'AnimationLibrary', 'SpriteFrames'],
  瓦片: ['TileSet'],
  瓦片集: ['TileSet'],
  UI: ['Theme', 'Control', 'CanvasLayer'],
  主题: ['Theme'],

  // === 特效 ===
  特效: [
    'ParticleProcessMaterial',
    'GPUParticles2D',
    'GPUParticles3D',
    'CPUParticles2D',
    'CPUParticles3D'
  ],
  粒子: [
    'ParticleProcessMaterial',
    'GPUParticles2D',
    'GPUParticles3D',
    'CPUParticles2D',
    'CPUParticles3D'
  ],

  // === 声音 ===
  音频: ['wav', 'mp3', 'ogg', 'AudioStreamWAV', 'AudioStreamOggVorbis', 'AudioStreamMP3'],
  声音: ['wav', 'mp3', 'ogg', 'AudioStreamWAV', 'AudioStreamOggVorbis', 'AudioStreamMP3'],
  音效: ['wav', 'ogg', 'AudioStreamWAV', 'AudioStreamOggVorbis'],
  音乐: ['ogg', 'mp3', 'AudioStreamOggVorbis', 'AudioStreamMP3'],

  // === 其他常用 ===
  字体: ['ttf', 'otf', 'woff', 'woff2', 'FontFile'],
  资源: ['tres', 'res'],
  文档: ['txt', 'md', 'pdf', 'doc', 'docx'],
  配置: ['json', 'xml', 'ini', 'cfg', 'godot']
}
