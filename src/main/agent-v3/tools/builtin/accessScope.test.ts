import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 来源全部换成桩。真实现要查 sqlite、问 electron 的 userData ——
 * 跑测试的机器上导没导工程，都不该影响结论。
 */
const getAgentFileAccessScope = vi.fn<() => 'ue-only' | 'full'>()
const getAllProjects = vi.fn()

vi.mock('electron', () => ({
  app: {
    getPath: (name: string): string =>
      name === 'userData' ? 'C:/Users/me/AppData/Roaming/gdbox' : `C:/${name}`
  }
}))

vi.mock('../../../appSettingsManager', () => ({
  appSettingsManager: { getAgentFileAccessScope: () => getAgentFileAccessScope() }
}))

vi.mock('../../../sqliteDataBase', () => ({
  getPublicDatabase: () => ({}) as never
}))

vi.mock('../../../sqliteDataBase/models/project', () => ({
  getAllProjects: () => getAllProjects()
}))

import { assertInAccessScope, __testing } from './accessScope'

const VAULT_FILE = 'C:/Users/me/AppData/Roaming/gdbox/database/vaults/system_vault_aigc/AIGC/x.png'

beforeEach(() => {
  vi.clearAllMocks()
  __testing.resetCache()
  getAgentFileAccessScope.mockReturnValue('ue-only')
  getAllProjects.mockReturnValue([{ projectPath: 'I:/Games/MyGame' }])
})

/**
 * 放开档必须是「什么都不做」。这个判定挂在每一次读文件、列目录上 ——
 * 在这一档上多查一次库，代价是用户每次让它翻文件夹都多等一下。
 */
describe('整台电脑', () => {
  it('一律放行', async () => {
    getAgentFileAccessScope.mockReturnValue('full')
    expect(await assertInAccessScope('D:/素材/建筑/wall.png')).toBeUndefined()
  })

  it('不查工程库', async () => {
    getAgentFileAccessScope.mockReturnValue('full')
    await assertInAccessScope('D:/随便什么/x.txt')
    expect(getAllProjects).not.toHaveBeenCalled()
  })
})

describe('仅游戏开发相关', () => {
  // 设置读不出来时退回默认档 `full`，和「没选过」同一个兜底 —— 否则设置页显示
  // 「整台电脑」，实际却按收窄档挡，界面和生效的对不上。凭据目录由 pathBoundary 另外挡
  it('读设置抛错时按默认档（整台电脑）走', async () => {
    getAgentFileAccessScope.mockImplementation(() => {
      throw new Error('配置文件坏了')
    })
    expect(await assertInAccessScope('D:/素材/wall.png')).toBeUndefined()
  })

  it.each([
    'I:/Games/MyGame',
    'I:/Games/MyGame/scenes/player.tscn',
    'I:\\Games\\MyGame\\project.godot',
    VAULT_FILE,
    'C:/Users/me/AppData/Roaming/gdbox/skills/my-skill/SKILL.md'
  ])('放行 %s', async (p) => expect(await assertInAccessScope(p)).toBeUndefined())

  it.each([
    'D:/素材/建筑/wall.png',
    'C:/Users/me/Desktop/ref.png',
    'I:/Games/AnotherGame/scenes/x.tscn'
  ])('挡下 %s', async (p) => expect(await assertInAccessScope(p)).toBeDefined())

  /**
   * 前缀比对最容易出的两个事故：结尾不带 `/` 时 `MyGame` 会匹配上
   * `MyGameBackup`；不折叠 `..` 时从工程里能一路跳回盘根。
   */
  it('同前缀的邻居目录不算在范围内', async () => {
    expect(await assertInAccessScope('I:/Games/MyGameBackup/secrets.txt')).toBeDefined()
  })

  it('用 `..` 跳出工程之后照样挡住', async () => {
    expect(await assertInAccessScope('I:/Games/MyGame/../../secrets.txt')).toBeDefined()
  })
})

/** 缓存。这个判定挂在每一次读文件、列目录上 */
describe('白名单缓存', () => {
  it('命中的路径在缓存期内只算一遍', async () => {
    await assertInAccessScope('I:/Games/MyGame/A')
    await assertInAccessScope('I:/Games/MyGame/B')
    await assertInAccessScope('I:/Games/MyGame/C')

    expect(getAllProjects).toHaveBeenCalledTimes(1)
  })

  /**
   * 缓存唯一会造成的错误是**误拒** —— 用户刚导入一个工程，缓存里还没有它，
   * 而「导完让 agent 去看一眼」正是最自然的下一步。所以真要拒绝之前
   * 必须把工程清单重查一遍。
   */
  it('拒绝之前重查工程，刚导入的工程当场就能用', async () => {
    await assertInAccessScope('I:/Games/MyGame')
    expect(getAllProjects).toHaveBeenCalledTimes(1)

    getAllProjects.mockReturnValue([
      { projectPath: 'I:/Games/MyGame' },
      { projectPath: 'I:/Games/NewGame' }
    ])

    expect(await assertInAccessScope('I:/Games/NewGame/scenes')).toBeUndefined()
    expect(getAllProjects).toHaveBeenCalledTimes(2)
  })
})

/**
 * 拒绝的话是给模型看的。说不清「现在允许哪里、怎么才能访问」的话，
 * 模型只会换一种路径写法反复重试，用户看到的是一串一样的失败。
 */
describe('拒绝时说的话', () => {
  it('列出当前允许的位置，并给出两条出路', async () => {
    const said = (await assertInAccessScope('D:/素材/wall.png'))!
    expect(said).toContain('D:/素材/wall.png')
    expect(said).toContain('I:/Games/MyGame')
    expect(said).toContain('我的项目')
    expect(said).toContain('文件访问范围')
    expect(said).toMatch(/不要换一种路径写法再试/)
  })

  it('带上切换路径，并让模型自己判断要不要转达', async () => {
    const said = (await assertInAccessScope('D:/素材/wall.png'))!
    expect(said).toContain('设置 → AI 助手 → 隐私 → 文件访问范围')
    expect(said).toContain('整台电脑')
    expect(said).toContain('不是故障')
    expect(said).toMatch(/你自己判断/)
  })

  it('位置太多时只列前几个，并说明总数', async () => {
    getAllProjects.mockReturnValue(
      Array.from({ length: 12 }, (_, i) => ({ projectPath: `I:/Games/P${i}` }))
    )
    const said = (await assertInAccessScope('D:/x'))!
    // 12 个工程 + 素材库 + 技能目录
    expect(said).toContain('等 14 个位置')
    expect(said).not.toContain('I:/Games/P11')
  })
})

/**
 * 一个来源坏了不该让整份白名单塌成空的 —— 空白名单等于什么都不让碰，
 * 而用户只会看到「这个目录不在范围里」，看不出是数据库没起来。
 */
describe('某个来源取不到时', () => {
  it('数据库没起来，素材库照样放行', async () => {
    getAllProjects.mockImplementation(() => {
      throw new Error('公共数据库未初始化')
    })
    expect(await assertInAccessScope(VAULT_FILE)).toBeUndefined()
  })
})
