import { beforeEach, expect, it, vi } from 'vitest'
import { requireGodot, resetGodotCacheForTest } from './project'

const { settings, locate } = vi.hoisted(() => ({
  settings: {
    getGodotPath: vi.fn(() => ''),
    getGodotEngines: () => ['registered'],
    setGodotPath: vi.fn()
  },
  locate: vi.fn()
}))
vi.mock('../../../appSettingsManager', () => ({ appSettingsManager: settings }))
vi.mock('../../../godot/locate', () => ({ locateGodot: locate }))

beforeEach(() => {
  vi.clearAllMocks()
  resetGodotCacheForTest()
  settings.getGodotPath.mockReturnValue('')
})

it('adopts the verified executable and returns it for the pending tool call', async () => {
  const info = { path: 'D:\\Godot_v4.7.2-stable_win64.exe', version: '4.7.2.stable' }
  locate.mockResolvedValue(info)
  await expect(requireGodot()).resolves.toEqual(info)
  expect(locate).toHaveBeenCalledWith('', ['registered'])
  expect(settings.setGodotPath).toHaveBeenCalledWith(info.path)
})

it('preserves an explicit choice made during discovery', async () => {
  settings.getGodotPath.mockReturnValueOnce('').mockReturnValue('manual')
  locate.mockResolvedValue({ path: 'detected', version: '4.7' })
  await requireGodot()
  expect(settings.setGodotPath).not.toHaveBeenCalled()
})

it('leaves settings empty after an unsuccessful search', async () => {
  locate.mockResolvedValue(null)
  await expect(requireGodot()).rejects.toThrow('Godot 4')
  expect(settings.setGodotPath).not.toHaveBeenCalled()
})
