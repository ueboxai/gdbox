import { existsSync, mkdirSync, readdirSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runGodot, type RunResult } from './run'

/**
 * 运行或截图之前，资源得是导入过的：没导入的贴图加载不出来，截图里只剩代码画的东西。
 *
 * 新拖进来的工程、gen_* 刚写进去的图和声音都还没导入。这里比较工程里最新的文件和上次导入的时间，
 * 有更新的才跑一次 --import（Godot 本身是增量导入，但启动一次也要一两秒，能省就省）。
 *
 * ## 标记记的是导入**开始**的时刻
 *
 * 工作室模式下队员并行干活：A 的导入跑到一半，B 写进来一张新图。标记要是记完成时刻，
 * 那张图的修改时间比标记早，就再也不会被导入 —— 试玩时报「资源不存在」，可文件明明就在
 * （2026-10-15 真机：bomb.png）。记开始时刻就不会漏；导入自己写的 `.import` / `.uid`
 * 旁挂文件不算「工程里有新东西」，不然每次都会重新导入。
 *
 * 同一个工程的导入排队跑：两个无头 Godot 同时往 `.godot/imported` 里写会互相踩。
 */

const MARKER = 'gdbox-last-import'
const SKIP = new Set(['.godot', '.gdbox', '.git', 'node_modules'])
/** 导入自己产出的旁挂文件 */
const SIDECAR = /\.(import|uid)$/i

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
      if (SKIP.has(name) || SIDECAR.test(name) || limit.files-- <= 0) continue
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

/** 记下「导入是从这一刻开始的、此刻之前的改动都导进去了」 */
export function markImported(projectDir: string, startedAt: number = Date.now()): void {
  const dir = join(projectDir, '.godot')
  mkdirSync(dir, { recursive: true })
  const marker = join(dir, MARKER)
  writeFileSync(marker, '')
  const at = new Date(startedAt)
  utimesSync(marker, at, at)
}

/** 大贴图压缩导入很慢，第一次导入几分钟是正常的 */
export const IMPORT_TIMEOUT_MS = 600_000

/**
 * 导入没跑完就抛错。没导入的贴图截出来是空的，拿它当画面去判断只会得出错的结论。
 * 没超时的失败不拦：导入报错常常只是个别资源，画面大体还能看。
 */
export function assertImportFinished(result: RunResult | null): void {
  if (!result?.timedOut) return
  throw new Error(
    `Asset import did not finish within ${IMPORT_TIMEOUT_MS / 1000} s, so textures and models are not imported yet ` +
      'and a rendered frame would be missing them. Large or many textures make import slow; ' +
      'check .import settings (size limits, compression) or try again — finished files are kept.'
  )
}

/** 每个工程一条队尾 */
const queues = new Map<string, Promise<unknown>>()

function serialized<T>(projectDir: string, work: () => Promise<T>): Promise<T> {
  const key = projectDir.replace(/\\/g, '/').toLowerCase()
  const next = (queues.get(key) ?? Promise.resolve()).then(work, work)
  const tail = next.catch(() => undefined)
  queues.set(key, tail)
  void tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key)
  })
  return next
}

/** 跑一次导入（不管需不需要），成功就记标记。同一个工程排队 */
export function runImport(
  godotPath: string,
  projectDir: string,
  signal?: AbortSignal
): Promise<RunResult> {
  return serialized(projectDir, async () => {
    const startedAt = Date.now()
    const result = await runGodot(godotPath, ['--headless', '--path', projectDir, '--import'], {
      timeoutMs: IMPORT_TIMEOUT_MS,
      signal
    })
    if (!result.timedOut && result.code === 0) markImported(projectDir, startedAt)
    return result
  })
}

/** 需要时导入一次；返回导入结果（没导入返回 null）。 */
export function ensureImported(
  godotPath: string,
  projectDir: string,
  signal?: AbortSignal
): Promise<RunResult | null> {
  // 排上队之后再判断：前面那位可能刚好已经导完了
  return serialized(projectDir, async () => {
    if (!needsImport(projectDir)) return null
    const startedAt = Date.now()
    const result = await runGodot(godotPath, ['--headless', '--path', projectDir, '--import'], {
      timeoutMs: IMPORT_TIMEOUT_MS,
      signal
    })
    if (!result.timedOut && result.code === 0) markImported(projectDir, startedAt)
    return result
  })
}
