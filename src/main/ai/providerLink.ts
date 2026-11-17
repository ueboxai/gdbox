/**
 * 中转站网页「聊天 → GDBox」：`gdbox://add-provider?key=sk-…`。
 *
 * 链接里只取 Key，地址固定是本应用的中转站。用这把 Key 拉 `/v1/models`，按中转站给每个模型
 * 标的 `supported_endpoint_types` 分成两个对话来源：
 *   - 上游原生支持 Anthropic Messages 的（Claude）走 `anthropic-messages`：经 OpenAI 兼容格式
 *     转一道会丢提示缓存和带签名的思考块（和 Box Plan 同一条规则，见 creatorPlan/apply.ts）；
 *   - 其余对话模型走 `openai-completions`；
 *   - 生图、向量、视频、重排模型不进对话来源。
 *
 * 链接谁都能发：预览只拉列表不写盘，用户在设置页确认后才落盘。同协议、同地址的对话来源
 * 已经有了就换 Key、补模型，不再叠一条。冷启动从链接唤起时界面后到，请求先挂着。
 */

import {
  mergeListedModel,
  type ModelConfig,
  type ProbeFailure,
  type ProviderProtocol
} from '../../shared/aiProvider'
import type { ProviderLinkGroup, ProviderLinkPreview } from '../../shared/aiProvider'
import { findMainWindow } from '../appWindows'
import { CREATOR_PLAN_ORIGIN } from './creatorPlan/endpoint'
import { saveLiteralKey } from './credentials'
import { describeProbeError, modelFromListItem } from './probe'
import { readSettings, updateSettings } from './store'
import type { ProviderConfig } from './types'

export const PROVIDER_LINK_CHANNEL = 'ai-provider:link'

const KEY_PATTERN = /^(sk-)?[A-Za-z0-9_-]{16,128}$/

/** 中转站 `/v1/models` 里不是对话模型的端点类型 */
const NON_CHAT_ENDPOINTS = ['image-generation', 'embeddings', 'openai-video', 'jina-rerank']
/** 端点类型缺失时的兜底：按名字认生图、向量模型 */
const NON_CHAT_NAME = /image|dall-e|flux|seedream|imagen|midjourney|embed|rerank|bge|tts|whisper/i

const SLOTS: Record<
  'anthropic' | 'openai',
  { id: string; name: string; protocol: ProviderProtocol }
> = {
  anthropic: { id: 'uebox-claude', name: 'UEBox Claude', protocol: 'anthropic-messages' },
  openai: { id: 'uebox', name: 'UEBox', protocol: 'openai-completions' }
}

let pendingKey: string | null = null
/** 预览时拉到的分组，确认时直接用 */
let prepared: ProviderLinkGroup[] | null = null
/** 预览时拉到的每个模型的配置（带中转站给的能力），确认时按 id 取 */
let preparedModels = new Map<string, ModelConfig>()

const trimSlash = (url: string): string => url.replace(/\/+$/, '')

/** 这一档来源该填的地址：Anthropic SDK 自己拼 `/v1/messages`，那一路不带 `/v1` */
function slotBaseUrl(protocol: ProviderProtocol): string {
  return protocol === 'anthropic-messages' ? CREATOR_PLAN_ORIGIN : `${CREATOR_PLAN_ORIGIN}/v1`
}

export function hasProviderLink(): boolean {
  return pendingKey !== null
}

export function dismissProviderLink(): void {
  pendingKey = null
  prepared = null
  preparedModels = new Map()
}

export function handleProviderDeepLink(raw: string): boolean {
  if (!/^gdbox:\/\/add-provider/i.test(raw)) return false
  let key = ''
  try {
    key = new URL(raw).searchParams.get('key')?.trim() ?? ''
  } catch {
    /* 下面按 Key 无效处理 */
  }
  if (!KEY_PATTERN.test(key)) return true
  pendingKey = key.startsWith('sk-') ? key : `sk-${key}`
  prepared = null
  const window = findMainWindow()
  if (window && !window.isDestroyed()) {
    window.webContents.send(PROVIDER_LINK_CHANNEL)
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }
  return true
}

/** 一个模型归哪一档；不是对话模型回 null */
export function slotOfModel(id: string, endpoints: unknown): 'anthropic' | 'openai' | null {
  const types = Array.isArray(endpoints) ? endpoints.map(String) : []
  if (types.length === 0) return NON_CHAT_NAME.test(id) ? null : 'openai'
  if (types.includes('anthropic')) return 'anthropic'
  if (types.some((type) => !NON_CHAT_ENDPOINTS.includes(type))) return 'openai'
  return null
}

/** 已有的、同协议同地址的对话来源 */
function findExisting(
  providers: ProviderConfig[],
  protocol: ProviderProtocol
): ProviderConfig | undefined {
  const base = slotBaseUrl(protocol)
  return providers.find(
    (item) => item.kind === 'chat' && item.protocol === protocol && trimSlash(item.baseUrl) === base
  )
}

function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}

/** 用挂着的 Key 拉模型列表、分好组。没有挂着的链接回 null */
export async function previewProviderLink(): Promise<
  { ok: true; data: ProviderLinkPreview } | { ok: false; error: ProbeFailure } | null
> {
  const key = pendingKey
  if (!key) return null
  let payload: {
    data?: Array<{ id?: unknown; supported_endpoint_types?: unknown; box_spec?: unknown }>
  }
  try {
    const response = await fetch(`${CREATOR_PLAN_ORIGIN}/v1/models`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(20_000)
    })
    if (!response.ok)
      return { ok: false, error: { code: 'listHttpError', raw: String(response.status) } }
    payload = (await response.json()) as typeof payload
  } catch (error) {
    return { ok: false, error: describeProbeError(error) }
  }
  if (pendingKey !== key) return null

  const buckets = { anthropic: [] as string[], openai: [] as string[] }
  const listed = new Map<string, ModelConfig>()
  for (const item of payload.data ?? []) {
    const model = modelFromListItem(item)
    const slot = model ? slotOfModel(model.id, item.supported_endpoint_types) : null
    if (!model || !slot || listed.has(model.id)) continue
    buckets[slot].push(model.id)
    listed.set(model.id, model)
  }

  const providers = (await readSettings()).providers
  const taken = new Set(providers.map((item) => item.id))
  const groups: ProviderLinkGroup[] = []
  for (const slot of ['anthropic', 'openai'] as const) {
    const models = buckets[slot].sort()
    if (models.length === 0) continue
    const { protocol, id, name } = SLOTS[slot]
    const existing = findExisting(providers, protocol)
    const providerId = existing?.id ?? uniqueId(id, taken)
    taken.add(providerId)
    groups.push({
      providerId,
      displayName: existing?.displayName ?? name,
      protocol,
      models,
      existing: !!existing
    })
  }
  if (groups.length === 0) return { ok: false, error: { code: 'listEmpty' } }
  prepared = groups
  preparedModels = listed
  return { ok: true, data: { groups } }
}

/** 用户确认：写进配置。已有的来源换 Key、补模型；新的按分组新建 */
export async function applyProviderLink(): Promise<string[]> {
  const key = pendingKey
  const groups = prepared
  if (!key || !groups) throw new Error('这个链接已经失效，请回网页重新点一次。')

  const current = await readSettings()
  const configs: ProviderConfig[] = []
  for (const group of groups) {
    const existing = current.providers.find((item) => item.id === group.providerId)
    const keyId =
      existing?.apiKey.kind === 'literal' ? existing.apiKey.id : `provider:${group.providerId}`
    const apiKey = await saveLiteralKey(keyId, key)
    const models: ModelConfig[] = [...(existing?.models ?? [])]
    for (const id of group.models) {
      const listed = preparedModels.get(id) ?? { id, supportsTools: true }
      const at = models.findIndex((model) => model.id === id)
      if (at < 0) models.push(listed)
      else models[at] = mergeListedModel(models[at], listed)
    }
    configs.push(
      existing
        ? { ...existing, apiKey, models }
        : {
            id: group.providerId,
            displayName: group.displayName,
            kind: 'chat',
            protocol: group.protocol,
            baseUrl: slotBaseUrl(group.protocol),
            apiKey,
            models
          }
    )
  }

  await updateSettings((settings) => {
    let providers = settings.providers
    for (const config of configs) {
      providers = providers.some((item) => item.id === config.id)
        ? providers.map((item) => (item.id === config.id ? config : item))
        : [...providers, config]
    }
    // 还没设过主模型就用第一个来源的第一个模型，不然加完了也发不出消息
    const first = configs[0]
    const roles =
      settings.roles.chat || !first?.models[0]
        ? settings.roles
        : { ...settings.roles, chat: { providerId: first.id, modelId: first.models[0].id } }
    return { ...settings, providers, roles }
  })
  dismissProviderLink()
  return configs.map((config) => config.id)
}
