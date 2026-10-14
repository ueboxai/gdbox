/**
 * 资产命名和分类规则类型定义
 */

/**
 * 命名约定类型
 */
export type NamingConvention = 'pascalCase' | 'camelCase' | 'snake_case' | 'kebab-case'

/**
 * 纹理后缀模式配置
 */
export interface TextureSuffixPattern {
  /** 正则表达式字符串 */
  pattern: string
  /** 应用的后缀 */
  suffix: string
  /** 纹理类型标识（如 Albedo, Normal, Roughness 等） */
  type: string
  /** 是否启用 */
  enabled?: boolean
}

/**
 * 自定义改名规则的匹配位置。
 *
 * **故意不是正则。** 这里原先是一个自由填写的正则框，2026-09-11 实测下来那条路走不通：
 * JS 的 `String.replace` 一旦跑起来**中断不了**（没有超时、没有信号），而灾难性回溯
 * 压根不需要写出括号 —— `a+a+a+a+a+a+a+a+a+a+$` 在 49 个字符的名字上实测 34 秒，
 * 主进程连同 UI、IPC、Agent 一起停住，只能从任务管理器杀。
 *
 * 试过按「形状」拦（拒掉带量词的组），两个方向都错：上面那条不带组的照样过得去，
 * 而 `\(\d+\)+$`（剥掉 Windows 复制文件时加的 `(1)`）实测 0.0003 毫秒却被判成危险。
 * 判据每补一条就有下一类构造绕过去 —— 这类东西没法靠认形状放行。
 *
 * 所以换成三个固定位置 + 纯文本。用户真正想做的事（去掉 `_FINAL` / `_v2` / `_copy`、
 * 把 `Temp_` 换成 `WIP_`、清拼音残留）全是「在开头/结尾/中间找一段原文换掉」，
 * 一个正则都用不上；而这么一换，卡死的可能性从代码里消失了，不是被挡住了。
 */
export type CustomRuleMatch = 'startsWith' | 'endsWith' | 'contains'

/**
 * 自定义规则
 */
export interface CustomRule {
  /** 规则名称 */
  name: string
  /** 匹配位置：开头 / 结尾 / 任意位置 */
  match: CustomRuleMatch
  /** 要找的原文，**纯文本按字面匹配**，不是正则 */
  text: string
  /** 换成什么，留空表示删掉这一段 */
  replacement: string
  /** 是否启用 */
  enabled?: boolean
  /** 规则描述 */
  description?: string
}

/**
 * 命名规则配置
 */
export interface NamingRulesConfig {
  /** 配置版本 */
  version: string
  /** 资产类型到前缀的映射 */
  assetPrefixes: Record<string, string>
  /** 纹理后缀检测规则 */
  textureSuffixPatterns: TextureSuffixPattern[]
  /** 资产类型到目录的映射 */
  assetTypeToDirectory: Record<string, string>
  /** 资产库内部的分类目录映射 (相对路径) */
  libraryAssetTypeToDirectory: Record<string, string>
  /** 文件扩展名到资产类型的映射 */
  extensionToAssetType: Record<string, string>
  /** 命名约定 */
  namingConvention: NamingConvention
  /** 自定义规则 */
  customRules?: CustomRule[]
  /** 是否自动添加前缀（如果资产名已包含前缀则跳过） */
  autoAddPrefix?: boolean
  /** 是否自动检测纹理类型 */
  autoDetectTextureType?: boolean
}

/**
 * 默认配置（按 Godot 官方风格指南）
 *
 * - 文件和目录一律 snake_case，不加类型前缀（Godot 项目里类型看扩展名就够了）
 * - 节点名用 PascalCase，那是场景里的事，不归这张表管
 * - 纹理通道用小写后缀，和 snake_case 文件名保持一致
 * - 目录是 `res://` 下的相对位置
 */
export const DEFAULT_NAMING_RULES_CONFIG: NamingRulesConfig = {
  version: '2.0.0',
  assetPrefixes: {},
  textureSuffixPatterns: [
    {
      pattern: '[-_](diffuse|albedo|basecolor|base_color|color|col|diff|d)$',
      suffix: '_albedo',
      type: 'Albedo',
      enabled: true
    },
    {
      pattern: '[-_](normal|norm|nrm|n)$',
      suffix: '_normal',
      type: 'Normal',
      enabled: true
    },
    {
      pattern: '[-_](roughness|rough|rgh|r)$',
      suffix: '_roughness',
      type: 'Roughness',
      enabled: true
    },
    {
      pattern: '[-_](metallic|metal|met|m)$',
      suffix: '_metallic',
      type: 'Metallic',
      enabled: true
    },
    {
      pattern: '[-_](ao|ambient|occlusion|occ|o)$',
      suffix: '_ao',
      type: 'AO',
      enabled: true
    },
    {
      pattern: '[-_](height|displacement|disp|h)$',
      suffix: '_height',
      type: 'Height',
      enabled: true
    },
    {
      pattern: '[-_](emissive|emission|emit|e)$',
      suffix: '_emission',
      type: 'Emissive',
      enabled: true
    },
    {
      pattern: '[-_](opacity|alpha|a)$',
      suffix: '_alpha',
      type: 'Opacity',
      enabled: true
    },
    {
      pattern: '[-_](mask)$',
      suffix: '_mask',
      type: 'Mask',
      enabled: true
    }
  ],
  assetTypeToDirectory: {
    Model: 'res://assets/models',
    Texture: 'res://assets/textures',
    Material: 'res://assets/materials',
    Audio: 'res://assets/audio',
    Video: 'res://assets/video',
    Font: 'res://assets/fonts',
    Shader: 'res://shaders',
    Script: 'res://scripts',
    Scene: 'res://scenes'
  },
  libraryAssetTypeToDirectory: {
    Model: 'models',
    Texture: 'textures',
    Material: 'materials',
    Audio: 'audio',
    Video: 'video',
    Font: 'fonts',
    Shader: 'shaders',
    Script: 'scripts',
    Scene: 'scenes'
  },
  extensionToAssetType: {
    glb: 'Model',
    gltf: 'Model',
    fbx: 'Model',
    obj: 'Model',
    blend: 'Model',
    png: 'Texture',
    jpg: 'Texture',
    jpeg: 'Texture',
    webp: 'Texture',
    svg: 'Texture',
    tga: 'Texture',
    exr: 'Texture',
    hdr: 'Texture',
    bmp: 'Texture',
    wav: 'Audio',
    ogg: 'Audio',
    mp3: 'Audio',
    ogv: 'Video',
    ttf: 'Font',
    otf: 'Font',
    woff2: 'Font',
    gdshader: 'Shader',
    gd: 'Script',
    tscn: 'Scene',
    tres: 'Material'
  },
  namingConvention: 'snake_case',
  autoAddPrefix: false,
  autoDetectTextureType: true,
  customRules: []
}
