/**
 * 资产类别工具函数
 * 提供 Godot 资源类名的中文翻译和颜色映射
 * 放在 shared：本地库在主进程入库时用，服务器库在渲染进程显示时用，两边同一张表
 */

/**
 * 类名到中文名的映射配置
 * 顺序很重要：更具体的匹配应该放在前面
 *
 * 类名来自 `GodotAssetProcessor`：场景记根节点类型，资源记 `gd_resource` 的 type，
 * 其余按扩展名。场景根节点类型（CharacterBody2D、Control…）不翻译，原样显示。
 */
const CLASS_MAPPING: Array<{ test: (s: string) => boolean; name: string }> = [
  { test: (x) => x === 'PackedScene', name: '场景' },
  { test: (x) => x.startsWith('GDScript'), name: '脚本' },
  { test: (x) => x === 'ShaderInclude', name: '着色器片段' },
  { test: (x) => x.includes('Shader') && !x.includes('Material'), name: '着色器' },
  { test: (x) => x.includes('Material'), name: '材质' },
  { test: (x) => x === 'SpriteFrames', name: '帧动画' },
  { test: (x) => x.includes('Texture'), name: '纹理' },
  { test: (x) => x.startsWith('AudioStream'), name: '音频' },
  { test: (x) => x === 'Model3D', name: '3D 模型' },
  { test: (x) => x.endsWith('Mesh'), name: '网格' },
  { test: (x) => x === 'AnimationLibrary', name: '动画库' },
  { test: (x) => x === 'Animation', name: '动画' },
  { test: (x) => x === 'TileSet', name: '图块集' },
  { test: (x) => x === 'Theme', name: '主题' },
  { test: (x) => x === 'FontFile' || x === 'SystemFont' || x === 'FontVariation', name: '字体' },
  { test: (x) => x === 'Environment', name: '环境' },
  { test: (x) => x === 'Gradient', name: '渐变' },
  { test: (x) => x.startsWith('Curve'), name: '曲线' },
  { test: (x) => x.endsWith('Shape2D') || x.endsWith('Shape3D'), name: '碰撞形状' },
  { test: (x) => x === 'Project', name: '工程' },
  { test: (x) => x === 'Resource', name: '资源' }
]

/**
 * 获取资产类名的中文翻译
 * @param className Godot 的资源 / 节点类名
 * @returns 中文名称，如果没有匹配则返回原始类名
 */
export function getAssetClassNameCn(className?: string): string {
  const s = String(className || '')
  try {
    if (!s) return '资产'
    const matched = CLASS_MAPPING.find((item) => item.test(s))
    return matched ? matched.name : s
  } catch {
    return '资产'
  }
}

/**
 * 获取资产类别的颜色
 * @param className Godot 的资源 / 节点类名
 * @returns 颜色值（CSS 格式）
 */
export function getAssetClassColor(className?: string): string {
  const s = String(className || '')
  if (!s) return '#888888'

  if (s === 'PackedScene') return '#ff7e00'
  if (s.startsWith('GDScript')) return '#3651d3'
  if (s.includes('Shader') && !s.includes('Material')) return '#5288c7'
  if (s.includes('Material')) return '#497C6E'
  if (s === 'SpriteFrames' || s.startsWith('Animation')) return '#3abe45'
  if (s.includes('Texture')) return '#c04040'
  if (s.startsWith('AudioStream')) return '#9b59b6'
  if (s === 'Model3D' || s.endsWith('Mesh')) return 'rgba(0,255,255,0.8)'
  if (s === 'TileSet') return '#27ae60'
  if (s === 'Theme' || s.includes('Font')) return '#f1a3f1'
  if (s.startsWith('Curve') || s === 'Gradient') return '#f39c12'

  return '#888888'
}
