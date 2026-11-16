/** 「导入本机工程」弹窗的列表：Godot 项目管理器里记着的工程 */
export interface GodotRecentProjectItem {
  projectPath: string
  projectName: string
  /** project.godot 里 config/features 的版本号，读不到是空串 */
  engineVersion: string
  lastOpenTime: string
  isImported: boolean
  /** config/icon 换成磁盘路径 */
  thumbnailPath?: string
}
