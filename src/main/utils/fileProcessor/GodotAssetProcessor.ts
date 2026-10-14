/**
 * Godot 资源的元数据解析。
 *
 * 虚幻盒子那边对应的是 `.uasset` 二进制解析；Godot 的场景（`.tscn`）和资源（`.tres`）
 * 是文本，类型和依赖都写在文件头里，读一遍就有：
 *
 * - 场景的类型 = 根节点的类型（`[node name="Player" type="CharacterBody2D"]`）
 * - 资源的类型 = `[gd_resource type="SpriteFrames" ...]`
 * - 依赖 = 所有 `[ext_resource path="res://..."]`
 *
 * 资源在库里的「软路径」用 `res://` 路径：从文件往上找最近的 `project.godot`，
 * 相对它算出来。找不到工程（单独拖进来的文件）就只用文件名。
 */

import { promises as fs } from 'fs'
import { basename, dirname, extname, join, relative } from 'path'
import { v4 as uuidv4 } from 'uuid'

import { parseProjectFile } from '../../godot/projectFile'
import { parseScene, unquote } from '../../godot/tscn'
import { projectThumbnailCandidates } from '../projectPath'
import { PathManager } from '../PathManager'
import { BaseFileProcessor, type FileMetadata } from './BaseFileProcessor'

/** 按扩展名认出来的 Godot 资源类型。文本格式之外的文件靠它分组 */
const TYPE_BY_EXTENSION: Record<string, string> = {
  tscn: 'PackedScene',
  scn: 'PackedScene',
  tres: 'Resource',
  res: 'Resource',
  gd: 'GDScript',
  gdshader: 'Shader',
  gdshaderinc: 'ShaderInclude',
  godot: 'Project',
  png: 'Texture2D',
  jpg: 'Texture2D',
  jpeg: 'Texture2D',
  webp: 'Texture2D',
  svg: 'Texture2D',
  bmp: 'Texture2D',
  tga: 'Texture2D',
  exr: 'Texture2D',
  hdr: 'Texture2D',
  wav: 'AudioStreamWAV',
  ogg: 'AudioStreamOggVorbis',
  mp3: 'AudioStreamMP3',
  glb: 'Model3D',
  gltf: 'Model3D',
  fbx: 'Model3D',
  obj: 'Model3D',
  blend: 'Model3D',
  ttf: 'FontFile',
  otf: 'FontFile',
  woff: 'FontFile',
  woff2: 'FontFile'
}

/** 认得出类型、值得解析的文本格式 */
const TEXT_FORMATS = new Set(['tscn', 'tres', 'gd', 'gdshader', 'godot'])

export interface GodotProjectMeta extends Partial<FileMetadata> {
  name: string
  engineVersion?: string
  description?: string
  imgLocalPath: string
  assetKey: string
  originPath: string
  classKey: 'godot'
  status: 'main'
}

/** 从文件往上找最近的 `project.godot` 所在目录，最多找 12 层 */
export async function findProjectRoot(filePath: string): Promise<string | undefined> {
  let dir = dirname(filePath)
  for (let i = 0; i < 12; i++) {
    const exists = await fs
      .access(join(dir, 'project.godot'))
      .then(() => true)
      .catch(() => false)
    if (exists) return dir
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
  return undefined
}

export function toResPath(projectRoot: string | undefined, filePath: string): string {
  if (!projectRoot) return `res://${basename(filePath)}`
  return 'res://' + relative(projectRoot, filePath).replace(/\\/g, '/')
}

/** 场景的根节点类型 / 资源的 type 属性。实例化别的场景的根节点没有 type，就记成 PackedScene */
export function godotClassOf(ext: string, text: string): string {
  if (ext === 'tscn') {
    const root = parseScene(text).nodes.get('.')
    return root?.attrs.type ? unquote(root.attrs.type) : 'PackedScene'
  }
  if (ext === 'tres') {
    const header = /^\[gd_resource\b[^\]]*?\btype="([^"]+)"/m.exec(text)
    return header?.[1] ?? 'Resource'
  }
  if (ext === 'gd') {
    const extendsLine = /^extends\s+([A-Za-z_][\w.]*)/m.exec(text)
    return extendsLine ? `GDScript (${extendsLine[1]})` : 'GDScript'
  }
  return TYPE_BY_EXTENSION[ext] ?? 'Unknown'
}

/** 文本里引用的 `res://` 路径：`ext_resource`、脚本里的 preload / load */
export function godotReferences(ext: string, text: string, self: string): string[] {
  const found = new Set<string>()
  if (ext === 'tscn' || ext === 'tres') {
    for (const match of text.matchAll(/^\[ext_resource\b[^\]]*?\bpath="(res:\/\/[^"]+)"/gm)) {
      found.add(match[1])
    }
  } else if (ext === 'gd' || ext === 'gdshader') {
    for (const match of text.matchAll(/"(res:\/\/[^"]+)"/g)) found.add(match[1])
  }
  found.delete(self)
  return [...found]
}

export class GodotAssetProcessor extends BaseFileProcessor {
  private pathManager = PathManager.getInstance()

  getSupportedExtensions(): string[] {
    return Object.keys(TYPE_BY_EXTENSION)
  }

  async processFile(filePath: string): Promise<FileMetadata> {
    const basicInfo = await this.getBasicFileInfo(filePath)
    const ext = basicInfo.fileExtension ?? ''

    if (basename(filePath).toLowerCase() === 'project.godot') {
      return (await this.processProject(filePath)) as FileMetadata
    }

    const projectRoot = await findProjectRoot(filePath)
    const softPath = toResPath(projectRoot, filePath)
    let className = TYPE_BY_EXTENSION[ext] ?? 'Unknown'
    let imports: string[] = []

    if (TEXT_FORMATS.has(ext)) {
      try {
        const text = await fs.readFile(filePath, 'utf8')
        className = godotClassOf(ext, text)
        imports = godotReferences(ext, text, softPath)
      } catch (error) {
        console.warn(`[GodotAssetProcessor] 读取失败 ${filePath}:`, error)
      }
    }

    return {
      ...basicInfo,
      processorType: 'GodotAsset',
      assetType: className,
      metadata: {
        assetKey: uuidv4(),
        classKey: ext,
        name: basename(filePath, extname(filePath)),
        originPath: filePath,
        ext,
        softPath,
        assetClass: TYPE_BY_EXTENSION[ext] ?? 'Unknown',
        className,
        imports,
        importsStrong: imports,
        importsSoft: [],
        size: basicInfo.fileSize ?? 0,
        imgLocalPath: ''
      }
    } as FileMetadata
  }

  /** 读一个 `project.godot`：名字、版本、描述、图标 */
  async processProject(
    filePath: string,
    options?: { includeThumbnail?: boolean }
  ): Promise<GodotProjectMeta> {
    const text = await fs.readFile(filePath, 'utf8')
    const summary = parseProjectFile(text)
    const description = /^config\/description="((?:[^"\\]|\\.)*)"/m.exec(text)?.[1]
    const basicInfo = await this.getBasicFileInfo(filePath)
    const projectDir = dirname(filePath)

    return {
      ...basicInfo,
      processorType: 'GodotAsset',
      assetType: 'Project',
      name: summary.name || basename(projectDir),
      engineVersion: summary.engineVersion,
      description,
      imgLocalPath:
        options?.includeThumbnail === false ? '' : await this.copyProjectThumbnail(projectDir),
      assetKey: uuidv4(),
      originPath: filePath,
      classKey: 'godot',
      status: 'main',
      metadata: { engineVersion: summary.engineVersion, description, icon: summary.icon }
    }
  }

  private async copyProjectThumbnail(projectDir: string): Promise<string> {
    for (const candidate of projectThumbnailCandidates(projectDir)) {
      try {
        await fs.access(candidate)
        const fileName = `thumbnail-${uuidv4()}${extname(candidate)}`
        await fs.copyFile(candidate, this.pathManager.getPublicThumbnailFilePath(fileName))
        return fileName
      } catch {
        // 下一个候选
      }
    }
    return ''
  }

  /** 找出一个目录下所有的 Godot 工程（`project.godot`） */
  async findAllProjects(startPath: string): Promise<string[]> {
    const results = new Set<string>()
    const IGNORE_DIRS = new Set(['node_modules', '.git', '.svn', '.hg', '.cache', '.godot', '.import'])
    const MAX_DEPTH = 6

    const traverse = async (currentDir: string, depth: number): Promise<void> => {
      if (depth > MAX_DEPTH) return
      const entries = await fs.readdir(currentDir, { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        const fullPath = join(currentDir, entry.name)
        if (entry.isDirectory()) {
          if (!IGNORE_DIRS.has(entry.name)) await traverse(fullPath, depth + 1)
        } else if (entry.isFile() && entry.name.toLowerCase() === 'project.godot') {
          results.add(fullPath)
        }
      }
    }

    try {
      const startStat = await fs.stat(startPath)
      if (startStat.isFile() && basename(startPath).toLowerCase() === 'project.godot') {
        results.add(startPath)
      } else if (startStat.isDirectory()) {
        await traverse(startPath, 0)
      }
    } catch (error) {
      console.warn(`无法访问路径 ${startPath}:`, error)
    }
    return [...results]
  }
}
