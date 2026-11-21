/** @vitest-environment node */
import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `shell:openProject` 用 Godot 编辑器打开工程：
 * `services/project/openProject.ts` 起 `godot --editor --path <工程目录>`，打开前先装 GDBox Link。
 *
 * 「打开工程后隐藏主界面」的判定在主进程这一侧，覆盖所有从盒子启动工程的入口
 * （项目卡片双击、合集里双击、右键菜单的「启动」、托盘最近项目）。
 *
 * 两条不能破的线：设置关着时绝不动窗口；启动失败时也绝不动窗口（否则用户面对
 * 一个空桌面：编辑器没起来，那句错误提示也跟着窗口一起没了）。
 */

const handlers = new Map<string, (...args: unknown[]) => unknown>()
const existsSync = vi.fn<(path: string) => boolean>()
const getHideWindowOnProjectLaunch = vi.fn<() => boolean>()
const getAutoEnableLink = vi.fn<() => boolean>()
const hide = vi.fn()
const isDestroyed = vi.fn<() => boolean>()
const findMainWindow = vi.fn<() => unknown>()
const installEditorLink = vi.fn<(dir: string) => void>()
const locateGodot = vi.fn<() => Promise<{ path: string } | null>>()
const getInteractiveProjects = vi.fn<() => { projectPath: string }[]>()
/** 下一次 spawn 要报的错；undefined 表示进程正常起来 */
let spawnError: string | undefined
const spawn = vi.fn<(cmd: string, args: string[]) => EventEmitter>(() => {
  const child = Object.assign(new EventEmitter(), { unref: vi.fn() })
  queueMicrotask(() =>
    spawnError ? child.emit('error', new Error(spawnError)) : child.emit('spawn')
  )
  return child
})

vi.mock('electron', () => ({
  app: { getApplicationNameForProtocol: () => '', getPath: () => '', getAppPath: () => '' },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }
  },
  shell: { openPath: vi.fn(), showItemInFolder: vi.fn(), openExternal: vi.fn() }
}))

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  const overrides = {
    existsSync: (path: string) => existsSync(path),
    statSync: () => ({ isFile: () => false })
  }
  return { ...actual, ...overrides, default: { ...actual, ...overrides } }
})
vi.mock('child_process', () => ({
  spawn: (cmd: string, args: string[]) => spawn(cmd, args),
  default: { spawn: (cmd: string, args: string[]) => spawn(cmd, args) }
}))

vi.mock('../appSettingsManager', () => ({
  appSettingsManager: {
    shouldInstallEditorLink: () => getAutoEnableLink(),
    getGodotPath: () => '',
    getHideWindowOnProjectLaunch: () => getHideWindowOnProjectLaunch()
  }
}))
vi.mock('../appWindows', () => ({ findMainWindow: () => findMainWindow() }))
vi.mock('../godot/editorLinkAddon', () => ({
  installEditorLink: (dir: string) => installEditorLink(dir)
}))
vi.mock('../godot/locate', () => ({ locateGodot: () => locateGodot() }))
vi.mock('../services/project/projectManager', () => ({
  projectManager: { getInteractiveProjects: () => getInteractiveProjects() }
}))
vi.mock('../security', () => ({ openSafeExternalUrl: vi.fn() }))

const { registerShellIPC } = await import('./shell')
registerShellIPC()

const GODOT = 'C:/Godot/Godot_v4.4-stable_win64.exe'

beforeEach(() => {
  vi.clearAllMocks()
  spawnError = undefined
  existsSync.mockReturnValue(true)
  isDestroyed.mockReturnValue(false)
  findMainWindow.mockReturnValue({ hide, isDestroyed })
  locateGodot.mockResolvedValue({ path: GODOT })
  getAutoEnableLink.mockReturnValue(false)
  getInteractiveProjects.mockReturnValue([])
})

async function openProject(path = 'D:/Demo/project.godot'): Promise<unknown> {
  return handlers.get('shell:openProject')!({}, path)
}

describe('shell:openProject · 用 Godot 编辑器打开', () => {
  it('起 Godot 时带 --editor --path <工程目录>，传 project.godot 和传目录一样', async () => {
    await expect(openProject('D:/Demo/project.godot')).resolves.toEqual({ success: true })
    await expect(openProject('D:/Demo')).resolves.toEqual({ success: true })

    expect(spawn).toHaveBeenCalledTimes(2)
    for (const [cmd, args] of spawn.mock.calls) {
      expect(cmd).toBe(GODOT)
      expect(args).toEqual(['--editor', '--path', 'D:/Demo'])
    }
  })

  it('找不到 Godot 时说清楚去哪里指定，不起进程也不藏窗口', async () => {
    getHideWindowOnProjectLaunch.mockReturnValue(true)
    locateGodot.mockResolvedValue(null)

    const result = (await openProject()) as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('Godot')
    expect(spawn).not.toHaveBeenCalled()
    expect(hide).not.toHaveBeenCalled()
  })

  it('设置开着时先装 GDBox Link 再起编辑器', async () => {
    getAutoEnableLink.mockReturnValue(true)

    await expect(openProject()).resolves.toEqual({ success: true })
    expect(installEditorLink).toHaveBeenCalledWith('D:/Demo')
    expect(installEditorLink.mock.invocationCallOrder[0]).toBeLessThan(
      spawn.mock.invocationCallOrder[0]
    )
  })

  it('插件装不上不拖垮打开，但原因要带回去', async () => {
    getAutoEnableLink.mockReturnValue(true)
    installEditorLink.mockImplementation(() => {
      throw new Error('addons 目录只读')
    })

    await expect(openProject()).resolves.toEqual({
      success: true,
      pluginFailure: 'addons 目录只读'
    })
    expect(spawn).toHaveBeenCalledTimes(1)
  })
})

describe('shell:openProject · 打开工程后隐藏主界面', () => {
  it('设置开着时把主界面收起来', async () => {
    getHideWindowOnProjectLaunch.mockReturnValue(true)

    await expect(openProject()).resolves.toEqual({ success: true })
    expect(hide).toHaveBeenCalledTimes(1)
  })

  it('设置关着时不碰窗口', async () => {
    getHideWindowOnProjectLaunch.mockReturnValue(false)

    await expect(openProject()).resolves.toEqual({ success: true })
    expect(hide).not.toHaveBeenCalled()
  })

  it('编辑器没起来就不藏 —— 否则错误提示跟着窗口一起消失', async () => {
    getHideWindowOnProjectLaunch.mockReturnValue(true)
    spawnError = 'spawn EACCES'

    await expect(openProject()).resolves.toEqual({ success: false, error: 'spawn EACCES' })
    expect(hide).not.toHaveBeenCalled()
  })

  it('工程被删了要报「文件不存在」，不能把系统那句 Failed to open path 甩给用户', async () => {
    getHideWindowOnProjectLaunch.mockReturnValue(true)
    getAutoEnableLink.mockReturnValue(true)
    existsSync.mockReturnValue(false)

    await expect(openProject()).resolves.toEqual({
      success: false,
      error: '工程文件不存在',
      pathNotFound: true
    })
    // 文件都没了就别再去装插件、起编辑器，也别碰窗口
    expect(installEditorLink).not.toHaveBeenCalled()
    expect(spawn).not.toHaveBeenCalled()
    expect(hide).not.toHaveBeenCalled()
  })

  it('主窗口已经不在了也不报错', async () => {
    getHideWindowOnProjectLaunch.mockReturnValue(true)
    findMainWindow.mockReturnValue(undefined)

    await expect(openProject()).resolves.toEqual({ success: true })
    expect(hide).not.toHaveBeenCalled()
  })
})

describe('shell:openProject · 导入弹窗替用户打开工程', () => {
  const openForImport = (): Promise<unknown> =>
    handlers.get('shell:openProject')!({}, 'D:/Demo/project.godot', {
      forImport: true
    }) as Promise<unknown>

  it('不藏主界面：用户正等着导入开始', async () => {
    getHideWindowOnProjectLaunch.mockReturnValue(true)

    await expect(openForImport()).resolves.toEqual({ success: true })
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(hide).not.toHaveBeenCalled()
  })

  it('编辑器已经连着就不再起一个，只等它连上（路径大小写、分隔符不同也认得）', async () => {
    getInteractiveProjects.mockReturnValue([{ projectPath: 'd:\\demo' }])

    await expect(openForImport()).resolves.toEqual({ success: true, alreadyRunning: true })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('首页的打开不查连接 —— 那边有自己的「再启动一次」确认', async () => {
    getInteractiveProjects.mockReturnValue([{ projectPath: 'D:/Demo' }])

    await expect(openProject()).resolves.toEqual({ success: true })
    expect(spawn).toHaveBeenCalledTimes(1)
  })
})
