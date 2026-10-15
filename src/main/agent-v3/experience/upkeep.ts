/**
 * 经验库的维护活：修旧账。整理员每次开工前给它要写的层做（`curator.ts`），
 * 盒子启动时也给通用层做一次（`scheduler.ts`）。
 *
 * 2026-10-15 之前，每个工具最多 5 条，满了挤掉得分最低的 —— 还没出过场的都是 0 分，
 * 所以实际只留最近 5 条，早先学到的一条条被新来的挤掉了（上游虚幻盒子 23f1c9ea）。
 * 那时退休不记原因，但能确定地认出来：别的退休路径（照做了又错、被忽略、提升不够）
 * 都要先有出场记录，账本里一次都没出过场的退休经验，只可能是被容量挤掉的。
 * 把它们放回试用。
 *
 * 幂等：跑第二次什么也不改。
 */

import type { ExperienceEntry } from './experienceFile'
import type { EntryStats } from './lifecycle'
import type { ExperienceStore } from './store'

function neverTested(stats: EntryStats | undefined): boolean {
  return !stats || (stats.shown === 0 && stats.holdout === 0)
}

function repaired(entry: ExperienceEntry, stats: EntryStats | undefined): ExperienceEntry {
  // 有原因的退休是新规则下的结论，不动
  if (entry.status !== 'retired' || entry.retiredBecause || !neverTested(stats)) return entry
  return { ...entry, status: 'trial' }
}

/** 修一层的旧账。回改了几条 */
export async function repairLayer(store: ExperienceStore): Promise<number> {
  const ledger = await store.readLedger()
  const tools = [...new Set((await store.readAll()).map((e) => e.tool))]
  let changed = 0
  for (const tool of tools) {
    await store.updateTool(tool, (list) => {
      const next = list.map((entry) => repaired(entry, ledger[entry.id]))
      const count = next.filter((entry, i) => entry !== list[i]).length
      changed += count
      return count > 0 ? next : undefined
    })
  }
  return changed
}
