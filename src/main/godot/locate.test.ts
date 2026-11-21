import { expect, it, vi } from 'vitest'
import { win32 } from 'node:path'
import { locateGodot } from './locate'

const portable = vi.hoisted(() => 'Godot_v4.7.2-stable_win64.exe')

vi.mock('node:fs', () => ({
  existsSync: (path: string) => path === 'D:\\',
  readdirSync: () => [portable, 'GodotInstaller.exe'],
  realpathSync: (path: string) => path
}))
vi.mock('node:child_process', () => ({
  execFile: (
    cmd: string,
    args: string[],
    _options: unknown,
    done: (err: Error | null, stdout: string) => void
  ) => {
    if (cmd.endsWith('powershell.exe')) return done(null, 'C:\\\r\nD:\\\r\n')
    if (cmd === win32.join('D:\\', portable) && args[0] === '--version')
      return done(null, '4.7.2.stable.official')
    done(new Error('missing'), '')
  }
}))

it.skipIf(process.platform !== 'win32')(
  'discovers a portable editor on a secondary fixed drive when PATH is empty',
  async () => {
    await expect(locateGodot()).resolves.toEqual({
      path: win32.join('D:\\', portable),
      version: '4.7.2.stable.official'
    })
  }
)
