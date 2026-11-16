/** @vitest-environment node */
import { promises as fs } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const isolated = {
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
    webRequest: { onBeforeRequest: vi.fn() },
    protocol: { handle: vi.fn(), unhandle: vi.fn() }
  }
  const window = {
    loadURL: vi.fn(),
    isDestroyed: vi.fn(() => false),
    destroy: vi.fn(),
    webContents: {
      setAudioMuted: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      executeJavaScript: vi.fn()
    }
  }
  return {
    isolated,
    window,
    fromPartition: vi.fn(() => isolated),
    BrowserWindow: vi.fn(function () {
      return window
    })
  }
})
vi.mock('electron', () => ({
  BrowserWindow: mocks.BrowserWindow,
  session: { fromPartition: mocks.fromPartition }
}))

import { chromiumContactSheets, frameTimes } from './chromiumFrames'
import { cleanupContactSheets } from './videoFrameFallback'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.fromPartition.mockImplementation(() => mocks.isolated)
  mocks.window.webContents.executeJavaScript.mockReset()
})

describe('frameTimes', () => {
  it('短片子每秒两帧，取每段中点避开黑场', () => {
    expect(frameTimes(2)).toEqual([0.25, 0.75, 1.25, 1.75])
  })

  it('长片子总数压在两张联系表以内，且覆盖到片尾', () => {
    const times = frameTimes(600)
    expect(times).toHaveLength(48)
    expect(times[times.length - 1]).toBeGreaterThan(590)
  })

  it('不到半秒的片子也至少抽一帧', () => {
    expect(frameTimes(0.2)).toHaveLength(1)
  })
})

describe('Chromium 抽帧边界', () => {
  it('隔离网络与权限，成功后释放窗口和协议，联系表留给调用方清理', async () => {
    mocks.window.webContents.executeJavaScript
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce({ sheets: ['data:image/jpeg;base64,aW1hZ2U='] })
    const result = await chromiumContactSheets('C:/video.mp4')
    try {
      expect(result).toMatchObject({ success: true, frameCount: 4, labeled: true })
      expect(await fs.readFile(result.sheetPaths![0]!, 'utf8')).toBe('image')
      const filter = mocks.isolated.webRequest.onBeforeRequest.mock.calls[0]![0]
      const callback = vi.fn()
      filter({ url: 'https://example.com/' }, callback)
      expect(callback).toHaveBeenLastCalledWith({ cancel: true })
      filter({ url: 'local-resource://video-frames/video' }, callback)
      expect(callback).toHaveBeenLastCalledWith({ cancel: false })
      expect(mocks.BrowserWindow).toHaveBeenCalledWith(
        expect.objectContaining({
          show: false,
          webPreferences: expect.objectContaining({ sandbox: true, nodeIntegration: false })
        })
      )
      expect(mocks.window.destroy).toHaveBeenCalledOnce()
      expect(mocks.isolated.protocol.unhandle).toHaveBeenCalledWith('local-resource')
    } finally {
      await cleanupContactSheets(result.sheetPaths ?? [])
    }
  })

  it('无 Electron 会话时返回失败，让调用方继续尝试 FFmpeg', async () => {
    mocks.fromPartition.mockImplementation(() => {
      throw new Error('session unavailable')
    })
    await expect(chromiumContactSheets('C:/video.mp4')).resolves.toEqual({
      success: false,
      error: 'session unavailable'
    })
    expect(mocks.BrowserWindow).not.toHaveBeenCalled()
  })

  it('解码失败也释放窗口和协议', async () => {
    mocks.window.webContents.executeJavaScript.mockRejectedValueOnce(new Error('decode failed'))
    await expect(chromiumContactSheets('C:/video.mp4')).resolves.toEqual({
      success: false,
      error: 'decode failed'
    })
    expect(mocks.window.destroy).toHaveBeenCalledOnce()
    expect(mocks.isolated.protocol.unhandle).toHaveBeenCalledWith('local-resource')
  })
})
