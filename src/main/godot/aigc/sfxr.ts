/**
 * sfxr 音效合成器的 TypeScript 移植。
 *
 * 算法来自 DrPetter 的 sfxr（公有领域，2007），游戏圈做跳跃、金币、受击这类短音效的标准做法。
 * 离线、免费、确定性：同一个预设 + 同一个种子，出同一个声音。
 */

export const SFX_KINDS = ['jump', 'coin', 'hit', 'explosion', 'shoot', 'powerup', 'select'] as const
export type SfxKind = (typeof SFX_KINDS)[number]

export interface SfxParams {
  waveType: 0 | 1 | 2 | 3 // 方波、锯齿、正弦、噪声
  baseFreq: number
  freqLimit: number
  freqRamp: number
  freqDramp: number
  duty: number
  dutyRamp: number
  vibStrength: number
  vibSpeed: number
  envAttack: number
  envSustain: number
  envPunch: number
  envDecay: number
  lpfFreq: number
  lpfRamp: number
  lpfResonance: number
  hpfFreq: number
  hpfRamp: number
  phaOffset: number
  phaRamp: number
  repeatSpeed: number
  arpSpeed: number
  arpMod: number
  soundVol: number
}

export const SAMPLE_RATE = 44100

function defaults(): SfxParams {
  return {
    waveType: 0,
    baseFreq: 0.3,
    freqLimit: 0,
    freqRamp: 0,
    freqDramp: 0,
    duty: 0,
    dutyRamp: 0,
    vibStrength: 0,
    vibSpeed: 0,
    envAttack: 0,
    envSustain: 0.3,
    envPunch: 0,
    envDecay: 0.4,
    lpfFreq: 1,
    lpfRamp: 0,
    lpfResonance: 0,
    hpfFreq: 0,
    hpfRamp: 0,
    phaOffset: 0,
    phaRamp: 0,
    repeatSpeed: 0,
    arpSpeed: 0,
    arpMod: 0,
    soundVol: 0.5
  }
}

/** 小而确定的随机数发生器（mulberry32）。 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 各预设的随机参数生成，照 sfxr 原版的按钮逻辑。 */
export function presetParams(kind: SfxKind, rand: () => number): SfxParams {
  const r = (x: number): number => rand() * x
  const ri = (n: number): number => Math.floor(rand() * (n + 1))
  const p = defaults()
  switch (kind) {
    case 'coin':
      p.baseFreq = 0.4 + r(0.5)
      p.envAttack = 0
      p.envSustain = r(0.1)
      p.envDecay = 0.1 + r(0.4)
      p.envPunch = 0.3 + r(0.3)
      if (rand() < 0.5) {
        p.arpSpeed = 0.5 + r(0.2)
        p.arpMod = 0.2 + r(0.4)
      }
      break
    case 'shoot':
      p.waveType = ri(2) as SfxParams['waveType']
      if (p.waveType === 2 && rand() < 0.5) p.waveType = ri(1) as SfxParams['waveType']
      p.baseFreq = 0.5 + r(0.5)
      p.freqLimit = Math.max(0.2, p.baseFreq - 0.2 - r(0.6))
      p.freqRamp = -0.15 - r(0.2)
      if (rand() < 0.33) {
        p.baseFreq = 0.3 + r(0.6)
        p.freqLimit = r(0.1)
        p.freqRamp = -0.35 - r(0.3)
      }
      if (rand() < 0.5) {
        p.duty = r(0.5)
        p.dutyRamp = r(0.2)
      } else {
        p.duty = 0.4 + r(0.5)
        p.dutyRamp = -r(0.7)
      }
      p.envAttack = 0
      p.envSustain = 0.1 + r(0.2)
      p.envDecay = r(0.4)
      if (rand() < 0.5) p.envPunch = r(0.3)
      if (rand() < 0.33) {
        p.phaOffset = r(0.2)
        p.phaRamp = -r(0.2)
      }
      if (rand() < 0.5) p.hpfFreq = r(0.3)
      break
    case 'explosion':
      p.waveType = 3
      if (rand() < 0.5) {
        p.baseFreq = 0.1 + r(0.4)
        p.freqRamp = -0.1 + r(0.4)
      } else {
        p.baseFreq = 0.2 + r(0.7)
        p.freqRamp = -0.2 - r(0.2)
      }
      p.baseFreq *= p.baseFreq
      if (rand() < 0.2) p.freqRamp = 0
      if (rand() < 0.33) p.repeatSpeed = 0.3 + r(0.5)
      p.envAttack = 0
      p.envSustain = 0.1 + r(0.3)
      p.envDecay = r(0.5)
      if (rand() < 0.5) {
        p.phaOffset = -0.3 + r(0.9)
        p.phaRamp = -r(0.3)
      }
      p.envPunch = 0.2 + r(0.6)
      if (rand() < 0.5) {
        p.vibStrength = r(0.7)
        p.vibSpeed = r(0.6)
      }
      if (rand() < 0.33) {
        p.arpSpeed = 0.6 + r(0.3)
        p.arpMod = 0.8 - r(1.6)
      }
      break
    case 'powerup':
      if (rand() < 0.5) p.waveType = 1
      else p.duty = r(0.6)
      if (rand() < 0.5) {
        p.baseFreq = 0.2 + r(0.3)
        p.freqRamp = 0.1 + r(0.4)
        p.repeatSpeed = 0.4 + r(0.4)
      } else {
        p.baseFreq = 0.2 + r(0.3)
        p.freqRamp = 0.05 + r(0.2)
        if (rand() < 0.5) {
          p.vibStrength = r(0.7)
          p.vibSpeed = r(0.6)
        }
      }
      p.envAttack = 0
      p.envSustain = r(0.4)
      p.envDecay = 0.1 + r(0.4)
      break
    case 'hit':
      p.waveType = ri(2) as SfxParams['waveType']
      if (p.waveType === 2) p.waveType = 3
      if (p.waveType === 0) p.duty = r(0.6)
      p.baseFreq = 0.2 + r(0.6)
      p.freqRamp = -0.3 - r(0.4)
      p.envAttack = 0
      p.envSustain = r(0.1)
      p.envDecay = 0.1 + r(0.2)
      if (rand() < 0.5) p.hpfFreq = r(0.3)
      break
    case 'jump':
      p.waveType = 0
      p.duty = r(0.6)
      p.baseFreq = 0.3 + r(0.3)
      p.freqRamp = 0.1 + r(0.2)
      p.envAttack = 0
      p.envSustain = 0.1 + r(0.3)
      p.envDecay = 0.1 + r(0.2)
      if (rand() < 0.5) p.hpfFreq = r(0.3)
      if (rand() < 0.5) p.lpfFreq = 1 - r(0.6)
      break
    case 'select':
      p.waveType = ri(1) as SfxParams['waveType']
      if (p.waveType === 0) p.duty = r(0.6)
      p.baseFreq = 0.2 + r(0.4)
      p.envAttack = 0
      p.envSustain = 0.1 + r(0.1)
      p.envDecay = r(0.2)
      p.hpfFreq = 0.1
      break
  }
  return p
}

/** 合成成 [-1, 1] 的单声道采样。最长 5 秒，防止参数失控出超长音频。 */
export function synthesize(p: SfxParams, rand: () => number): Float32Array {
  const maxSamples = SAMPLE_RATE * 5
  const out = new Float32Array(maxSamples)
  const phaserBuffer = new Float32Array(1024)
  const noiseBuffer = new Float32Array(32)
  const refillNoise = (): void => {
    for (let i = 0; i < 32; i++) noiseBuffer[i] = rand() * 2 - 1
  }

  let fperiod = 0
  let fmaxperiod = 0
  let fslide = 0
  let fdslide = 0
  let period = 0
  let squareDuty = 0
  let squareSlide = 0
  let arpMod = 0
  let arpTime = 0
  let arpLimit = 0

  const resetPitch = (): void => {
    fperiod = 100 / (p.baseFreq * p.baseFreq + 0.001)
    period = Math.floor(fperiod)
    fmaxperiod = 100 / (p.freqLimit * p.freqLimit + 0.001)
    fslide = 1 - Math.pow(p.freqRamp, 3) * 0.01
    fdslide = -Math.pow(p.freqDramp, 3) * 0.000001
    squareDuty = 0.5 - p.duty * 0.5
    squareSlide = -p.dutyRamp * 0.00005
    arpMod = p.arpMod >= 0 ? 1 - p.arpMod * p.arpMod * 0.9 : 1 + p.arpMod * p.arpMod * 10
    arpTime = 0
    arpLimit = p.arpSpeed === 1 ? 0 : Math.floor(Math.pow(1 - p.arpSpeed, 2) * 20000 + 32)
  }
  resetPitch()

  let fltp = 0
  let fltdp = 0
  let fltw = Math.pow(p.lpfFreq, 3) * 0.1
  const fltwD = 1 + p.lpfRamp * 0.0001
  const fltdmp = Math.min(0.8, (5 / (1 + p.lpfResonance * p.lpfResonance * 20)) * (0.01 + fltw))
  let fltphp = 0
  let flthp = p.hpfFreq * p.hpfFreq * 0.1
  const flthpD = 1 + p.hpfRamp * 0.0003

  let vibPhase = 0
  const vibSpeed = p.vibSpeed * p.vibSpeed * 0.01
  const vibAmp = p.vibStrength * 0.5

  let envVol = 0
  let envStage = 0
  let envTime = 0
  const envLength = [
    Math.max(1, Math.floor(p.envAttack * p.envAttack * 100000)),
    Math.max(1, Math.floor(p.envSustain * p.envSustain * 100000)),
    Math.max(1, Math.floor(p.envDecay * p.envDecay * 100000))
  ]

  let fphase = p.phaOffset * p.phaOffset * 1020 * Math.sign(p.phaOffset)
  const fdphase = p.phaRamp * p.phaRamp * Math.sign(p.phaRamp)
  let iphase = Math.abs(Math.floor(fphase))
  let ipp = 0

  refillNoise()

  let repTime = 0
  const repLimit = p.repeatSpeed === 0 ? 0 : Math.floor(Math.pow(1 - p.repeatSpeed, 2) * 20000 + 32)

  let phase = 0
  let length = 0
  for (let i = 0; i < maxSamples; i++) {
    repTime++
    if (repLimit !== 0 && repTime >= repLimit) {
      repTime = 0
      resetPitch()
    }

    arpTime++
    if (arpLimit !== 0 && arpTime >= arpLimit) {
      arpLimit = 0
      fperiod *= arpMod
    }

    fslide += fdslide
    fperiod *= fslide
    if (fperiod > fmaxperiod) {
      fperiod = fmaxperiod
      if (p.freqLimit > 0) break
    }

    let rfperiod = fperiod
    if (vibAmp > 0) {
      vibPhase += vibSpeed
      rfperiod = fperiod * (1 + Math.sin(vibPhase) * vibAmp)
    }
    period = Math.max(8, Math.floor(rfperiod))

    squareDuty = Math.min(0.5, Math.max(0, squareDuty + squareSlide))

    envTime++
    if (envTime > envLength[envStage]) {
      envTime = 0
      envStage++
      if (envStage === 3) break
    }
    if (envStage === 0) envVol = envTime / envLength[0]
    else if (envStage === 1) envVol = 1 + (1 - envTime / envLength[1]) * 2 * p.envPunch
    else envVol = 1 - envTime / envLength[2]

    fphase += fdphase
    iphase = Math.min(1023, Math.abs(Math.floor(fphase)))

    if (flthpD !== 0) flthp = Math.min(0.1, Math.max(0.00001, flthp * flthpD))

    let ssample = 0
    for (let si = 0; si < 8; si++) {
      phase++
      if (phase >= period) {
        phase %= period
        if (p.waveType === 3) refillNoise()
      }
      const fp = phase / period
      let sample: number
      switch (p.waveType) {
        case 0:
          sample = fp < squareDuty ? 0.5 : -0.5
          break
        case 1:
          sample = 1 - fp * 2
          break
        case 2:
          sample = Math.sin(fp * 2 * Math.PI)
          break
        default:
          sample = noiseBuffer[Math.floor((phase * 32) / period) % 32]
      }

      const pp = fltp
      fltw = Math.min(0.1, Math.max(0, fltw * fltwD))
      if (p.lpfFreq !== 1) {
        fltdp += (sample - fltp) * fltw
        fltdp -= fltdp * fltdmp
      } else {
        fltp = sample
        fltdp = 0
      }
      fltp += fltdp
      fltphp += fltp - pp
      fltphp -= fltphp * flthp
      sample = fltphp

      phaserBuffer[ipp & 1023] = sample
      sample += phaserBuffer[(ipp - iphase + 1024) & 1023]
      ipp = (ipp + 1) & 1023

      ssample += sample * envVol
    }
    ssample = (ssample / 8) * 0.05 * 2 * p.soundVol
    out[i] = Math.max(-1, Math.min(1, ssample))
    length = i + 1
  }
  return out.slice(0, length)
}

/** 去掉尾部静音，峰值归一到 -1 dBFS，首尾各加几毫秒淡入淡出防爆音。 */
export function finish(samples: Float32Array): Float32Array {
  let end = samples.length
  while (end > 0 && Math.abs(samples[end - 1]) < 0.001) end--
  const out = samples.slice(0, Math.max(end, 1))
  const fade = Math.min(Math.floor(SAMPLE_RATE * 0.004), Math.floor(out.length / 4))
  for (let i = 0; i < fade; i++) {
    out[i] *= i / fade
    out[out.length - 1 - i] *= i / fade
  }
  // 先淡入淡出再归一：sfxr 的冲击音最响的地方常在开头几毫秒
  let peak = 0
  for (const s of out) peak = Math.max(peak, Math.abs(s))
  const gain = peak > 0 ? 0.89 / peak : 1
  for (let i = 0; i < out.length; i++) out[i] *= gain
  return out
}

/** 16 位单声道 WAV。Godot 原生支持，导入后可直接用。 */
export function encodeWav(samples: Float32Array, sampleRate = SAMPLE_RATE): Buffer {
  const data = Buffer.alloc(samples.length * 2)
  for (let i = 0; i < samples.length; i++) {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), i * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // 单声道
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

/** 一个预设 + 种子 → 一段可写盘的 WAV。 */
export function makeSfx(kind: SfxKind, seed: number): { wav: Buffer; seconds: number } {
  const rand = seededRandom(seed)
  const params = presetParams(kind, rand)
  const samples = finish(synthesize(params, rand))
  return { wav: encodeWav(samples), seconds: samples.length / SAMPLE_RATE }
}
