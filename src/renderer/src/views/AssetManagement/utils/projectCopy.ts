/**
 * 「导入到项目」：把资产库里的文件按原名复制进用户选的项目文件夹。
 *
 * Godot 项目就是一个普通文件夹，编辑器会自己扫描 `res://` 下的新文件，
 * 所以这里不需要任何引擎侧的导入接口 —— 复制就是导入。
 * 同名文件跳过不覆盖：项目里的文件可能已经被改过，覆盖会悄悄丢掉用户的改动。
 *
 * 源文件旁边的 `.import`（导入设置 + uid）和 `.uid`（脚本、着色器）跟着一起拷，
 * 和 agent 的 `import_to_project`（`main/godot/copyAsset.ts`）一致；
 * 只拷主文件的话导入设置丢了、uid 变了，引用它的场景会找不到资源。
 */

/** 主文件复制成功后再拷的旁挂文件 */
const SIDECARS = ['.import', '.uid']

export interface ProjectCopySourceItem {
  type?: string
  id?: string | number
  folderKey?: string
  key?: string
  name?: string
  title?: string
  folderName?: string
  assetName?: string
  filePath?: string
  originPath?: string
  children?: ProjectCopySourceItem[]
}

export interface ProjectCopyEntry {
  /** 源文件的绝对路径 */
  src: string
  /** 相对目标文件夹的路径（文件夹来源时带上文件夹名） */
  rel: string
}

export interface ProjectCopyResult {
  copied: number
  skipped: number
  failed: number
}

type FolderAsset = { filePath?: string; originPath?: string; assetName?: string }

const isAbsolute = (p: string): boolean =>
  /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\') || p.startsWith('/')

const basename = (p: string): string => p.replace(/\\/g, '/').split('/').pop() || ''

export const joinPath = (...parts: string[]): string =>
  parts
    .filter(Boolean)
    .join('/')
    .replace(/\\/g, '/')
    .replace(/(?<!^)\/+/g, '/')

/** 资产记录里的路径可能是相对保管库根目录的，统一成绝对路径 */
export function resolveAssetFile(asset: FolderAsset, vaultPath: string): string {
  const raw = String(asset.originPath || asset.filePath || '').trim()
  if (!raw) return ''
  if (isAbsolute(raw) || !vaultPath) return raw
  return joinPath(vaultPath, raw)
}

/** 把右键来源（单个资产 / 文件夹 / 多选）展开成要复制的文件清单 */
export async function collectProjectCopyEntries(
  source: ProjectCopySourceItem,
  vaultPath: string,
  listFolder: (folderKey: string) => Promise<FolderAsset[]>
): Promise<ProjectCopyEntry[]> {
  const items = source.type === 'batch' ? source.children || [] : [source]
  const entries: ProjectCopyEntry[] = []
  for (const item of items) {
    if (!item) continue
    if (item.type === 'folder') {
      const folderKey = String(item.folderKey || item.id || item.key || '')
      if (!folderKey) continue
      const folderName = String(item.name || item.title || item.folderName || '')
      for (const asset of await listFolder(folderKey)) {
        const src = resolveAssetFile(asset, vaultPath)
        if (src) entries.push({ src, rel: joinPath(folderName, basename(src)) })
      }
      continue
    }
    const src = resolveAssetFile(item, vaultPath)
    if (src) entries.push({ src, rel: basename(src) })
  }
  return entries
}

/** 逐个复制；一个失败不影响其余 */
export async function copyEntriesToFolder(
  entries: ProjectCopyEntry[],
  targetDir: string,
  io: {
    exists: (path: string) => Promise<boolean>
    copy: (src: string, dest: string) => Promise<void>
  }
): Promise<ProjectCopyResult> {
  const result: ProjectCopyResult = { copied: 0, skipped: 0, failed: 0 }
  for (const entry of entries) {
    const dest = joinPath(targetDir, entry.rel)
    try {
      if (await io.exists(dest)) {
        result.skipped++
        continue
      }
      await io.copy(entry.src, dest)
      for (const suffix of SIDECARS) {
        if ((await io.exists(entry.src + suffix)) && !(await io.exists(dest + suffix)))
          await io.copy(entry.src + suffix, dest + suffix)
      }
      result.copied++
    } catch (error) {
      console.error('[ProjectCopy] 复制失败:', entry.src, error)
      result.failed++
    }
  }
  return result
}
