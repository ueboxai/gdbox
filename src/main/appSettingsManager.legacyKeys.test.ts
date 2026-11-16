/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 旧版本（从虚幻盒子分叉时带过来的）键名和取值：改名之后老用户的选择不能丢。
 * 关掉的自动安装、拒绝过的工程要是被当成默认值，插件就又被装回去了。
 */
const disk = vi.hoisted(() => ({ text: '{}' }))
vi.mock('electron', () => ({ app: { getPath: () => '/test-settings' } }))
vi.mock('./services', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }))
vi.mock('fs', () => ({
  existsSync: () => true,
  readFileSync: () => disk.text,
  writeFileSync: (_path: string, text: string) => {
    disk.text = text
  }
}))

beforeEach(() => {
  vi.resetModules()
  disk.text = '{}'
})

describe('旧键名迁移', () => {
  it('旧键里关掉的自动安装和拒绝名单照样生效，写回时换成新键', async () => {
    disk.text = JSON.stringify({
      autoEnableUnrealAgentLink: false,
      ualinkOptOutProjects: ['D:/Games/Demo'],
      agentFileAccessScope: 'ue-only'
    })
    const { appSettingsManager } = await import('./appSettingsManager')
    expect(appSettingsManager.getAutoEnableEditorLink()).toBe(false)
    expect(appSettingsManager.isEditorLinkOptedOut('D:/Games/Demo')).toBe(true)
    expect(appSettingsManager.getAgentFileAccessScope()).toBe('project-only')

    appSettingsManager.setGodotPath('')
    const saved = JSON.parse(disk.text)
    expect(saved).toMatchObject({
      autoEnableEditorLink: false,
      editorLinkOptOutProjects: ['D:/Games/Demo'],
      agentFileAccessScope: 'project-only'
    })
    expect(saved).not.toHaveProperty('autoEnableUnrealAgentLink')
    expect(saved).not.toHaveProperty('ualinkOptOutProjects')
  })

  it('新键在的时候以新键为准', async () => {
    disk.text = JSON.stringify({ autoEnableEditorLink: true, autoEnableUnrealAgentLink: false })
    const { appSettingsManager } = await import('./appSettingsManager')
    expect(appSettingsManager.getAutoEnableEditorLink()).toBe(true)
  })

  it('两个键都没有：默认自动安装，访问范围默认整台电脑', async () => {
    const { appSettingsManager } = await import('./appSettingsManager')
    expect(appSettingsManager.getAutoEnableEditorLink()).toBe(true)
    expect(appSettingsManager.getAgentFileAccessScope()).toBe('full')
  })
})
