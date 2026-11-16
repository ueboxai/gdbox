import { decodeMp3, decodeWav, type Pcm } from './musicLoop'

/**
 * 模型听不见声音。这里给出能客观测量的事实：时长、响度、首尾静音、削波、明暗、音高走向、循环点接缝。
 * 不评价「好不好听」——那得人来听。
 */
export interface AudioFacts {
  seconds: number
  channels: number
  sampleRate: number
  peakDb: number
  rmsDb: number
  leadingSilenceMs: number
  trailingSilenceMs: number
  clippedSamples: number
  /** 粗略的「明亮度」：过零率换算的主频，Hz */
  brightnessHz: number
  /** 前 1/4 和后 1/4 的明亮度比较，判断音高往上走还是往下走 */
  pitchTrend: 'rising' | 'falling' | 'steady'
  loop?: { startSec: number; endSec: number; seamJump: number }
}

const db = (x: number): number => (x <= 0 ? -120 : 20 * Math.log10(x))

function zeroCrossHz(s: Float32Array, from: number, to: number, sampleRate: number): number {
  let crossings = 0
  for (let i = from + 1; i < to; i++) if (s[i - 1] < 0 !== s[i] < 0) crossings++
  return to > from ? (crossings * sampleRate) / (2 * (to - from)) : 0
}

function readSmplLoop(data: Buffer): { start: number; end: number } | undefined {
  const at = data.indexOf('smpl')
  if (at < 0 || data.readUInt32LE(at + 8 + 28) < 1) return undefined
  return { start: data.readUInt32LE(at + 8 + 36 + 8), end: data.readUInt32LE(at + 8 + 36 + 12) + 1 }
}

export async function inspectAudio(data: Buffer, ext: string): Promise<AudioFacts> {
  let pcm: Pcm
  if (ext === 'wav') pcm = decodeWav(data)
  else if (ext === 'mp3') pcm = await decodeMp3(data)
  else throw new Error(`Cannot inspect .${ext} files; WAV and MP3 are supported.`)

  const len = pcm.channels[0].length
  const mono = new Float32Array(len)
  for (const ch of pcm.channels)
    for (let i = 0; i < len; i++) mono[i] += ch[i] / pcm.channels.length

  let peak = 0
  let sq = 0
  let clipped = 0
  for (const ch of pcm.channels) {
    for (const v of ch) {
      const a = Math.abs(v)
      if (a > peak) peak = a
      if (a >= 0.999) clipped++
    }
  }
  for (const v of mono) sq += v * v
  const threshold = 0.001
  let lead = 0
  while (lead < len && Math.abs(mono[lead]) < threshold) lead++
  let trail = 0
  while (trail < len - lead && Math.abs(mono[len - 1 - trail]) < threshold) trail++

  const sr = pcm.sampleRate
  const body0 = lead
  const body1 = len - trail
  const q = Math.max(1, Math.floor((body1 - body0) / 4))
  const startHz = zeroCrossHz(mono, body0, body0 + q, sr)
  const endHz = zeroCrossHz(mono, body1 - q, body1, sr)
  const ratio = startHz > 0 ? endHz / startHz : 1
  const pitchTrend = ratio > 1.15 ? 'rising' : ratio < 0.87 ? 'falling' : 'steady'

  const facts: AudioFacts = {
    seconds: len / sr,
    channels: pcm.channels.length,
    sampleRate: sr,
    peakDb: Math.round(db(peak) * 10) / 10,
    rmsDb: Math.round(db(Math.sqrt(sq / Math.max(1, len))) * 10) / 10,
    leadingSilenceMs: Math.round((lead / sr) * 1000),
    trailingSilenceMs: Math.round((trail / sr) * 1000),
    clippedSamples: clipped,
    brightnessHz: Math.round(zeroCrossHz(mono, body0, body1, sr)),
    pitchTrend
  }
  const loop = ext === 'wav' ? readSmplLoop(data) : undefined
  if (loop && loop.end <= len && loop.start < loop.end) {
    // 循环点两侧的采样差：越小接缝越听不出来
    const jump = Math.abs(mono[loop.end - 1] - mono[loop.start])
    facts.loop = {
      startSec: loop.start / sr,
      endSec: loop.end / sr,
      seamJump: Math.round(jump * 1000) / 1000
    }
  }
  return facts
}

export function describeAudio(f: AudioFacts): string {
  const lines = [
    `${f.seconds.toFixed(2)} s, ${f.channels === 1 ? 'mono' : `${f.channels} channels`}, ${f.sampleRate} Hz`,
    `Loudness: peak ${f.peakDb} dBFS, RMS ${f.rmsDb} dBFS${f.clippedSamples ? `, ${f.clippedSamples} clipped samples` : ''}`,
    `Silence: ${f.leadingSilenceMs} ms at the start, ${f.trailingSilenceMs} ms at the end`,
    `Character: brightness ~${f.brightnessHz} Hz, pitch ${f.pitchTrend}`
  ]
  if (f.loop) {
    lines.push(
      `Loop: ${f.loop.startSec.toFixed(2)}s → ${f.loop.endSec.toFixed(2)}s, seam jump ${f.loop.seamJump} (below 0.05 is inaudible)`
    )
  }
  if (f.leadingSilenceMs > 80)
    lines.push(
      'Note: noticeable silence before the sound starts; it will feel late when triggered.'
    )
  if (f.peakDb < -12) lines.push('Note: quiet; it may get lost in the mix.')
  return lines.join('\n')
}
