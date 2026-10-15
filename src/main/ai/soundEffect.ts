/**
 * 按描述生成音效。
 *
 * 目前只接 ElevenLabs 的 sound-generation：它和 ElevenLabs 音乐是同一把密钥、同一个地址前缀，
 * 用户在「音乐」上绑了 ElevenLabs 就能直接用，不另开一类服务、不多一处设置。
 * 别的音乐服务商没有音效接口，调用方据此退回本地合成。
 *
 * 音效是一次请求同步返回音频，没有任务号可续查；几秒钟的事，失败了重来的代价也小，
 * 所以不像音乐那样记回执。
 */

import { resolveApiKey } from './credentials'
import type { ProviderConfig } from './types'

export function supportsSoundEffects(provider: ProviderConfig): boolean {
  return provider.musicApi === 'elevenlabs-music'
}

export function soundEffectRequest(
  provider: ProviderConfig,
  prompt: string,
  seconds?: number
): { endpoint: string; body: Record<string, unknown> } {
  const base = provider.baseUrl.replace(/\/+$/, '')
  if (!/^https?:\/\//.test(base)) throw new Error('音效服务地址必须为 HTTP(S) 地址。')
  return {
    endpoint: `${base}/sound-generation?output_format=mp3_44100_128`,
    body: {
      text: prompt,
      ...(seconds ? { duration_seconds: Math.min(22, Math.max(0.5, seconds)) } : {})
    }
  }
}

/** 返回 MP3 字节 */
export async function generateSoundEffect(
  provider: ProviderConfig,
  prompt: string,
  seconds?: number,
  signal?: AbortSignal
): Promise<Buffer> {
  if (!supportsSoundEffects(provider)) throw new Error('这个音乐服务商没有音效接口。')
  const key = await resolveApiKey(provider.apiKey)
  if (!key) throw new Error('音乐来源没有配置 API 密钥。')
  const request = soundEffectRequest(provider, prompt, seconds)
  const response = await fetch(request.endpoint, {
    method: 'POST',
    headers: { ...provider.headers, 'Content-Type': 'application/json', 'xi-api-key': key },
    body: JSON.stringify(request.body),
    signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(120_000)]),
    redirect: 'error'
  })
  if (!response.ok) {
    throw new Error(`音效生成失败：HTTP ${response.status}`)
  }
  const data = Buffer.from(await response.arrayBuffer())
  if (!data.length) throw new Error('音效服务返回空音频。')
  return data
}
