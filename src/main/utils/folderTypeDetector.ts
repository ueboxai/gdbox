import { promises as fs } from 'fs'
import { join } from 'path'

/**
 * 文件夹类型枚举
 */
export enum FolderType {
  NORMAL = 'normal',
  /** Godot 插件（addons/ 下带 plugin.cfg 的那一层） */
  PLUGIN = 'plugin',
  /** Godot 工程（带 project.godot） */
  PROJECT = 'project'
}

const PROJECT_FILE = 'project.godot'
const PLUGIN_FILE = 'plugin.cfg'

async function listNames(folderPath: string): Promise<string[] | undefined> {
  try {
    const stats = await fs.stat(folderPath)
    if (!stats.isDirectory()) return undefined
    return (await fs.readdir(folderPath)).map((name) => name.toLowerCase())
  } catch {
    return undefined
  }
}

/** plugin.cfg 里的 `key="value"` */
function readCfgString(text: string, key: string): string | undefined {
  return new RegExp(`^${key}="((?:[^"\\\\]|\\\\.)*)"`, 'm').exec(text)?.[1]
}

/**
 * 文件夹类型检测器：认出 Godot 工程和 Godot 插件文件夹
 */
export class FolderTypeDetector {
  static async detectFolderType(folderPath: string): Promise<FolderType> {
    return (await this.detectFolderTypeWithIcon(folderPath)).type
  }

  /**
   * 检测文件夹类型并取图标：工程用 project.godot 里配的图标，
   * 插件用 plugin.cfg 同目录下的 icon.png / icon.svg
   */
  static async detectFolderTypeWithIcon(
    folderPath: string
  ): Promise<{ type: FolderType; iconPath?: string }> {
    const names = await listNames(folderPath)
    if (!names) return { type: FolderType.NORMAL }
    if (names.includes(PROJECT_FILE)) return { type: FolderType.PROJECT }
    if (names.includes(PLUGIN_FILE)) {
      return { type: FolderType.PLUGIN, iconPath: await this.getPluginIconPath(folderPath) }
    }
    return { type: FolderType.NORMAL }
  }

  /** 插件图标路径，没有就是 undefined */
  static async getPluginIconPath(pluginFolderPath: string): Promise<string | undefined> {
    for (const candidate of ['icon.png', 'icon.svg', 'icon.jpg', 'Icon.png']) {
      const iconPath = join(pluginFolderPath, candidate)
      try {
        await fs.access(iconPath)
        return iconPath
      } catch {
        // 下一个
      }
    }
    return undefined
  }

  static async detectMultipleFolderTypes(folderPaths: string[]): Promise<Map<string, FolderType>> {
    const results = new Map<string, FolderType>()
    await Promise.all(
      folderPaths.map(async (path) => results.set(path, await this.detectFolderType(path)))
    )
    return results
  }

  /** 插件版本（plugin.cfg 的 version）。Godot 插件不声明引擎版本 */
  static async getPluginVersion(
    pluginFolderPath: string
  ): Promise<{ versionName?: string; engineVersion?: string } | undefined> {
    try {
      const text = await fs.readFile(join(pluginFolderPath, PLUGIN_FILE), 'utf8')
      const versionName = readCfgString(text, 'version')
      return versionName ? { versionName } : undefined
    } catch {
      return undefined
    }
  }

  static async validateProjectFolder(folderPath: string): Promise<boolean> {
    return (await listNames(folderPath))?.includes(PROJECT_FILE) ?? false
  }

  static async validatePluginFolder(folderPath: string): Promise<boolean> {
    return (await listNames(folderPath))?.includes(PLUGIN_FILE) ?? false
  }
}
