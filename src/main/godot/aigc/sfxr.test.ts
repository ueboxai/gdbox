import { describe, expect, it } from 'vitest'
import { makeSfx, SAMPLE_RATE, SFX_KINDS } from './sfxr'

describe('sfxr', () => {
  it.each(SFX_KINDS)('%s：能出声、不超长、是合法 WAV', (kind) => {
    for (const seed of [1, 2, 3, 42, 1234]) {
      const { wav, seconds } = makeSfx(kind, seed)
      expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
      expect(wav.readUInt32LE(24)).toBe(SAMPLE_RATE)
      expect(seconds).toBeGreaterThan(0.01)
      expect(seconds).toBeLessThanOrEqual(5)

      // 有实际音量：峰值接近归一化目标
      let peak = 0
      for (let i = 44; i < wav.length; i += 2) peak = Math.max(peak, Math.abs(wav.readInt16LE(i)))
      expect(peak, `seed ${seed} len ${seconds}`).toBeGreaterThan(20000)
    }
  })

  it('同一种子出同一个声音，不同种子不一样', () => {
    expect(makeSfx('jump', 7).wav.equals(makeSfx('jump', 7).wav)).toBe(true)
    expect(makeSfx('jump', 7).wav.equals(makeSfx('jump', 8).wav)).toBe(false)
  })
})
