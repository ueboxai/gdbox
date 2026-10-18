/** @vitest-environment node */
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ali = {
  id: 'alibaba-tts',
  kind: 'tts',
  baseUrl: 'wss://dashscope.aliyuncs.com/api-ws/v1/inference',
  apiKey: { kind: 'none' },
  models: [{ id: 'qwen-audio-3.0-tts-plus', ttsVoice: 'longanlingxin' }]
}
const doubao = {
  id: 'doubao-tts',
  kind: 'tts',
  baseUrl: 'https://openspeech.bytedance.com/x',
  apiKey: { kind: 'none' },
  models: [{ id: 'seed-tts-2.0', ttsVoice: 'narrator' }]
}
const mocks = vi.hoisted(() => ({
  tts: { providerId: 'alibaba-tts', modelId: 'qwen-audio-3.0-tts-plus' },
  create: vi.fn(),
  query: vi.fn(async () => 'OK'),
  remove: vi.fn(async () => {}),
  speakToFile: vi.fn(async (_b: unknown, _t: string, dir: string) => ({
    path: `${dir}/line.pcm`,
    seconds: 1
  })),
  speak: vi.fn(async (...args: unknown[]) => {
    const onAudio = args[4] as (chunk: { base64: string }) => void
    onAudio({ base64: Buffer.alloc(4800).toString('base64') })
  })
}))
vi.mock('../../../ai/store', () => ({
  readSettings: async () => ({ roles: { tts: mocks.tts }, providers: [ali, doubao] })
}))
vi.mock('../../../ai/credentials', () => ({ resolveApiKey: async () => 'key' }))
vi.mock('../../../ai/speechVoiceDesign', async (original) => ({
  ...(await original<typeof import('../../../ai/speechVoiceDesign')>()),
  createDesignedVoice: mocks.create,
  queryDesignedVoice: mocks.query,
  deleteDesignedVoice: mocks.remove
}))
vi.mock('../../core/projectTargetContext', () => ({
  getCurrentSessionId: () => 'session',
  getSessionProjectPath: () => project,
  getTargetProjectPath: () => undefined
}))
vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))
vi.mock('../../../services/taskVideo/audio', () => ({
  resolveSpeechBinding: async () => undefined,
  speakToFile: mocks.speakToFile,
  pcmToWav: async () => {}
}))
vi.mock('../../../ai/speech', async (original) => ({
  ...(await original<typeof import('../../../ai/speech')>()),
  requestSpeech: mocks.speak
}))
import { voiceDesignTools } from './voiceDesign'
import { createGenVoiceTool } from './genVoice'
import { taskVideoTools } from '../builtin/taskVideo'

type AnyTool = {
  name: string
  unrealBox: { namespace: string; requiresExplicitApproval?: boolean }
  execute: (
    id: string,
    params: unknown
  ) => Promise<{ details: unknown; content: { text?: string }[] }>
}
const tools = [...voiceDesignTools(), createGenVoiceTool()] as unknown as AnyTool[]
const run = (name: string, params: Record<string, unknown>): ReturnType<AnyTool['execute']> =>
  tools.find((t) => t.name === name)!.execute('call', { project_path: project, ...params })
const readCast = async (): Promise<Record<string, Record<string, { voiceId: string }>>> =>
  JSON.parse(await fs.readFile(path.join(project, '.gdbox', 'voices.json'), 'utf8')).roles
const design = (role = '老铁匠'): ReturnType<AnyTool['execute']> =>
  run('design_voice', {
    role,
    description: '五十岁男性铁匠，嗓音低沉沙哑',
    line: '离我的炉子远点，小子，烫着了可别哭。'
  })

let project = ''
beforeEach(async () => {
  project = await fs.mkdtemp(path.join(tmpdir(), 'gdbox-voice-'))
  await fs.writeFile(path.join(project, 'project.godot'), 'config_version=5\n')
  mocks.tts = { providerId: 'alibaba-tts', modelId: 'qwen-audio-3.0-tts-plus' }
  let n = 0
  mocks.create.mockImplementation(async () => ({
    voiceId: `voice-0000000${++n}`,
    preview: Buffer.from('RIFF')
  }))
})
afterEach(async () => {
  await fs.rm(project, { recursive: true, force: true })
  vi.clearAllMocks()
  mocks.query.mockResolvedValue('OK')
})

describe('角色音色（GDBox）', () => {
  it('试听写进工程 .gdbox/voices/，不进 res://；回执带播放器要的 path 和 title', async () => {
    const result = await design()
    const role = (await readCast())['老铁匠']
    expect(role.candidate.voiceId).toBe('voice-00000001')
    const details = result.details as { path: string; title: string }
    expect(details.title).toBe('老铁匠 · 试听')
    expect(details.path.startsWith(path.join(project, '.gdbox', 'voices'))).toBe(true)
    expect(await fs.readFile(details.path, 'utf8')).toBe('RIFF')
  })

  it('三个工具在 godot.asset 下；采用每次都要用户确认', () => {
    for (const name of ['design_voice', 'adopt_voice', 'list_voices'])
      expect(tools.find((t) => t.name === name)!.unrealBox.namespace).toBe('godot.asset')
    expect(tools.find((t) => t.name === 'adopt_voice')!.unrealBox.requiresExplicitApproval).toBe(
      true
    )
  })

  it('不是 Godot 工程直接报错，不往里写', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'not-godot-'))
    await expect(
      voiceDesignTools()
        .find((t) => t.name === 'list_voices')!
        .execute('call', { project_path: dir })
    ).rejects.toThrow('project.godot')
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('gen_voice：试听中的角色不能配；采用后按角色的音色和模型合成，演法生效', async () => {
    await design()
    const lines = [{ id: 'smith_01', text: '站住！', role: '老铁匠', style: '愤怒地吼出来' }]
    await expect(run('gen_voice', { lines })).rejects.toThrow('还在试听')
    expect(mocks.speak).not.toHaveBeenCalled()

    await run('adopt_voice', { role: '老铁匠' })
    mocks.tts = { providerId: 'doubao-tts', modelId: 'seed-tts-2.0' }
    const result = await run('gen_voice', {
      lines: [...lines, { id: 'narr_01', text: '夜深了。', style: '轻声' }]
    })
    const [first, second] = mocks.speak.mock.calls as unknown as [
      { id: string },
      string,
      ...unknown[]
    ][]
    expect(first[0].id).toBe('alibaba-tts')
    expect(first[1]).toBe('qwen-audio-3.0-tts-plus')
    expect(first[5]).toEqual({ voice: 'voice-00000001', instruction: '愤怒地吼出来' })
    // 豆包不认演法：照常合成，回执说明
    expect(second[0].id).toBe('doubao-tts')
    expect(second[5]).toEqual({ voice: 'narrator', instruction: undefined })
    expect((result.details as { styleIgnored?: string[] }).styleIgnored).toEqual(['narr_01'])
    expect(result.content.map((c) => c.text).join('')).toContain('不认演法')
  })

  it('gen_voice：未知角色在花钱前报错并列出已有角色', async () => {
    await design('旁白')
    await run('adopt_voice', { role: '旁白' })
    await expect(
      run('gen_voice', { lines: [{ id: 'a', text: '你好', role: '村长' }] })
    ).rejects.toThrow('已有：旁白')
    expect(mocks.speak).not.toHaveBeenCalled()
  })

  it('generate_speech 的 role 用这条对话所属工程的音色表', async () => {
    await design()
    await run('adopt_voice', { role: '老铁匠' })
    const speech = taskVideoTools().find((t) => t.name === 'generate_speech')!
    const result = await speech.execute('s', { text: '站住！', role: '老铁匠', style: '呵斥' })
    const [binding, , , , , options] = mocks.speakToFile.mock.calls[0] as unknown as [
      { provider: { id: string } },
      ...unknown[]
    ]
    expect(binding.provider.id).toBe('alibaba-tts')
    expect(options).toEqual({ voice: 'voice-00000001', instruction: '呵斥' })
    expect(result.details).toMatchObject({ role: '老铁匠', style_applied: true })
  })
})
