/**
 * @vitest-environment node
 *
 * Godot 资产生成工具。模型服务全部替身，加工管线走真的（sharp、切帧、找循环点）。
 *
 * 盯的是这几件容易悄悄坏掉的事：
 *   1. 产物落在 res://assets/gen/<类别>/，回执里给的是 res:// 路径，.tres 引用的也是它
 *   2. 工程风格真的套上了 —— 漏了不报错，只会出一张画风跑偏的图
 *   3. 原图 / 原曲留在 .gdbox/，生成记录写进 generations.jsonl
 *   4. 配音没变的台词不再花钱；中途失败第一句就说清几条成功几条失败
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const generateImages = vi.fn()
const resolveImageBinding = vi.fn()
const readSettings = vi.fn()
const generateTaskMusic = vi.fn()
const requestSpeech = vi.fn()

vi.mock('../../../ai/imageGeneration', () => ({
  generateImages: (...args: unknown[]) => generateImages(...args),
  resolveImageBinding: (...args: unknown[]) => resolveImageBinding(...args)
}))
vi.mock('../../../ai/store', () => ({ readSettings: () => readSettings() }))
vi.mock('../../../ai/music', () => ({
  generateTaskMusic: (...args: unknown[]) => generateTaskMusic(...args)
}))
vi.mock('../../../ai/speech', () => ({
  requestSpeech: (...args: unknown[]) => requestSpeech(...args)
}))

import { encodeWav, type Pcm } from '../../../godot/aigc/musicLoop'
import { blank, type Rgba } from '../../../godot/aigc/pixels'
import { seededRandom } from '../../../godot/aigc/sfxr'
import { godotAssetTools } from './index'

type AnyTool = {
  name: string
  description: string
  unrealBox: { namespace: string; risk: string; riskFor?: (args: unknown) => string }
  execute: (id: string, params: unknown, signal?: AbortSignal) => Promise<unknown>
}

const presets = mkdtempSync(join(tmpdir(), 'gdbox-presets-'))
const tools = godotAssetTools({ presetsDir: async () => presets }) as unknown as AnyTool[]
const tool = (name: string): AnyTool => tools.find((t) => t.name === name)!
const run = (name: string, params: Record<string, unknown>): Promise<unknown> =>
  tool(name).execute('call-1', params)

const textOf = (result: unknown): string =>
  (result as { content: { text?: string }[] }).content.map((part) => part.text ?? '').join('')
const imagesOf = (result: unknown): unknown[] =>
  (result as { content: { type: string }[] }).content.filter((part) => part.type === 'image')
const detailsOf = <T = Record<string, unknown>>(result: unknown): T =>
  (result as { details: T }).details

function newProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gdbox-proj-'))
  writeFileSync(join(dir, 'project.godot'), 'config_version=5\n')
  return dir
}

function fill(img: Rgba, x0: number, y0: number, w: number, h: number, rgb: number[]): void {
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) img.data.set([...rgb, 255], (y * img.width + x) * 4)
}

async function png(img: Rgba): Promise<string> {
  const bytes = await sharp(Buffer.from(img.data), {
    raw: { width: img.width, height: img.height, channels: 4 }
  })
    .png()
    .toBuffer()
  return bytes.toString('base64')
}

/** 品红底上一排四个小人：gen_sprite 默认要的 idle 4 帧 */
async function spriteSheet(): Promise<string> {
  const img = blank(256, 64)
  fill(img, 0, 0, 256, 64, [255, 0, 255])
  for (let i = 0; i < 4; i++) {
    fill(img, i * 64 + 20, 8, 24, 48, [40, 120, 200])
    fill(img, i * 64 + 26, 14, 12, 8, [240, 220, 180])
  }
  return png(img)
}

/** 两块整格瓦片 */
async function tileSheet(): Promise<string> {
  const img = blank(120, 60)
  fill(img, 0, 0, 120, 60, [255, 0, 255])
  fill(img, 10, 10, 40, 40, [120, 80, 40])
  fill(img, 70, 10, 40, 40, [90, 90, 90])
  return png(img)
}

/** 3 秒杂音前奏 + 4 秒乐句重复 6 遍：找得到循环点的曲子 */
function loopableSong(): Buffer {
  const SR = 22050
  const rand = seededRandom(5)
  const phrase = 4 * SR
  const notes = [220, 277, 330, 440, 392, 330, 294, 262]
  const intro = 3 * SR
  const out = new Float32Array(intro + phrase * 6)
  for (let i = 0; i < intro; i++) out[i] = (rand() * 2 - 1) * 0.3
  for (let i = intro; i < out.length; i++) {
    const note = notes[Math.floor((((i - intro) % phrase) / phrase) * notes.length)]
    out[i] = 0.5 * Math.sin((2 * Math.PI * note * i) / SR)
  }
  const pcm: Pcm = { channels: [out], sampleRate: SR }
  return encodeWav(pcm)
}

const IMAGE_PROVIDER = { id: 'ark', displayName: '火山方舟', kind: 'image', models: [] }

const SETTINGS = {
  providers: [
    { id: 'suno', displayName: 'SUNO', kind: 'music', models: [{ id: 'V4' }] },
    {
      id: 'doubao',
      displayName: '豆包语音',
      kind: 'tts',
      models: [{ id: 'seed-tts-2.0', ttsVoice: 'narrator' }]
    }
  ],
  roles: {
    music: { providerId: 'suno', modelId: 'V4' },
    tts: { providerId: 'doubao', modelId: 'seed-tts-2.0' }
  }
}

beforeEach(() => {
  generateImages.mockReset()
  resolveImageBinding
    .mockReset()
    .mockResolvedValue({ provider: IMAGE_PROVIDER, modelId: 'seedream-4' })
  readSettings.mockReset().mockResolvedValue(SETTINGS)
  generateTaskMusic.mockReset()
  requestSpeech.mockReset()
})

describe('元数据', () => {
  it('八个工具，命名空间和风险等级按约定', () => {
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        'art_style',
        'gen_music',
        'gen_sfx',
        'gen_sprite',
        'gen_sprite_video',
        'gen_tileset',
        'gen_voice',
        'inspect_audio'
      ].sort()
    )
    for (const t of tools) {
      if (t.name === 'art_style') expect(t.unrealBox.namespace).toBe('godot.style')
      else expect(t.unrealBox.namespace).toBe('godot.asset')
    }
    expect(tool('inspect_audio').unrealBox.risk).toBe('safe')
    expect(tool('gen_sprite').unrealBox.risk).toBe('mutating')
  })

  it('art_style 只看不改时降为 safe', () => {
    const riskFor = tool('art_style').unrealBox.riskFor!
    expect(riskFor({ action: 'show' })).toBe('safe')
    expect(riskFor({ action: 'list_presets' })).toBe('safe')
    expect(riskFor({ action: 'set' })).toBe('mutating')
  })

  it.each(['gen_sprite', 'gen_tileset', 'gen_music', 'gen_voice'])(
    '%s 说清写到哪、并把重做的决定权交回用户',
    (name) => {
      const description = tool(name).description
      expect(description).toContain('res://assets/gen/')
      expect(description).toContain('ask_user')
      expect(description).toContain('额度')
    }
  )
})

describe('工程目录', () => {
  it('不是 Godot 工程就报错，不往里写东西', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'not-godot-'))
    await expect(run('gen_sfx', { project_path: dir, name: 'jump', kind: 'jump' })).rejects.toThrow(
      /project\.godot/
    )
    expect(existsSync(join(dir, 'assets'))).toBe(false)
  })
})

describe('gen_sprite', () => {
  it('写出精灵表和 SpriteFrames，回 res:// 路径和预览图，套上工程风格', async () => {
    const project = newProject()
    mkdirSync(join(project, 'art'))
    writeFileSync(join(project, 'art', 'ref.png'), Buffer.from(await tileSheet(), 'base64'))
    await run('art_style', {
      project_path: project,
      action: 'set',
      prompt: 'moody 16-bit',
      palette: ['#2878c8', '#f0dcb4'],
      references: ['res://art/ref.png']
    })
    generateImages.mockResolvedValue([{ base64: await spriteSheet(), mediaType: 'image/png' }])

    const result = await run('gen_sprite', {
      project_path: project,
      name: 'Hero Knight',
      description: 'a knight'
    })

    const request = generateImages.mock.calls[0][0] as Record<string, unknown>
    expect(request.prompt).toContain('moody 16-bit. a knight')
    expect(request.providerId).toBe('ark')
    expect(request.modelId).toBe('seedream-4')
    expect((request.referenceImages as string[])[0]).toMatch(/^data:image\/png;base64,/)

    expect(detailsOf(result).outputs).toEqual([
      'res://assets/gen/sprites/hero_knight.png',
      'res://assets/gen/sprites/hero_knight.tres'
    ])
    expect(detailsOf<{ frame: { h: number } }>(result).frame.h).toBe(32)
    const tres = readFileSync(join(project, 'assets/gen/sprites/hero_knight.tres'), 'utf8')
    expect(tres).toContain('path="res://assets/gen/sprites/hero_knight.png"')
    expect(tres).toContain('&"idle"')
    expect(imagesOf(result)).toHaveLength(1)
    expect(textOf(result)).toContain('res://assets/gen/sprites/hero_knight.tres')

    const log = readFileSync(join(project, '.gdbox/generations.jsonl'), 'utf8')
    expect(JSON.parse(log.trim())).toMatchObject({
      tool: 'gen_sprite',
      api: '火山方舟',
      model: 'seedream-4'
    })
    expect(existsSync(join(project, '.gdbox/.gdignore'))).toBe(true)
  })

  it('没绑生图模型时把模型层的配置错误原样交给模型', async () => {
    resolveImageBinding.mockRejectedValue(
      new Error('尚未配置「生图」模型。请在 设置 → 模型 中添加')
    )
    await expect(
      run('gen_sprite', { project_path: newProject(), name: 'x', description: 'y' })
    ).rejects.toThrow(/设置 → 模型/)
    expect(generateImages).not.toHaveBeenCalled()
  })
})

describe('gen_tileset', () => {
  it('写出图集和 TileSet，按序号报图集坐标，passable 的不带碰撞', async () => {
    const project = newProject()
    generateImages.mockResolvedValue([{ base64: await tileSheet(), mediaType: 'image/png' }])
    const result = await run('gen_tileset', {
      project_path: project,
      name: 'cave',
      style: 'dark cave',
      tiles: ['dirt', 'stone'],
      tile_size: 8,
      passable: [1]
    })
    expect(detailsOf(result).outputs).toEqual([
      'res://assets/gen/sprites/cave.png',
      'res://assets/gen/sprites/cave.tres'
    ])
    expect(detailsOf(result).atlas).toEqual([
      { tile: 'dirt', x: 0, y: 0, collision: true },
      { tile: 'stone', x: 1, y: 0, collision: false }
    ])
    const tres = readFileSync(join(project, 'assets/gen/sprites/cave.tres'), 'utf8')
    expect(tres).toContain('0:0/0/physics_layer_0')
    expect(tres).not.toContain('1:0/0/physics_layer_0')
    expect(imagesOf(result)).toHaveLength(1)
  })
})

describe('gen_sfx 与 inspect_audio', () => {
  it('本地合成多个候选，不碰任何模型服务；inspect_audio 能量出来', async () => {
    const project = newProject()
    const result = await run('gen_sfx', {
      project_path: project,
      name: 'Coin',
      kind: 'coin',
      count: 2
    })
    expect(detailsOf(result).outputs).toEqual([
      'res://assets/gen/sfx/coin_1.wav',
      'res://assets/gen/sfx/coin_2.wav'
    ])
    expect(readSettings).not.toHaveBeenCalled()

    const facts = await run('inspect_audio', {
      project_path: project,
      path: 'res://assets/gen/sfx/coin_1.wav'
    })
    expect(textOf(facts)).toMatch(/Loudness: peak/)
    expect(detailsOf<{ seconds: number }>(facts).seconds).toBeGreaterThan(0)
  })

  it('inspect_audio 拒绝越出工程的路径', async () => {
    await expect(
      run('inspect_audio', { project_path: newProject(), path: 'res://../secret.wav' })
    ).rejects.toThrow(/越出/)
  })
})

describe('gen_music', () => {
  it('工作目录放在工程 .gdbox 下，裁成带循环点的 WAV', async () => {
    const project = newProject()
    generateTaskMusic.mockImplementation(async (...args: unknown[]) => {
      const dir = join(args[4] as string, 'music')
      mkdirSync(dir, { recursive: true })
      const file = join(dir, 'abc.wav')
      writeFileSync(file, loopableSong())
      return { path: file, tracks: [{ path: file }], reused: false }
    })

    const result = await run('gen_music', {
      project_path: project,
      name: 'Cave BGM',
      description: 'calm',
      seconds: 16
    })

    const call = generateTaskMusic.mock.calls[0]
    expect((call[0] as { id: string }).id).toBe('suno')
    expect(call[1]).toBe('V4')
    expect(call[3]).toBe(24) // 循环要多要一半给找循环点留余量
    expect(call[4]).toBe(join(project, '.gdbox'))
    expect(detailsOf(result).outputs).toEqual(['res://assets/gen/music/cave_bgm.wav'])
    expect(detailsOf<{ loop: { score: number } }>(result).loop.score).toBeGreaterThan(0.9)
    const wav = readFileSync(join(project, 'assets/gen/music/cave_bgm.wav'))
    expect(wav.indexOf('smpl')).toBeGreaterThan(0)
  })

  it('loop=false 按原格式存', async () => {
    const project = newProject()
    const file = join(project, 'raw.mp3')
    writeFileSync(file, Buffer.from('fake-mp3'))
    generateTaskMusic.mockResolvedValue({ path: file, tracks: [{ path: file }], reused: false })
    const result = await run('gen_music', {
      project_path: project,
      name: 'jingle',
      description: 'fanfare',
      seconds: 10,
      loop: false
    })
    expect(detailsOf(result).outputs).toEqual(['res://assets/gen/music/jingle.mp3'])
    expect(generateTaskMusic.mock.calls[0][3]).toBe(10)
  })

  it('没绑音乐模型就说去哪配，不发请求', async () => {
    readSettings.mockResolvedValue({ providers: [], roles: {} })
    await expect(
      run('gen_music', { project_path: newProject(), name: 'x', description: 'y' })
    ).rejects.toThrow(/音乐生成/)
    expect(generateTaskMusic).not.toHaveBeenCalled()
  })
})

describe('gen_voice', () => {
  const speakPcm =
    (samples: number) =>
    async (...args: unknown[]) => {
      const onAudio = args[4] as (chunk: { base64: string }) => void
      onAudio({ base64: Buffer.alloc(samples * 2).toString('base64') })
    }

  it('逐条写 WAV；音色按条换在模型配置上；没变的台词第二次不再合成', async () => {
    const project = newProject()
    requestSpeech.mockImplementation(speakPcm(24000))
    const lines = [
      { id: 'intro_01', text: '你好', voice: 'hero_voice' },
      { id: 'intro_02', text: '欢迎' }
    ]
    const first = await run('gen_voice', { project_path: project, lines })
    expect(detailsOf(first).generated).toEqual([
      'res://assets/gen/voice/intro_01.wav',
      'res://assets/gen/voice/intro_02.wav'
    ])
    const provider = requestSpeech.mock.calls[0][0] as { models: { ttsVoice?: string }[] }
    expect(provider.models[0].ttsVoice).toBe('hero_voice')
    expect((requestSpeech.mock.calls[1][0] as typeof provider).models[0].ttsVoice).toBe('narrator')
    const wav = readFileSync(join(project, 'assets/gen/voice/intro_01.wav'))
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
    expect(wav.readUInt32LE(24)).toBe(24000)
    expect(textOf(first)).toContain('1.0s')

    requestSpeech.mockClear()
    const second = await run('gen_voice', {
      project_path: project,
      lines: [lines[0], { id: 'intro_02', text: '欢迎回来' }]
    })
    expect(requestSpeech).toHaveBeenCalledTimes(1)
    expect(detailsOf(second).skipped).toEqual(['res://assets/gen/voice/intro_01.wav'])
  })

  it('中途失败：第一句报几条成功几条失败，已合成的照常交付', async () => {
    const project = newProject()
    requestSpeech
      .mockImplementationOnce(speakPcm(100))
      .mockRejectedValueOnce(new Error('TTS_HTTP_429'))
    const result = await run('gen_voice', {
      project_path: project,
      lines: [
        { id: 'a', text: '一' },
        { id: 'b', text: '二' },
        { id: 'c', text: '三' }
      ]
    })
    expect(textOf(result).startsWith('1 条成功 / 1 条失败，其后 1 条未合成')).toBe(true)
    expect(textOf(result)).toContain('TTS_HTTP_429')
    expect(existsSync(join(project, 'assets/gen/voice/a.wav'))).toBe(true)
    expect(requestSpeech).toHaveBeenCalledTimes(2)
  })

  it('一条都没成就按错误抛', async () => {
    requestSpeech.mockRejectedValue(new Error('TTS_HTTP_401'))
    await expect(
      run('gen_voice', { project_path: newProject(), lines: [{ id: 'a', text: '一' }] })
    ).rejects.toThrow(/TTS_HTTP_401/)
  })
})

describe('art_style', () => {
  it('set 只改给出的字段，存到工程 .gdbox/style.json', async () => {
    const project = newProject()
    await run('art_style', { project_path: project, action: 'set', pixel_art: true, tile_size: 16 })
    await run('art_style', { project_path: project, action: 'set', palette: ['#112233'] })
    const style = JSON.parse(readFileSync(join(project, '.gdbox/style.json'), 'utf8'))
    expect(style).toEqual({ pixelArt: true, tileSize: 16, palette: ['#112233'] })
    const shown = await run('art_style', { project_path: project, action: 'show' })
    expect(textOf(shown)).toContain('tile 16px')
  })

  it('颜色、参考图路径、预设名写错当场报', async () => {
    const project = newProject()
    await expect(
      run('art_style', { project_path: project, action: 'set', palette: ['red'] })
    ).rejects.toThrow(/#RRGGBB/)
    await expect(
      run('art_style', { project_path: project, action: 'set', references: ['../x.png'] })
    ).rejects.toThrow(/res:\/\//)
    await expect(
      run('art_style', { project_path: project, action: 'save_preset', preset: '../evil' })
    ).rejects.toThrow(/预设名/)
  })

  it('存成预设，另一个工程套用，参考图跟过去', async () => {
    const a = newProject()
    mkdirSync(join(a, 'art'))
    writeFileSync(join(a, 'art', 'look.png'), Buffer.from(await tileSheet(), 'base64'))
    await run('art_style', {
      project_path: a,
      action: 'set',
      prompt: 'cozy',
      references: ['res://art/look.png']
    })
    await run('art_style', { project_path: a, action: 'save_preset', preset: 'cozy_style' })
    const listed = await run('art_style', { project_path: a, action: 'list_presets' })
    expect(detailsOf(listed).presets).toContain('cozy_style')

    const b = newProject()
    await run('art_style', { project_path: b, action: 'load_preset', preset: 'cozy_style' })
    const style = JSON.parse(readFileSync(join(b, '.gdbox/style.json'), 'utf8'))
    expect(style.prompt).toBe('cozy')
    expect(style.references).toEqual(['res://assets/style/look.png'])
    expect(existsSync(join(b, 'assets/style/look.png'))).toBe(true)
  })

  it('palette_from 从图里取调色板', async () => {
    const project = newProject()
    writeFileSync(join(project, 'pick.png'), Buffer.from(await tileSheet(), 'base64'))
    const result = await run('art_style', {
      project_path: project,
      action: 'set',
      palette_from: 'res://pick.png'
    })
    const palette = detailsOf<{ style: { palette: string[] } }>(result).style.palette
    expect(palette.length).toBeGreaterThanOrEqual(3)
    expect(palette.every((c) => /^#[0-9a-f]{6}$/.test(c))).toBe(true)
  })
})
