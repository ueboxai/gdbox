import { z } from 'zod'
import type { CapabilityKind, IdleAction, IdleView } from '../../../shared/capabilityIdle'
import { editIdle, observe } from './idleStore'
import { refreshIdleMcp, restoreIdleMcp } from './mcp'
import { discoverEnabledSkills, setSkillDisabled } from './skills'

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('auto'), enabled: z.boolean() }),
  z.object({ action: z.enum(['keep', 'unkeep', 'disable', 'restore']), id: z.string().min(1) })
])

async function snapshot(kind: CapabilityKind): Promise<IdleView> {
  if (kind === 'skill') {
    const names = (await discoverEnabledSkills()).map((skill) => skill.name)
    return editIdle((state) => ({ auto: false, rows: observe(state, kind, names) }))
  }
  const rows = await refreshIdleMcp()
  return { auto: await editIdle((state) => state.auto), rows }
}

async function manage(kind: CapabilityKind, action?: IdleAction): Promise<IdleView> {
  if (kind !== 'skill' && kind !== 'mcp') throw new Error('Unknown capability kind')
  if (!action) return snapshot(kind)
  action = actionSchema.parse(action)
  if (action.action === 'auto') {
    if (kind !== 'mcp') throw new Error('Invalid automatic disable setting')
    const enabled = action.enabled
    await editIdle((state) => {
      state.auto = enabled
    })
  } else {
    const { id, action: op } = action
    const view = await snapshot(kind)
    const current = view.rows.find((row) => row.id === id)
    if (!current) return view
    if (kind === 'skill' && op === 'disable') {
      await setSkillDisabled(id, true)
    } else {
      if (kind === 'mcp' && op === 'restore' && current.disabled) await restoreIdleMcp(id)
      await editIdle((state) => {
        const item = state.entries[kind + '/' + id]
        if (!item || item.since !== current.since) return
        if (op === 'keep' || op === 'unkeep') item.kept = op === 'keep'
        else if (kind === 'mcp' && op === 'disable') item.disabled = 'manual'
        else if (kind === 'mcp' && op === 'restore' && item.disabled) {
          delete item.disabled
          item.since = Date.now()
        }
      })
    }
  }
  return snapshot(kind)
}

// Keep disconnect/restore and the periodic sweep in the same order as their disk changes.
let pending = Promise.resolve()
export function manageIdle(kind: CapabilityKind, action?: IdleAction): Promise<IdleView> {
  const result = pending.then(() => manage(kind, action))
  pending = result.then(
    () => undefined,
    () => undefined
  )
  return result
}

export function startIdleChecks(): void {
  const check = (): void => {
    for (const kind of ['mcp', 'skill'] as const) {
      void manageIdle(kind).catch((error) => console.warn('[Idle] Inventory check failed', error))
    }
  }
  check()
  setInterval(check, 60 * 60 * 1000).unref()
}
