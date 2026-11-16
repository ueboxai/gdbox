import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'

/**
 * 生成物在工程里的落点和记录。
 *
 * - 产物写进 res://assets/gen/<类别>/，文件名用模型给的可读名字。
 * - 同名重新生成就覆盖：场景里引用的是路径，覆盖后自动用上新版本。旧文件先备份到 .gdbox/history/。
 * - 每次生成在 .gdbox/generations.jsonl 记一行：提示词、服务商、参数、产物。以后做风格包和经验时用。
 * - .gdbox/ 里放 .gdignore，Godot 不会去导入里面的东西。
 */

export type AssetKind = 'sprites' | 'images' | 'sfx' | 'music' | 'voice' | 'models'

export class ProjectAssets {
  constructor(readonly projectDir: string) {}

  private get metaDir(): string {
    return join(this.projectDir, '.gdbox')
  }

  private ensureMeta(): void {
    mkdirSync(this.metaDir, { recursive: true })
    const ignore = join(this.metaDir, '.gdignore')
    if (!existsSync(ignore)) writeFileSync(ignore, '')
  }

  /** .gdbox/ 的绝对路径，顺带确保 .gdignore 在：别的模块放进去的工作文件 Godot 也不会去导入 */
  metaPath(): string {
    this.ensureMeta()
    return this.metaDir
  }

  /** 文件名只留小写字母、数字、下划线，避免 Godot 和各平台的路径问题。 */
  static slug(name: string): string {
    const s = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
    return s || 'asset'
  }

  /** 绝对路径和 res:// 路径。 */
  path(kind: AssetKind, fileName: string): { abs: string; res: string } {
    const abs = join(this.projectDir, 'assets', 'gen', kind, fileName)
    return { abs, res: this.toRes(abs) }
  }

  toRes(abs: string): string {
    return `res://${relative(this.projectDir, abs).split(sep).join('/')}`
  }

  /** 写入产物；已存在就先备份旧的。 */
  write(abs: string, data: Buffer | string): void {
    mkdirSync(dirname(abs), { recursive: true })
    if (existsSync(abs)) {
      this.ensureMeta()
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const backup = join(this.metaDir, 'history', stamp, relative(this.projectDir, abs))
      mkdirSync(dirname(backup), { recursive: true })
      copyFileSync(abs, backup)
    }
    writeFileSync(abs, data)
  }

  /** 服务商返回的原图留一份，以后换参数重新加工不用再花钱生成。 */
  keepRaw(fileName: string, data: Buffer): string {
    this.ensureMeta()
    const abs = join(this.metaDir, 'raw', fileName)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, data)
    return abs
  }

  /** 配音缓存：台词 id → 「接口|模型|音色|文本」。没变的台词不重复合成、不重复花钱。 */
  readVoiceCache(): Record<string, string> {
    try {
      return JSON.parse(readFileSync(join(this.metaDir, 'voice-cache.json'), 'utf8')) as Record<
        string,
        string
      >
    } catch {
      return {}
    }
  }

  writeVoiceCache(cache: Record<string, string>): void {
    this.ensureMeta()
    writeFileSync(join(this.metaDir, 'voice-cache.json'), JSON.stringify(cache, null, 2))
  }

  record(entry: GenerationRecord): void {
    this.ensureMeta()
    appendFileSync(
      join(this.metaDir, 'generations.jsonl'),
      `${JSON.stringify({ time: new Date().toISOString(), ...entry })}\n`
    )
  }
}

export interface GenerationRecord {
  tool: string
  /** 'sfxr' 表示本地合成，不经过服务商 */
  api: string
  model?: string
  prompt?: string
  params?: Record<string, unknown>
  outputs: string[]
}
