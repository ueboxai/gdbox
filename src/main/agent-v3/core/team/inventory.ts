/**
 * 工程里到底有什么 —— 直接数磁盘上的工程目录。
 *
 * ## 为什么数磁盘，不问编辑器
 *
 * 虚幻盒子 2026-09-26 的真机反馈：制作人一天里拿到三个版本的「现状」—— 自己搜出来的、
 * 队员说的、另一个队员说的各不一样。连接状态、编辑器缓存、时序都会让「问编辑器」和
 * 「问队友」对不上。磁盘是唯一不看视角的真相：存下来的就在，没存的就不在；
 * 编辑器没开也照样数得出来。
 *
 * 分类按扩展名。`.import` / `.uid` 是旁挂文件，编辑器缓存 `.godot/`、盒子数据 `.gdbox/`、
 * 我们自己的插件 `addons/gdbox_link` 都不算工程内容。这是给人和模型看的概况，不是资产审计。
 */

import { promises as fs } from 'fs'
import { join, relative } from 'path'

export interface InventoryItem {
  /** `res://` 路径 */
  path: string
  category: string
  modifiedAt: number
}

export interface Inventory {
  total: number
  counts: Record<string, number>
  /** 最近改过的，新的在前 */
  recent: InventoryItem[]
  /** 数到上限就停了，total 是下限 */
  truncated: boolean
}

const CATEGORIES: Array<[RegExp, string]> = [
  [/\.(tscn|scn)$/i, '场景'],
  [/\.(gd|cs)$/i, '脚本'],
  [/\.(gdshader|gdshaderinc|shader)$/i, '着色器'],
  [/\.(tres|res)$/i, '资源'],
  [/\.(png|jpe?g|webp|svg|bmp|tga|exr|hdr)$/i, '图片'],
  [/\.(wav|ogg|mp3)$/i, '音频'],
  [/\.(glb|gltf|fbx|obj|blend|dae)$/i, '模型'],
  [/\.(ttf|otf|woff2?|fnt)$/i, '字体'],
  [/\.(json|cfg|csv|txt|md)$/i, '数据']
]

export function categorize(fileName: string): string {
  for (const [pattern, category] of CATEGORIES) if (pattern.test(fileName)) return category
  return '其他'
}

/** 不是工程内容的文件：旁挂、工程配置本身、系统垃圾 */
const SKIP_FILE = /\.(import|uid)$|^project\.godot$|^export_presets\.cfg$|^\.|^Thumbs\.db$|^desktop\.ini$/i

/** 不往里走的目录（相对工程根，正斜杠） */
const SKIP_DIR = /^(\.godot|\.gdbox|\.git|\.import|addons\/gdbox_link)$/i

/** 最多数这么多个文件。再大的工程，概况也不需要逐个列 */
const MAX_FILES = 20_000

export async function contentInventory(projectDir: string, recentCount = 10): Promise<Inventory> {
  const items: InventoryItem[] = []
  let truncated = false

  const walk = async (dir: string): Promise<void> => {
    if (truncated) return
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (items.length >= MAX_FILES) {
        truncated = true
        return
      }
      const full = join(dir, entry.name)
      const rel = relative(projectDir, full).replace(/\\/g, '/')
      if (entry.isDirectory()) {
        if (SKIP_DIR.test(rel) || entry.name.startsWith('.')) continue
        // 带 .gdignore 的目录 Godot 自己也不导入
        if (await fs.access(join(full, '.gdignore')).then(() => true, () => false)) continue
        await walk(full)
      } else if (!SKIP_FILE.test(entry.name)) {
        const stat = await fs.stat(full).catch(() => null)
        items.push({
          path: `res://${rel}`,
          category: categorize(entry.name),
          modifiedAt: stat?.mtimeMs ?? 0
        })
      }
    }
  }
  await walk(projectDir)

  const counts: Record<string, number> = {}
  for (const item of items) counts[item.category] = (counts[item.category] ?? 0) + 1
  return {
    total: items.length,
    counts,
    recent: [...items].sort((a, b) => b.modifiedAt - a.modifiedAt).slice(0, recentCount),
    truncated
  }
}

/** 一行概况：「共 39 · 脚本 12 · 场景 8 · 图片 8 · 音频 3」。数量多的在前 */
export function formatCounts(inventory: Inventory): string {
  const parts = Object.entries(inventory.counts)
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => `${category} ${count}`)
  return [`共 ${inventory.total}${inventory.truncated ? '+' : ''}`, ...parts].join(' · ')
}
