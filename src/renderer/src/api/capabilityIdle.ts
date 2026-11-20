import { unwrapResult } from '@renderer/common/utils'
import type { CapabilityKind, IdleAction, IdleView } from '@core/shared/capabilityIdle'

export async function manageIdle(kind: CapabilityKind, action?: IdleAction): Promise<IdleView> {
  return unwrapResult(await window.api.agentV3.manageIdle(kind, action))
}
