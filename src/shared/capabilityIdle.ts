export type CapabilityKind = 'mcp' | 'skill'

export type IdleAction =
  | { action: 'auto'; enabled: boolean }
  | { action: 'keep' | 'unkeep' | 'disable' | 'restore'; id: string }

export interface IdleRow {
  id: string
  since: number
  lastUsed?: number
  kept?: boolean
  disabled?: 'manual' | 'auto'
}

export interface IdleView {
  auto: boolean
  rows: IdleRow[]
}
