/**
 * 用例库和冠军记录的落盘。
 *
 * 放在 `<userData>/regression/<工程键>/`，不放进工程：
 * - 回滚工程碰不到它们（锁定的用例只增不减，冠军一直都在）；
 * - 这个目录在 `pathBoundary.ts` 的写保护名单里，模型的文件工具读得到、写不进。
 *   命令类工具理论上能绕过去，所以每次读用例都核对一遍盒子自己记下的指纹，
 *   被改过的当场报出来（`tampered`）。
 */

import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import { join } from 'path'

import { projectPathKey } from '../projectPathKey'
import type { CaseStatus, ChampionEntry, ChampionRecord, RegressionCase } from './types'

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  const tmp = `${file}.tmp`
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8')
  await fs.rename(tmp, file)
}

/** 工程 → 目录名。路径先归一（大小写、斜杠），再取哈希：路径里的中文和盘符不进目录名 */
export function regressionDirFor(root: string, projectDir: string): string {
  const key = projectPathKey(projectDir)
  return join(root, createHash('sha256').update(key).digest('hex').slice(0, 16))
}

const fingerprintOf = (c: RegressionCase): string =>
  createHash('sha256').update(JSON.stringify(c)).digest('hex')

export type NewCase = Omit<RegressionCase, 'id' | 'status'> & { status?: CaseStatus }

export interface RegressionStore {
  readonly dir: string
  list(): Promise<{ cases: RegressionCase[]; tampered: string[] }>
  add(input: NewCase): Promise<RegressionCase>
  /** 冠军晋升时把这些 candidate 转成 locked */
  lock(ids: string[], at: number): Promise<void>
  retire(id: string, by: string, reason: string, at: number): Promise<RegressionCase>
  champion(): Promise<ChampionRecord>
  promote(entry: ChampionEntry): Promise<void>
  /** 按 tree id + 用例指纹缓存的结果 */
  cachedResult<T>(tree: string, caseKey: string): Promise<T | undefined>
  cacheResult(tree: string, caseKey: string, result: unknown): Promise<void>
}

/** 结果缓存只留最近几个 tree：它是近况不是档案 */
const CACHE_TREES_KEPT = 20

export function createRegressionStore(dir: string, projectDir: string): RegressionStore {
  const casesDir = join(dir, 'cases')
  const manifestFile = join(dir, 'manifest.json')
  const championFile = join(dir, 'champion.json')
  const cacheFile = join(dir, 'results.json')
  const metaFile = join(dir, 'project.json')

  let chain: Promise<unknown> = Promise.resolve()
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = chain.then(work, work)
    chain = next.catch(() => undefined)
    return next
  }
  const ensure = async (): Promise<void> => {
    await fs.mkdir(casesDir, { recursive: true })
    // 目录名是哈希，记一笔是哪个工程，人翻目录时认得出
    await fs.access(metaFile).catch(() => writeJson(metaFile, { projectDir }))
  }

  const readAll = async (): Promise<{ cases: RegressionCase[]; tampered: string[] }> => {
    const manifest = await readJson<Record<string, string>>(manifestFile, {})
    const names = await fs.readdir(casesDir).catch(() => [] as string[])
    const cases: RegressionCase[] = []
    const tampered: string[] = []
    for (const name of names.filter((n) => n.endsWith('.json')).sort()) {
      const c = await readJson<RegressionCase | null>(join(casesDir, name), null)
      const id = name.slice(0, -'.json'.length)
      if (!c || c.id !== id || manifest[id] !== fingerprintOf(c)) {
        tampered.push(id)
        if (c) cases.push(c)
        continue
      }
      cases.push(c)
    }
    // 指纹清单里有、文件却没了的：被删的
    for (const id of Object.keys(manifest)) {
      if (!names.includes(`${id}.json`)) tampered.push(id)
    }
    return { cases, tampered }
  }

  const write = async (c: RegressionCase): Promise<void> => {
    const manifest = await readJson<Record<string, string>>(manifestFile, {})
    await writeJson(join(casesDir, `${c.id}.json`), c)
    manifest[c.id] = fingerprintOf(c)
    await writeJson(manifestFile, manifest)
  }

  return {
    dir,
    list: async () => {
      await ensure()
      return readAll()
    },
    add: (input) =>
      serial(async () => {
        await ensure()
        const { cases } = await readAll()
        const max = cases.reduce((n, c) => Math.max(n, Number(c.id.slice(1)) || 0), 0)
        const id = `c${String(max + 1).padStart(4, '0')}`
        const c: RegressionCase = { ...input, id, status: input.status ?? 'candidate' }
        await write(c)
        return c
      }),
    lock: (ids, at) =>
      serial(async () => {
        const { cases } = await readAll()
        for (const c of cases) {
          if (ids.includes(c.id) && c.status === 'candidate') {
            await write({ ...c, status: 'locked', lockedAt: at })
          }
        }
      }),
    retire: (id, by, reason, at) =>
      serial(async () => {
        const { cases } = await readAll()
        const c = cases.find((x) => x.id === id)
        if (!c) throw new Error(`没有用例 ${id}`)
        if (c.status === 'retired') throw new Error(`${id} 已经退役了`)
        const next: RegressionCase = { ...c, status: 'retired', retired: { by, at, reason } }
        await write(next)
        return next
      }),
    champion: () => readJson<ChampionRecord>(championFile, { current: null, history: [] }),
    promote: (entry) =>
      serial(async () => {
        await ensure()
        const record = await readJson<ChampionRecord>(championFile, { current: null, history: [] })
        await writeJson(championFile, {
          current: entry,
          history: [...record.history, entry]
        } satisfies ChampionRecord)
      }),
    cachedResult: async <T>(tree: string, caseKey: string) => {
      const cache = await readJson<Record<string, Record<string, unknown>>>(cacheFile, {})
      return cache[tree]?.[caseKey] as T | undefined
    },
    cacheResult: (tree, caseKey, result) =>
      serial(async () => {
        await ensure()
        const cache = await readJson<Record<string, Record<string, unknown>>>(cacheFile, {})
        // 插入顺序就是新旧顺序：动过的 tree 挪到最后
        const entry = { ...(cache[tree] ?? {}), [caseKey]: result }
        delete cache[tree]
        cache[tree] = entry
        const trees = Object.keys(cache)
        for (const old of trees.slice(0, Math.max(0, trees.length - CACHE_TREES_KEPT))) {
          delete cache[old]
        }
        await writeJson(cacheFile, cache)
      })
  }
}

/** 用例内容的指纹：缓存键的一半（另一半是工程的 tree id） */
export function caseKey(c: RegressionCase): string {
  const { id, scene, seconds, seed, inputs, watch, asserts, viewport } = c
  return (
    createHash('sha256')
      // 没有 viewport 的旧用例：undefined 不进 JSON，键和以前一样
      .update(JSON.stringify({ id, scene, seconds, seed, inputs, watch, asserts, viewport }))
      .digest('hex')
      .slice(0, 16)
  )
}
