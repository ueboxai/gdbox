/** 恢复旧容量规则下从未出场却被挤掉的经验；保留有证据或明确原因的退休。 */
import type { ExperienceStore } from './store'

export async function repairLayer(store: ExperienceStore): Promise<number> {
  const ledger = await store.readLedger()
  const tools = [...new Set((await store.readAll()).map((entry) => entry.tool))]
  let changed = 0
  for (const tool of tools) {
    await store.updateTool(tool, (list) => {
      const next = list.map((entry) => {
        const stats = ledger[entry.id]
        if (
          entry.status !== 'retired' ||
          entry.retiredBecause ||
          (stats && (stats.shown || stats.holdout))
        )
          return entry
        return { ...entry, status: 'trial' as const }
      })
      const count = next.filter((entry, i) => entry !== list[i]).length
      changed += count
      return count ? next : undefined
    })
  }
  return changed
}
