import { describe, expect, it } from 'vitest'
import { decodeWav, encodeWav, findLoop, type Pcm } from './musicLoop'
import { seededRandom } from './sfxr'

const SR = 22050

/** 3 秒杂乱前奏 + 一个 4 秒乐句重复 6 遍 + 3 秒淡出。 */
function syntheticSong(): Pcm {
  const rand = seededRandom(5)
  const phrase = 4 * SR
  const notes = [220, 277, 330, 440, 392, 330, 294, 262]
  const intro = 3 * SR
  const total = intro + phrase * 6 + 3 * SR
  const out = new Float32Array(total)
  for (let i = 0; i < intro; i++) out[i] = (rand() * 2 - 1) * 0.3
  for (let i = intro; i < total; i++) {
    const t = (i - intro) % phrase
    const note = notes[Math.floor((t / phrase) * notes.length)]
    let s = 0.5 * Math.sin((2 * Math.PI * note * i) / SR)
    if (i > intro + phrase * 6) s *= 1 - (i - intro - phrase * 6) / (3 * SR)
    out[i] = s
  }
  return { channels: [out], sampleRate: SR }
}

describe('findLoop', () => {
  it('循环区间跳过前奏和淡出，长度是乐句的整数倍', () => {
    const song = syntheticSong()
    const loop = findLoop(song, 16)
    const startSec = loop.start / SR
    const lengthSec = (loop.end - loop.start) / SR
    expect(startSec).toBeGreaterThanOrEqual(2.5)
    expect(loop.end / SR).toBeLessThanOrEqual(27.5)
    expect(Math.abs(lengthSec / 4 - Math.round(lengthSec / 4))).toBeLessThan(0.05)
    expect(loop.score).toBeGreaterThan(0.95)
  })
})

describe('encodeWav', () => {
  it('带 smpl 循环块，能读回来', () => {
    const pcm: Pcm = { channels: [new Float32Array([0, 0.5, -0.5, 0.25])], sampleRate: SR }
    const wav = encodeWav(pcm, { start: 1, end: 4 })
    const smplAt = wav.indexOf('smpl')
    expect(smplAt).toBeGreaterThan(0)
    expect(wav.readUInt32LE(smplAt + 8 + 36 + 8)).toBe(1)
    expect(wav.readUInt32LE(smplAt + 8 + 36 + 12)).toBe(3)
    const back = decodeWav(wav)
    expect(back.channels[0][1]).toBeCloseTo(0.5, 3)
  })
})
