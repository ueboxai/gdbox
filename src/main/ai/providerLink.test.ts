/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiProviderSettings } from './types'

const sent: string[] = []
vi.mock('../appWindows', () => ({
  findMainWindow: () => ({
    isDestroyed: () => false,
    isMinimized: () => false,
    restore: () => {},
    show: () => {},
    focus: () => {},
    webContents: { send: (channel: string) => sent.push(channel) }
  })
}))

let settings: AiProviderSettings
vi.mock('./store', () => ({
  readSettings: async () => settings,
  updateSettings: async (change: (current: AiProviderSettings) => AiProviderSettings) => {
    settings = change(settings)
    return settings
  }
}))

const savedKeys: Array<[string, string]> = []
vi.mock('./credentials', () => ({
  saveLiteralKey: async (id: string, key: string) => {
    savedKeys.push([id, key])
    return { kind: 'literal', id }
  }
}))

const {
  applyProviderLink,
  dismissProviderLink,
  handleProviderDeepLink,
  hasProviderLink,
  previewProviderLink,
  slotOfModel
} = await import('./providerLink')
const { CREATOR_PLAN_ORIGIN } = await import('./creatorPlan/endpoint')

// 拼出来的假 Key：整串写死会被密钥扫描当成真的
const KEY = `sk-${'test'.repeat(8)}`
const LINK = `gdbox://add-provider?key=${KEY}`

/** 中转站 /v1/models 的样子：每个模型带 supported_endpoint_types */
const relayModels = {
  data: [
    { id: 'claude-opus-5-5', supported_endpoint_types: ['anthropic', 'openai'] },
    { id: 'gpt-6-sol', supported_endpoint_types: ['openai', 'openai-response'] },
    { id: 'deepseek-flash', supported_endpoint_types: ['openai'] },
    { id: 'gpt-image-2', supported_endpoint_types: ['image-generation'] },
    { id: 'text-embedding-3-large', supported_endpoint_types: ['embeddings'] }
  ]
}

function stubRelay(body: unknown = relayModels, status = 200): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  sent.length = 0
  savedKeys.length = 0
  dismissProviderLink()
  settings = { version: 3, providers: [], roles: {} }
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('gdbox://add-provider', () => {
  it('不认别的 gdbox 链接', () => {
    expect(handleProviderDeepLink('gdbox://install-skill?id=x')).toBe(false)
  })

  it('Key 不对：吃掉链接，什么都不挂', () => {
    expect(handleProviderDeepLink('gdbox://add-provider?key=bad key')).toBe(true)
    expect(hasProviderLink()).toBe(false)
    expect(sent).toEqual([])
  })

  it('挂起链接并通知界面；没带 sk- 的补上', async () => {
    handleProviderDeepLink(`gdbox://add-provider?key=${'test'.repeat(8)}`)
    expect(sent).toEqual(['ai-provider:link'])
    const fetchMock = stubRelay()
    await previewProviderLink()
    expect(fetchMock).toHaveBeenCalledWith(
      `${CREATOR_PLAN_ORIGIN}/v1/models`,
      expect.objectContaining({ headers: { Authorization: `Bearer ${KEY}` } })
    )
  })
})

describe('按端点类型分组', () => {
  it('Claude 走 Anthropic，其余对话模型走 OpenAI 兼容，生图和向量不要', () => {
    expect(slotOfModel('claude-opus-5-5', ['anthropic', 'openai'])).toBe('anthropic')
    expect(slotOfModel('gpt-6-sol', ['openai', 'openai-response'])).toBe('openai')
    expect(slotOfModel('gpt-image-2', ['image-generation'])).toBeNull()
    expect(slotOfModel('text-embedding-3-large', ['embeddings'])).toBeNull()
    // 没标端点类型时按名字兜底
    expect(slotOfModel('gpt-image-2.6-flare', null)).toBeNull()
    expect(slotOfModel('qwen3-max', undefined)).toBe('openai')
  })

  it('预览只拉列表不写盘', async () => {
    handleProviderDeepLink(LINK)
    stubRelay()
    expect(await previewProviderLink()).toEqual({
      ok: true,
      data: {
        groups: [
          {
            providerId: 'uebox-claude',
            displayName: 'UEBox Claude',
            protocol: 'anthropic-messages',
            models: ['claude-opus-5-5'],
            existing: false
          },
          {
            providerId: 'uebox',
            displayName: 'UEBox',
            protocol: 'openai-completions',
            models: ['deepseek-flash', 'gpt-6-sol'],
            existing: false
          }
        ]
      }
    })
    expect(settings.providers).toEqual([])
    expect(savedKeys).toEqual([])
  })

  it('拉不到：回错误，不写盘', async () => {
    handleProviderDeepLink(LINK)
    stubRelay({ error: 'x' }, 401)
    expect(await previewProviderLink()).toMatchObject({
      ok: false,
      error: { code: 'listHttpError' }
    })
  })
})

describe('确认写入', () => {
  it('新建两个来源，地址按协议填；没设主模型就绑第一个', async () => {
    handleProviderDeepLink(LINK)
    stubRelay()
    await previewProviderLink()
    expect(await applyProviderLink()).toEqual(['uebox-claude', 'uebox'])

    expect(settings.providers).toEqual([
      expect.objectContaining({
        id: 'uebox-claude',
        kind: 'chat',
        protocol: 'anthropic-messages',
        baseUrl: CREATOR_PLAN_ORIGIN,
        apiKey: { kind: 'literal', id: 'provider:uebox-claude' }
      }),
      expect.objectContaining({
        id: 'uebox',
        protocol: 'openai-completions',
        baseUrl: `${CREATOR_PLAN_ORIGIN}/v1`
      })
    ])
    expect(settings.roles.chat).toEqual({ providerId: 'uebox-claude', modelId: 'claude-opus-5-5' })
    expect(savedKeys).toEqual([
      ['provider:uebox-claude', KEY],
      ['provider:uebox', KEY]
    ])
    expect(hasProviderLink()).toBe(false)
  })

  it('同协议同地址的对话来源已经有了：换 Key、补模型；同地址的生图来源不碰', async () => {
    const image = {
      id: 'openai-image-4',
      displayName: 'OpenAI GPT Image',
      kind: 'image',
      protocol: 'openai-completions',
      baseUrl: `${CREATOR_PLAN_ORIGIN}/v1`,
      apiKey: { kind: 'literal', id: 'provider:openai-image-4' },
      models: [{ id: 'gpt-image-2' }]
    } as AiProviderSettings['providers'][number]
    const relay = {
      id: 'my-relay',
      displayName: 'My Relay',
      kind: 'chat',
      protocol: 'openai-completions',
      baseUrl: `${CREATOR_PLAN_ORIGIN}/v1/`,
      apiKey: { kind: 'literal', id: 'old-key-id' },
      models: [{ id: 'gpt-6-sol', displayName: '我的 GPT' }]
    } as AiProviderSettings['providers'][number]
    settings = {
      version: 3,
      providers: [image, relay],
      roles: { chat: { providerId: 'my-relay', modelId: 'gpt-6-sol' } }
    }
    handleProviderDeepLink(LINK)
    stubRelay()
    const preview = await previewProviderLink()
    expect(preview).toMatchObject({
      ok: true,
      data: { groups: [{ providerId: 'uebox-claude' }, { providerId: 'my-relay', existing: true }] }
    })
    await applyProviderLink()

    expect(settings.providers[0]).toEqual(image)
    expect(settings.providers[1]).toMatchObject({
      id: 'my-relay',
      apiKey: { kind: 'literal', id: 'old-key-id' },
      models: [{ id: 'gpt-6-sol', displayName: '我的 GPT' }, { id: 'deepseek-flash' }]
    })
    // 已经设过主模型，不动
    expect(settings.roles.chat).toEqual({ providerId: 'my-relay', modelId: 'gpt-6-sol' })
  })

  it('放弃之后确认不了', async () => {
    handleProviderDeepLink(LINK)
    stubRelay()
    await previewProviderLink()
    dismissProviderLink()
    await expect(applyProviderLink()).rejects.toThrow()
    expect(settings.providers).toEqual([])
  })
})
