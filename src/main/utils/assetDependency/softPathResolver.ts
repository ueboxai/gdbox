/**
 * `res://` 路径和磁盘路径之间的换算。
 *
 * Godot 的依赖是 `res://` 路径，相对的是工程根目录（`project.godot` 所在的那层）。
 * 所以给一个资源在磁盘上的位置，往上找到工程根就能把它的依赖换成磁盘路径；
 * 反过来，从磁盘路径也能算出它在工程里的 `res://` 路径。
 */
import { existsSync } from 'fs'
import path from 'path'

/** 从文件往上找最近的 `project.godot` 所在目录，最多找 12 层 */
export function findProjectRootSync(filePath: string): string | undefined {
  let dir = path.dirname(filePath)
  for (let i = 0; i < 12; i++) {
    if (existsSync(path.join(dir, 'project.godot'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
  return undefined
}

/** 历史接口：虚幻版在这里修 GBK 乱码。Godot 的文本都是 UTF-8，原样返回 */
export const fixChineseEncoding = (text: unknown): string => String(text ?? '')

/** 磁盘路径 → `res://` 路径。不在任何工程里就返回空串 */
export const deriveSoftPathFromRealPath = (realPath: string): string => {
  const root = findProjectRootSync(realPath)
  if (!root) return ''
  return 'res://' + path.relative(root, realPath).replace(/\\/g, '/')
}

export const projectContentSoftPath = deriveSoftPathFromRealPath

/** 资源所在的工程根目录；不在工程里就是它自己的目录 */
export const derivePackRoot = (realPath: string): string =>
  findProjectRootSync(realPath) ?? path.dirname(realPath)

export interface SoftPathResolverOptions {
  enableCache?: boolean
  isCancelled?: () => boolean
}

export class SoftPathResolver {
  private readonly cache = new Map<string, string | null>()
  private readonly enableCache: boolean

  constructor(options: SoftPathResolverOptions = {}) {
    this.enableCache = options.enableCache ?? true
  }

  /**
   * 把主资源引用的 `res://` 路径换成磁盘路径。文件不在就返回 null。
   *
   * @param _mainSoftPath 主资源的 `res://` 路径（换算用不上，保留是为了接口和调用方对齐）
   * @param subSoftPath 被引用的 `res://` 路径
   * @param mainRealPath 主资源在磁盘上的位置
   */
  async resolve(
    _mainSoftPath: string,
    subSoftPath: string,
    mainRealPath: string
  ): Promise<string | null> {
    if (!subSoftPath.startsWith('res://')) return null
    const root = derivePackRoot(mainRealPath)
    const key = `${root}|${subSoftPath}`
    if (this.enableCache && this.cache.has(key)) return this.cache.get(key)!
    const candidate = path.join(root, subSoftPath.slice('res://'.length))
    const resolved = existsSync(candidate) ? candidate : null
    if (this.enableCache) this.cache.set(key, resolved)
    return resolved
  }

  clear(): void {
    this.cache.clear()
  }

  get size(): number {
    return this.cache.size
  }

  /** 历史接口：虚幻版找不到依赖时会扫盘，这里不扫 */
  get remainingScanBudget(): number {
    return Number.POSITIVE_INFINITY
  }
}
