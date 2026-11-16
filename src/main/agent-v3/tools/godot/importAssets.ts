/**
 * import_to_project：把素材库里（或磁盘上任意位置）的文件放进 Godot 工程。
 *
 * Godot 没有「导入」这一步要盒子代劳：文件放进工程目录，编辑器下次扫描就自动导入。
 * 这个工具做的是放的那一下要做对的几件事：
 *
 * - 连同 `.import` / `.uid` 旁挂文件一起拷（见 `godot/copyAsset.ts`），uid 和导入设置不丢；
 * - 目标已有同名文件时不覆盖，除非明确要求 —— 覆盖掉用户调过的贴图是撤不回来的；
 * - 场景和资源（`.tscn` / `.tres`）引用的 `res://` 依赖，如果在目标工程里不存在，
 *   当场说出来。依赖是相对**源工程**写的，拷过去多半要么一起拷、要么改引用。
 * - 编辑器连着的话让它重扫一遍文件系统，新文件马上出现在文件系统面板里。
 */

import { existsSync, promises as fs, statSync } from 'fs'
import { basename, join } from 'path'
import { z } from 'zod'

import { defineTool, type UnrealAgentTool } from '../defineTool'
import { copyGodotAsset } from '../../../godot/copyAsset'
import { godotReferences } from '../../../utils/fileProcessor/GodotAssetProcessor'
import { resolveProjectDir } from './project'

/** `res://a/b` → 工程目录下的磁盘路径；不是 `res://` 开头的拒绝 */
function resToDisk(projectDir: string, resPath: string): string {
  if (!/^res:\/\//.test(resPath)) throw new Error(`目标必须是 res:// 路径：${resPath}`)
  const relative = resPath.slice('res://'.length).replace(/^\/+/, '')
  if (relative.split(/[\\/]/).includes('..')) throw new Error(`目标路径不许带 ..：${resPath}`)
  if (/^\.godot([\\/]|$)/.test(relative)) throw new Error('不能放进 .godot/，那是编辑器缓存')
  return join(projectDir, relative)
}

export function createImportToProjectTool(): UnrealAgentTool<unknown> {
  return defineTool({
    name: 'import_to_project',
    namespace: 'godot',
    risk: 'mutating',
    concurrency: 'sequential',
    description:
      '把文件放进 Godot 工程（素材库资产用 search_assets 返回的 real_path）。连同 .import / .uid 旁挂文件一起拷，' +
      '同名文件默认不覆盖；场景和资源引用的依赖在目标工程里不存在时会列出来。Godot 编辑器会自动导入放进来的文件。',
    input: z.object({
      project_path: z
        .string()
        .optional()
        .describe('Godot 工程目录（含 project.godot）。不给就用这条对话绑定的工程'),
      files: z.array(z.string()).min(1).max(200).describe('源文件的绝对路径'),
      destination: z
        .string()
        .optional()
        .describe('放到工程里的哪个目录，res:// 路径。默认 res://assets/library'),
      overwrite: z.boolean().optional().describe('目标已有同名文件时覆盖。默认 false')
    }),
    async execute(args, { signal }) {
      const projectDir = resolveProjectDir(args.project_path)
      const destRes = (args.destination ?? 'res://assets/library').replace(/\/+$/, '')
      const destDir = resToDisk(projectDir, destRes)
      await fs.mkdir(destDir, { recursive: true })

      const imported: string[] = []
      const skipped: string[] = []
      const failed: string[] = []
      const missingDeps = new Map<string, string[]>()

      for (const source of args.files) {
        if (signal?.aborted) break
        const name = basename(source)
        const target = join(destDir, name)
        const targetRes = `${destRes}/${name}`
        try {
          if (!existsSync(source) || !statSync(source).isFile()) {
            failed.push(`${source}：源文件不存在`)
            continue
          }
          if (existsSync(target) && !args.overwrite) {
            skipped.push(targetRes)
            continue
          }
          if (args.overwrite) await fs.rm(target, { force: true })
          await copyGodotAsset(source, target)
          imported.push(targetRes)

          const ext = name.split('.').pop()?.toLowerCase() ?? ''
          if (ext === 'tscn' || ext === 'tres') {
            const text = await fs.readFile(target, 'utf8')
            const missing = godotReferences(ext, text, targetRes).filter(
              (dep) => !existsSync(join(projectDir, dep.slice('res://'.length)))
            )
            if (missing.length) missingDeps.set(targetRes, missing)
          }
        } catch (error) {
          failed.push(`${source}：${(error as Error).message}`)
        }
      }

      // 编辑器连着就让它重扫，新文件当场出现；没连就等它下次打开时自己扫
      if (imported.length) {
        try {
          const { callEditor } = await import('../editorRpc')
          await callEditor('editor.rescan', {}, { timeoutMs: 5_000 })
        } catch {
          // 没连编辑器不算失败
        }
      }

      const lines = [
        `${imported.length} 个文件已放进工程` +
          (skipped.length ? `，${skipped.length} 个同名已存在未覆盖` : '') +
          (failed.length ? `，${failed.length} 个失败` : '') +
          '。'
      ]
      if (imported.length) lines.push(...imported.map((p) => `- ${p}`))
      if (skipped.length)
        lines.push(
          '',
          '同名已存在（要覆盖就带 overwrite: true）：',
          ...skipped.map((p) => `- ${p}`)
        )
      if (failed.length) lines.push('', '失败：', ...failed.map((p) => `- ${p}`))
      if (missingDeps.size) {
        lines.push('', '这些场景 / 资源引用的依赖在工程里不存在，要么一起拷进来，要么改引用：')
        for (const [file, deps] of missingDeps) lines.push(`- ${file}：${deps.join('、')}`)
      }
      return {
        text: lines.join('\n'),
        details: {
          imported,
          skipped,
          failed,
          missingDependencies: Object.fromEntries(missingDeps)
        },
        ...(imported.length === 0 && failed.length > 0 ? { isError: true } : {})
      }
    }
  })
}
