import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./credentials', () => ({ resolveApiKey: async (k: string) => k }))

import { generateSoundEffect, soundEffectRequest, supportsSoundEffects } from './soundEffect'
import type { ProviderConfig } from './types'

const eleven = {
  id: 'el',
  kind: 'music',
  musicApi: 'elevenlabs-music',
  baseUrl: 'https://api.elevenlabs.io/v1/',
  apiKey: 'sk-test',
  models: [{ id: 'music_v1' }]
} as unknown as ProviderConfig

afterEach(() => vi.unstubAllGlobals())

describe('AI 音效', () => {
  it('只有 ElevenLabs 有音效接口', () => {
    expect(supportsSoundEffects(eleven)).toBe(true)
    expect(supportsSoundEffects({ ...eleven, musicApi: 'sunoapi-music' } as ProviderConfig)).toBe(false)
  })

  it('请求打到 sound-generation，时长夹在服务商允许的范围里', () => {
    expect(soundEffectRequest(eleven, 'coin chime', 40)).toEqual({
      endpoint: 'https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128',
      body: { text: 'coin chime', duration_seconds: 22 }
    })
    expect(soundEffectRequest(eleven, 'x').body).toEqual({ text: 'x' })
  })

  it('带密钥头发出去，回音频字节；服务商拒绝时报 HTTP 码', async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])))
    vi.stubGlobal('fetch', fetchMock)
    const data = await generateSoundEffect(eleven, 'boom')
    expect([...data]).toEqual([1, 2, 3])
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect((init.headers as Record<string, string>)['xi-api-key']).toBe('sk-test')

    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 401 })))
    await expect(generateSoundEffect(eleven, 'boom')).rejects.toThrow('HTTP 401')
  })
})
