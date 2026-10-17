/** @vitest-environment node */
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), access: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))
vi.mock('node:fs/promises', async (original) => ({
  ...(await original<object>()),
  access: mocks.access
}))
import { NodeExecutionEnv } from './nodejs'

const wsl = 'C:\\Windows\\System32\\bash.exe'
const gitBash = 'D:\\Git\\bin\\bash.exe'
let matches: string[]

beforeEach(() => {
  vi.stubGlobal('process', {
    ...process,
    platform: 'win32',
    env: { ...process.env, ProgramFiles: undefined, 'ProgramFiles(x86)': undefined }
  })
  matches = [wsl, gitBash]
  mocks.access.mockReset().mockResolvedValue(undefined)
  mocks.spawn.mockReset().mockImplementation((command: string) => {
    if (command !== 'where') throw new Error('selected shell boundary')
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough() })
    queueMicrotask(() => {
      child.stdout.end(matches.join('\r\n'))
      child.emit('close', 0)
    })
    return child
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('Windows shell 选择', () => {
  it('PATH 上 WSL 排在前面也选择后面的原生 bash', async () => {
    await new NodeExecutionEnv({ cwd: 'C:/project' }).exec('echo ok')
    expect(mocks.spawn.mock.calls.map(([command]) => command)).toEqual(['where', gitBash])
  })

  it('只有 WSL 时报告没有可用 shell，不启动它', async () => {
    matches = [wsl]
    const result = await new NodeExecutionEnv({ cwd: 'C:/project' }).exec('echo ok')
    expect(result).toMatchObject({ ok: false, error: { code: 'shell_unavailable' } })
    expect(mocks.spawn).toHaveBeenCalledOnce()
  })

  it('显式指定 WSL 时保留用户选择', async () => {
    await new NodeExecutionEnv({ cwd: 'C:/project', shellPath: wsl }).exec('echo ok')
    expect(mocks.spawn).toHaveBeenCalledWith(wsl, ['-s'], expect.any(Object))
  })
})
