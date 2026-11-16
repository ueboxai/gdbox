import { ROOT_FOLDER_KEY } from '../data/AssetLibrarySource'

/**
 * 根文件夹在数据里叫 'ALL'（键和名字都是），界面上显示成本地化的「全部」。
 * 只改显示，不改数据：用户建不了叫 ALL 的文件夹（新建 / 重命名都拦着），按名字认不会误伤。
 */
export function displayFolderName(name: string | null | undefined, allLabel: string): string {
  const value = String(name ?? '')
  return value === ROOT_FOLDER_KEY ? allLabel : value
}

/** 文件夹路径的显示形式：根目录段 'ALL' 换成「全部」，例如 `/ALL/贴图` → `/全部/贴图` */
export function displayFolderPath(path: string | null | undefined, allLabel: string): string {
  return String(path ?? '')
    .split('/')
    .map((segment) => displayFolderName(segment, allLabel))
    .join('/')
}
