import { readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { app } from 'electron'
import { z } from 'zod'
import { writeSessionFile } from '../core/atomicSessionFile'
import type { CapabilityKind, IdleRow } from '../../../shared/capabilityIdle'

const day = 86_400_000
const record = z.object({
  since: z.number().nonnegative(),
  lastUsed: z.number().nonnegative().optional(),
  kept: z.boolean().optional(),
  disabled: z.enum(['manual', 'auto']).optional()
})
const schema = z.object({
  auto: z.boolean(),
  entries: z.record(z.string(), record)
})
type State = z.infer<typeof schema>

// All observations and user actions share one queue, including the read and atomic rename.
let tail = Promise.resolve()
export function editIdle<T>(edit: (state: State) => T): Promise<T> {
  const task = tail.then(async () => {
    const directory = app.getPath('userData')
    if (!isAbsolute(directory)) throw new Error('User data directory unavailable')
    const file = join(directory, 'capability-idle.json')
    let state: State = { auto: false, entries: {} }
    try {
      state = schema.parse(JSON.parse(await readFile(file, 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const before = JSON.stringify(state)
    const result = edit(state)
    const after = JSON.stringify(state)
    if (before !== after) await writeSessionFile(file, after)
    return result
  })
  tail = task.then(
    () => undefined,
    () => undefined
  )
  return task
}

export function observe(
  state: State,
  kind: CapabilityKind,
  enabled: string[],
  now = Date.now()
): IdleRow[] {
  const rows: IdleRow[] = []
  const present = new Set(enabled.map((id) => kind + '/' + id))
  for (const key of Object.keys(state.entries)) {
    // Engine/plugin discovery can be temporarily empty. Keep explicit user choices.
    const item = state.entries[key]
    if (key.startsWith(kind + '/') && !present.has(key) && !item.kept && !item.disabled) {
      delete state.entries[key]
    }
  }
  for (const id of enabled) {
    const key = kind + '/' + id
    const item = (state.entries[key] ??= { since: now })
    const age = now - item.since
    if (kind === 'mcp' && state.auto && !item.kept && !item.disabled && age >= 30 * day) {
      item.disabled = 'auto'
    }
    if (item.disabled || item.kept || age >= 14 * day) rows.push({ id, ...item })
  }
  return rows
}

export async function recordUse(kind: CapabilityKind, id: string): Promise<boolean> {
  return editIdle((state) => {
    const key = kind + '/' + id
    const item = (state.entries[key] ??= { since: Date.now() })
    if (item.disabled) return false
    item.lastUsed = item.since = Date.now()
    return true
  }).catch((error) => {
    console.warn('[Idle] Could not record activity', error)
    return true
  })
}

export async function resetIdle(kind: CapabilityKind, id: string): Promise<void> {
  await editIdle((state) => {
    delete state.entries[kind + '/' + id]
  })
}
