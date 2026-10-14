import { describe, expect, it } from 'vitest'
import { describeAudio, inspectAudio } from './audioInspect'
import { encodeWav } from './musicLoop'
import { makeSfx } from './sfxr'

describe('inspectAudio', () => {
  it('跳跃音效：响度正常、首部没有静音、音高往上走', async () => {
    const { wav } = makeSfx('jump', 3)
    const f = await inspectAudio(wav, 'wav')
    expect(f.peakDb).toBeGreaterThan(-2)
    expect(f.leadingSilenceMs).toBeLessThan(20)
    expect(f.pitchTrend).toBe('rising')
  })

  it('读出 smpl 循环点和接缝大小', async () => {
    const sr = 8000
    const s = new Float32Array(sr)
    for (let i = 0; i < sr; i++) s[i] = 0.5 * Math.sin((2 * Math.PI * 100 * i) / sr)
    const wav = encodeWav({ channels: [s], sampleRate: sr }, { start: 0, end: 8000 })
    const f = await inspectAudio(wav, 'wav')
    expect(f.loop?.endSec).toBeCloseTo(1, 3)
    expect(f.loop!.seamJump).toBeLessThan(0.05)
    expect(describeAudio(f)).toContain('Loop: 0.00s → 1.00s')
  })
})
