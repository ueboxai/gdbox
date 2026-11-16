import { beforeEach, describe, expect, it, vi } from 'vitest'

const { settings, install } = vi.hoisted(() => ({
  settings: {
    setEditorLinkInstallPromptShown: vi.fn(),
    setAutoEnableEditorLink: vi.fn(),
    isEditorLinkOptedOut: vi.fn(() => false)
  },
  install: vi.fn()
}))

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))
vi.mock('../index', () => ({ getPublicDatabase: vi.fn() }))
vi.mock('../../appSettingsManager', () => ({ appSettingsManager: settings }))
vi.mock('../../appWindows', () => ({ getAppWindows: () => [] }))
vi.mock('../../services/project/projectCoverRuntime', () => ({ getProjectCoverService: vi.fn() }))
vi.mock('../../godot/editorLinkAddon', () => ({
  bundledAddonVersion: vi.fn(),
  installEditorLink: install,
  isEditorLinkInstalled: vi.fn(),
  readAddonVersion: vi.fn()
}))

const { answerEditorLinkInstallPrompt } = await import('./project')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('answerEditorLinkInstallPrompt', () => {
  it('暂不安装：记成问过，不打开自动安装，也不装', async () => {
    expect(await answerEditorLinkInstallPrompt(false, ['D:/Games/a'])).toEqual([])
    expect(settings.setEditorLinkInstallPromptShown).toHaveBeenCalledWith(true)
    expect(settings.setAutoEnableEditorLink).not.toHaveBeenCalled()
    expect(install).not.toHaveBeenCalled()
  })

  it('安装：打开自动安装，给这批工程都装上，装失败的原样交回', async () => {
    install.mockImplementation((dir: string) => {
      if (dir.endsWith('b')) throw new Error('EACCES')
      return true
    })

    const failures = await answerEditorLinkInstallPrompt(true, ['D:/Games/a', 'D:/Games/b'])

    expect(settings.setEditorLinkInstallPromptShown).toHaveBeenCalledWith(true)
    expect(settings.setAutoEnableEditorLink).toHaveBeenCalledWith(true)
    expect(install).toHaveBeenCalledTimes(2)
    expect(failures).toEqual([{ projectPath: 'D:/Games/b', reason: 'EACCES' }])
  })
})
