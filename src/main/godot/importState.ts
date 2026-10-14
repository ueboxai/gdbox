import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runGodot, type RunResult } from './run'

/**
 * 运行或截图之前，资源得是导入过的：没导入的贴图加载不出来，截图里只剩代码画的东西。
 *
 * 新拖进来的工程、gen_* 刚写进去的图和声音都还没导入。这里比较工程里最新的文件和上次导入的时间，
 * 有更新的才跑一次 --import（Godot 本身是增量导入，但启动一次也要一两秒，能省就省）。
 */

const MARKER = 'gdbox-last-import'
const SKIP = new Set(['.godot', '.gdbox', '.git', 'node_modules'])

function newestMtime(dir: string, limit = { files: 20000 }): number {
  let newest = 0
  const walk = (d: string): void => {
    let names: string[]
    try {
      names = readdirSync(d)
    } catch {
      return
    }
    for (const name of names) {
      if (SKIP.has(name) || limit.files-- <= 0) continue
      const abs = join(d, name)
      try {
        const st = statSync(abs)
        if (st.isDirectory()) {
          if (!existsSync(join(abs, '.gdignore'))) walk(abs)
        } else if (st.mtimeMs > newest) newest = st.mtimeMs
      } catch {
        // 文件刚被删：跳过
      }
    }
  }
  walk(dir)
  return newest
}

export function needsImport(projectDir: string): boolean {
  const marker = join(projectDir, '.godot', MARKER)
  if (!existsSync(marker)) return true
  return newestMtime(projectDir) > statSync(marker).mtimeMs
}

/**
 * 记下「导入完成」的时间。用完成时间而不是开始时间：导入本身会在工程里写 .import / .uid 文件，
 * 用开始时间的话这些文件永远比标记新，每次都会重新导入。
 */
export function markImported(projectDir: string): void {
  const dir = join(projectDir, '.godot')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, MARKER), '')
}

/** 需要时导入一次；返回导入结果（没导入返回 null）。 */
export async function ensureImported(godotPath: string, projectDir: string, signal?: AbortSignal): Promise<RunResult | null> {
  if (!needsImport(projectDir)) return null
  const result = await runGodot(godotPath, ['--headless', '--path', projectDir, '--import'], { timeoutMs: 180_000, signal })
  if (!result.timedOut && result.code === 0) markImported(projectDir)
  return result
}
