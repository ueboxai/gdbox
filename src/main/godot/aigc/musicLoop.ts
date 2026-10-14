/**
 * 把 AI 生成的整首曲子做成能无缝循环的 BGM。
 *
 * 服务商给的是带前奏和结尾的完整曲子，不管时长，也不能循环。这里的做法：
 * 1. 解码成 PCM，算每一小段的频谱特征；
 * 2. 找一对位置 (开始, 结束)：结束之后那几秒和开始之后那几秒听起来最像——从结束跳回开始就听不出接缝；
 * 3. 在采样级对齐波形，结尾几十毫秒做交叉淡化；
 * 4. 写成带 smpl 循环块的 WAV。Godot 导入 WAV 默认「从文件检测循环」，不用改 .import。
 */

export interface Pcm {
  channels: Float32Array[]
  sampleRate: number
}

export async function decodeMp3(data: Buffer): Promise<Pcm> {
  const { MPEGDecoder } = await import('mpg123-decoder')
  const decoder = new MPEGDecoder()
  await decoder.ready
  try {
    const out = decoder.decode(new Uint8Array(data.buffer, data.byteOffset, data.length))
    if (!out.samplesDecoded) throw new Error('Could not decode the MP3 file.')
    return {
      channels: out.channelData.map((c) => c.slice(0, out.samplesDecoded)),
      sampleRate: out.sampleRate
    }
  } finally {
    decoder.free()
  }
}

/** 读 16 位 PCM WAV（服务商有时直接给 WAV）。 */
export function decodeWav(data: Buffer): Pcm {
  if (data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WAVE')
    throw new Error('Not a WAV file.')
  let pos = 12
  let channels = 1
  let sampleRate = 44100
  let bits = 16
  while (pos + 8 <= data.length) {
    const id = data.toString('ascii', pos, pos + 4)
    const size = data.readUInt32LE(pos + 4)
    if (id === 'fmt ') {
      channels = data.readUInt16LE(pos + 10)
      sampleRate = data.readUInt32LE(pos + 12)
      bits = data.readUInt16LE(pos + 22)
    } else if (id === 'data') {
      if (bits !== 16) throw new Error(`Only 16-bit WAV is supported, got ${bits}-bit.`)
      const frames = Math.floor(size / (2 * channels))
      const out = Array.from({ length: channels }, () => new Float32Array(frames))
      for (let i = 0; i < frames; i++) {
        for (let c = 0; c < channels; c++)
          out[c][i] = data.readInt16LE(pos + 8 + (i * channels + c) * 2) / 32768
      }
      return { channels: out, sampleRate }
    }
    pos += 8 + size + (size % 2)
  }
  throw new Error('WAV file has no data chunk.')
}

// ---------- 频谱特征 ----------

function fftMagnitudes(frame: Float32Array): Float32Array {
  const n = frame.length
  const re = Float64Array.from(frame)
  const im = new Float64Array(n)
  // 位反转
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k
        const b = a + len / 2
        const tr = re[b] * cr - im[b] * ci
        const ti = re[b] * ci + im[b] * cr
        re[b] = re[a] - tr
        im[b] = im[a] - ti
        re[a] += tr
        im[a] += ti
        const ncr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = ncr
      }
    }
  }
  const mags = new Float32Array(n / 2)
  for (let i = 0; i < n / 2; i++) mags[i] = Math.hypot(re[i], im[i])
  return mags
}

const FRAME = 2048
const HOP = 2048
const BANDS = 32

/** 每一帧 32 个对数频带的能量，L2 归一化；另给每帧的响度。 */
function features(
  mono: Float32Array,
  sampleRate: number
): { vecs: Float32Array[]; rms: Float32Array } {
  const count = Math.max(0, Math.floor((mono.length - FRAME) / HOP) + 1)
  const window = new Float32Array(FRAME)
  for (let i = 0; i < FRAME; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1))
  const binHz = sampleRate / FRAME
  const edges: number[] = []
  for (let b = 0; b <= BANDS; b++)
    edges.push(Math.max(1, Math.round((60 * Math.pow(11000 / 60, b / BANDS)) / binHz)))
  const vecs: Float32Array[] = []
  const rms = new Float32Array(count)
  const buf = new Float32Array(FRAME)
  for (let f = 0; f < count; f++) {
    let sq = 0
    for (let i = 0; i < FRAME; i++) {
      const s = mono[f * HOP + i]
      buf[i] = s * window[i]
      sq += s * s
    }
    rms[f] = Math.sqrt(sq / FRAME)
    const mags = fftMagnitudes(buf)
    const v = new Float32Array(BANDS)
    let norm = 0
    for (let b = 0; b < BANDS; b++) {
      let e = 0
      for (let k = edges[b]; k < Math.max(edges[b] + 1, edges[b + 1]) && k < mags.length; k++)
        e += mags[k] * mags[k]
      v[b] = Math.log1p(e)
      norm += v[b] * v[b]
    }
    norm = Math.sqrt(norm) || 1
    for (let b = 0; b < BANDS; b++) v[b] /= norm
    vecs.push(v)
  }
  return { vecs, rms }
}

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

export interface LoopPoints {
  /** 采样位置，循环区间 [start, end) */
  start: number
  end: number
  /** 0~1，跳转处前后几秒的相似度 */
  score: number
}

/**
 * 找循环区间。targetSeconds 给了就在它的 ±25% 内找；没给就尽量长（至少 8 秒）。
 */
export function findLoop(pcm: Pcm, targetSeconds?: number): LoopPoints {
  const { sampleRate } = pcm
  const mono = mixDown(pcm)
  const { vecs, rms } = features(mono, sampleRate)
  const hopSec = HOP / sampleRate
  const W = Math.max(8, Math.round(1.5 / hopSec)) // 比较窗：跳转后 1.5 秒
  const n = vecs.length
  if (n < W * 3) throw new Error('The track is too short to loop.')

  const sortedRms = Array.from(rms).sort((a, b) => a - b)
  const median = sortedRms[Math.floor(sortedRms.length / 2)]
  // 结尾淡出段不能当循环终点：那里的响度掉到一半以下
  const loudEnough = (f: number): boolean => {
    let s = 0
    for (let k = 0; k < W; k++) s += rms[f + k]
    return s / W >= median * 0.5
  }

  const aMax = Math.min(Math.floor(n * 0.3), Math.round(20 / hopSec))
  const lengthFrames = (sec: number): number => Math.round(sec / hopSec)
  const minLen = targetSeconds
    ? lengthFrames(targetSeconds * 0.75)
    : Math.max(lengthFrames(8), Math.floor(n * 0.35))
  const maxLen = targetSeconds ? lengthFrames(targetSeconds * 1.25) : n

  let best = { a: 0, b: 0, score: -Infinity }
  const consider = (a: number, b: number): void => {
    if (b + W > n || b - a < minLen || b - a > maxLen) return
    let s = 0
    for (let k = 0; k < W; k++) s += dot(vecs[a + k], vecs[b + k])
    s /= W
    // 同等相似时略偏向更长的循环，听着不那么重复
    const scored = s + 0.0002 * ((b - a) / n)
    if (scored > best.score && loudEnough(b)) best = { a, b, score: scored }
  }
  for (let a = 0; a <= aMax; a += 2) for (let b = a + minLen; b + W <= n; b += 2) consider(a, b)
  if (best.score === -Infinity)
    throw new Error(
      'No usable loop region was found (the track may be too short or fade out too early).'
    )
  // 在粗搜结果附近逐帧细化
  const coarse = best
  for (let a = Math.max(0, coarse.a - 2); a <= coarse.a + 2; a++) {
    for (let b = coarse.b - 2; b <= coarse.b + 2; b++) consider(a, b)
  }

  // 采样级对齐：在 ±1 帧内找让 end 之后的波形和 start 之后最吻合的偏移
  const start = best.a * HOP
  let end = best.b * HOP
  const span = 2048
  let bestOffset = 0
  let bestCorr = -Infinity
  for (let d = -HOP; d <= HOP; d++) {
    const e = end + d
    if (e < start + 1 || e + span > mono.length) continue
    let c = 0
    for (let i = 0; i < span; i += 2) c += mono[start + i] * mono[e + i]
    if (c > bestCorr) {
      bestCorr = c
      bestOffset = d
    }
  }
  end += bestOffset
  return { start, end, score: Math.max(0, Math.min(1, best.score)) }
}

function mixDown(pcm: Pcm): Float32Array {
  const len = pcm.channels[0].length
  const out = new Float32Array(len)
  for (const ch of pcm.channels) for (let i = 0; i < len; i++) out[i] += ch[i] / pcm.channels.length
  return out
}

/**
 * 裁到循环终点，并把终点前一小段淡化成「循环起点之前那一小段」的样子，跳回起点时连续。
 */
export function bakeLoop(pcm: Pcm, loop: LoopPoints, crossfadeSeconds = 0.05): Pcm {
  const fade = Math.min(
    Math.round(crossfadeSeconds * pcm.sampleRate),
    loop.start,
    loop.end - loop.start
  )
  const channels = pcm.channels.map((ch) => {
    const out = ch.slice(0, loop.end)
    for (let i = 0; i < fade; i++) {
      const t = (i + 1) / fade
      const at = loop.end - fade + i
      out[at] = ch[at] * (1 - t) + ch[loop.start - fade + i] * t
    }
    return out
  })
  return { channels, sampleRate: pcm.sampleRate }
}

/** 16 位 WAV；给了循环点就带 smpl 块（Godot 导入时自动识别为循环）。 */
export function encodeWav(pcm: Pcm, loop?: { start: number; end: number }): Buffer {
  const channels = pcm.channels.length
  const frames = pcm.channels[0].length
  const data = Buffer.alloc(frames * channels * 2)
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const s = Math.max(-1, Math.min(1, pcm.channels[c][i]))
      data.writeInt16LE(Math.round(s * 32767), (i * channels + c) * 2)
    }
  }
  const fmt = Buffer.alloc(24)
  fmt.write('fmt ', 0)
  fmt.writeUInt32LE(16, 4)
  fmt.writeUInt16LE(1, 8)
  fmt.writeUInt16LE(channels, 10)
  fmt.writeUInt32LE(pcm.sampleRate, 12)
  fmt.writeUInt32LE(pcm.sampleRate * channels * 2, 16)
  fmt.writeUInt16LE(channels * 2, 20)
  fmt.writeUInt16LE(16, 22)

  const chunks: Buffer[] = [fmt]
  if (loop) {
    const smpl = Buffer.alloc(8 + 36 + 24)
    smpl.write('smpl', 0)
    smpl.writeUInt32LE(36 + 24, 4)
    smpl.writeUInt32LE(Math.round(1e9 / pcm.sampleRate), 8 + 8) // 采样周期（纳秒）
    smpl.writeUInt32LE(60, 8 + 12) // MIDI unity note
    smpl.writeUInt32LE(1, 8 + 28) // 一个循环
    smpl.writeUInt32LE(0, 8 + 36 + 4) // 正向循环
    smpl.writeUInt32LE(loop.start, 8 + 36 + 8)
    smpl.writeUInt32LE(loop.end - 1, 8 + 36 + 12) // smpl 的终点含在循环内
    chunks.push(smpl)
  }
  const dataHeader = Buffer.alloc(8)
  dataHeader.write('data', 0)
  dataHeader.writeUInt32LE(data.length, 4)
  chunks.push(dataHeader, data)

  const body = Buffer.concat(chunks)
  const riff = Buffer.alloc(12)
  riff.write('RIFF', 0)
  riff.writeUInt32LE(4 + body.length, 4)
  riff.write('WAVE', 8)
  return Buffer.concat([riff, body])
}

/** 一步到位：MP3/WAV → 无缝循环的 WAV。 */
export async function makeLoopingWav(
  data: Buffer,
  ext: 'mp3' | 'wav',
  targetSeconds?: number
): Promise<{ wav: Buffer; loopStartSec: number; loopEndSec: number; score: number }> {
  const pcm = ext === 'mp3' ? await decodeMp3(data) : decodeWav(data)
  const loop = findLoop(pcm, targetSeconds)
  const baked = bakeLoop(pcm, loop)
  return {
    wav: encodeWav(baked, loop),
    loopStartSec: loop.start / pcm.sampleRate,
    loopEndSec: loop.end / pcm.sampleRate,
    score: loop.score
  }
}
