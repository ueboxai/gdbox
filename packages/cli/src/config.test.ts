/** @vitest-environment node */
import { existsSync, promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  connectionFromEnv,
  discoverHostConfig,
  hostConfigCandidates,
  isLoopbackHost,
  readHostConfig,
  resolveConnection
} from './config.js'
import { exitCodeFor, type GdboxError } from './errors.js'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

async function tempDir(name = 'gdbox-'): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), name))
  dirs.push(dir)
  return dir
}

describe('hostConfigCandidates', () => {
  /**
   * 开发版和正式安装包的 userData 目录名不一样：前者是 package.json 的
   * `name`，后者是 electron-builder 的 `productName`。两个都得查。
   */
  it('查两个明确候选，不扫用户目录', () => {
    const candidates = hostConfigCandidates({ APPDATA: 'C:/Users/x/AppData/Roaming' })

    expect(candidates).toHaveLength(2)
    expect(candidates[0]).toMatch(/[\\/]gdbox[\\/]mcp-server\.json$/)
    expect(candidates[1]).toMatch(/[\\/]GDBox[\\/]mcp-server\.json$/)
  })
})

describe('readHostConfig', () => {
  it('从端口拼出回环地址，并取出令牌', async () => {
    const dir = await tempDir()
    const path = join(dir, 'mcp-server.json')
    await fs.writeFile(path, JSON.stringify({ enabled: true, port: 17871, token: 'abc123' }))

    expect(await readHostConfig(path)).toMatchObject({
      url: 'http://127.0.0.1:17871/',
      token: 'abc123'
    })
  })

  /** Windows 上用记事本存出来的 JSON 默认带 BOM，不摘掉的话 JSON.parse 直接抛 */
  it('带 BOM 的配置也读得了', async () => {
    const dir = await tempDir()
    const path = join(dir, 'mcp-server.json')
    await fs.writeFile(path, `\uFEFF${JSON.stringify({ port: 17871, token: 'abc' })}`, 'utf8')

    expect((await readHostConfig(path)).token).toBe('abc')
  })

  it('文件不在时报 CONFIG_MISSING 并给出下一步', async () => {
    const dir = await tempDir()
    try {
      await readHostConfig(join(dir, 'nope.json'))
      expect.unreachable('应该抛出')
    } catch (error) {
      expect((error as GdboxError).code).toBe('CONFIG_MISSING')
      expect((error as GdboxError).hint).toContain('--config')
    }
  })

  /**
   * 真机上被一个外部 Agent（Codex，沙箱里读不到 %APPDATA%）撞出来的：
   * 「读不了」被一律报成「还没有配置过」+「先运行 setup」，于是它照着提示
   * 反复怀疑盒子没装没启动，绕了一大圈。
   *
   * 「文件不在」和「我不许看」要走完全不同的下一步。
   */
  it('路径是目录（存在但读不了）时报 CONFIG_UNREADABLE，不谎称没配置过', async () => {
    const dir = await tempDir()
    try {
      await readHostConfig(dir)
      expect.unreachable('应该抛出')
    } catch (error) {
      const failed = error as GdboxError
      expect(failed.code).toBe('CONFIG_UNREADABLE')
      expect(failed.message).not.toContain('还没有配置过')
      expect(failed.message).toContain('目录')
    }
  })

  it('两种配置错误的退出码都是 3 —— 只看退出码的脚本行为不变', () => {
    expect(exitCodeFor('CONFIG_MISSING')).toBe(3)
    expect(exitCodeFor('CONFIG_UNREADABLE')).toBe(3)
  })

  /** 坏配置报错，**不重建** —— 那个文件是盒子的，越权去写可能把用户的令牌换掉 */
  it('内容坏掉时报 CONFIG_INVALID，不自行重建', async () => {
    const dir = await tempDir()
    const path = join(dir, 'mcp-server.json')
    await fs.writeFile(path, '{ 这不是 JSON')

    await expect(readHostConfig(path)).rejects.toThrow(/不是合法 JSON/)
    // 文件必须原封不动
    expect(await fs.readFile(path, 'utf8')).toBe('{ 这不是 JSON')
  })

  it('没有令牌时明确报出来', async () => {
    const dir = await tempDir()
    const path = join(dir, 'mcp-server.json')
    await fs.writeFile(path, JSON.stringify({ port: 17871, token: '   ' }))

    await expect(readHostConfig(path)).rejects.toThrow(/没有访问令牌/)
  })
})

describe('connectionFromEnv', () => {
  it('两个都没设时返回 undefined，走配置文件', () => {
    expect(connectionFromEnv({})).toBeUndefined()
  })

  /**
   * 从一个来源取地址、另一个来源取令牌，等于把令牌发给一个没人核对过的地址。
   * 所以只设一个是配置错误，不是「另一半去文件里找」。
   */
  it('只设一个时报错，不去文件里补另一半', () => {
    expect(() => connectionFromEnv({ GDBOX_URL: 'http://127.0.0.1:1/' })).toThrow(/必须同时提供/)
    expect(() => connectionFromEnv({ GDBOX_TOKEN: 'x' })).toThrow(/必须同时提供/)
  })

  it('成对时用它，并标明来源不是文件', () => {
    const connection = connectionFromEnv({
      GDBOX_URL: 'http://127.0.0.1:17871/',
      GDBOX_TOKEN: 'tok'
    })

    expect(connection).toMatchObject({ token: 'tok' })
    // 来源里不能出现令牌本身
    expect(connection?.source).not.toContain('tok')
  })

  /** 盒子只监听回环。出现别的地址只可能是配错或被人改过，不能把令牌发过去 */
  it('非回环地址一律拒绝', () => {
    for (const url of ['http://192.168.1.5:17871/', 'http://example.com/', 'https://10.0.0.1/']) {
      expect(() => connectionFromEnv({ GDBOX_URL: url, GDBOX_TOKEN: 'tok' })).toThrow(/回环/)
    }
  })

  it('localhost 和 ::1 都算回环', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true)
    expect(isLoopbackHost('localhost')).toBe(true)
    expect(isLoopbackHost('[::1]')).toBe(true)
    expect(isLoopbackHost('192.168.1.5')).toBe(false)
  })
})

/**
 * 临时目录所在的文件系统分不分大小写。
 *
 * 分不出大小写时 `gdbox/` 和 `GDBox/` 是同一个目录，开发版和正式版共用一份配置 ——
 * 「两份配置」那几条用例在这种机器上根本摆不出来。
 */
const caseInsensitive = existsSync(tmpdir().toUpperCase()) && existsSync(tmpdir().toLowerCase())

/** 在临时目录里摆出盒子配置，`APPDATA` 指过去，就是一台假机器 */
async function machine(installs: Array<'dev' | 'installed'>): Promise<NodeJS.ProcessEnv> {
  const root = await tempDir('gdbox 中文-')
  // 非 Windows 上 appDataDir 不看 APPDATA，看 XDG_CONFIG_HOME；两个都给
  const env = { APPDATA: root, XDG_CONFIG_HOME: root, HOME: root }
  const [dev, installed] = hostConfigCandidates(env)
  const ports = { dev: 17871, installed: 17872 }
  for (const which of installs) {
    const path = which === 'dev' ? dev! : installed!
    await fs.mkdir(join(path, '..'), { recursive: true })
    await fs.writeFile(path, JSON.stringify({ port: ports[which], token: `t-${which}` }))
  }
  return env
}

describe('零配置找盒子', () => {
  // macOS 上 appDataDir 固定在 ~/Library，不看这两个变量，这组测试只在别处跑
  const onMac = process.platform === 'darwin'

  it.skipIf(onMac)('只装了一个就直接用它，不需要 setup', async () => {
    const env = await machine(['installed'])
    const host = await resolveConnection({ env, bundled: false })

    expect(host.url).toBe('http://127.0.0.1:17872/')
    expect(host.token).toBe('t-installed')
  })

  /**
   * Windows / macOS 上 `gdbox` 和 `GDBox` 是同一个目录。按路径字符串去重的话，
   * 一份配置会被数成两份，零配置当场失效。
   */
  it.skipIf(onMac || !caseInsensitive)('大小写不敏感时两个候选是同一份，直接用', async () => {
    const env = await machine(['installed'])
    const host = await resolveConnection({ env, bundled: false })

    expect(host.token).toBe('t-installed')
  })

  it.skipIf(onMac || caseInsensitive)(
    '两个都装着时不替用户挑，报错并给出两条指定办法',
    async () => {
      const env = await machine(['dev', 'installed'])

      try {
        await discoverHostConfig(env, false)
        expect.unreachable('应该抛出')
      } catch (error) {
        expect((error as GdboxError).code).toBe('CONFIG_INVALID')
        expect((error as GdboxError).hint).toContain('--config')
        expect((error as GdboxError).hint).toContain('GDBOX_HOST_CONFIG')
      }
    }
  )

  /** 装机版是用正式版的 exe 启动的，属于哪个盒子没有疑问 */
  it.skipIf(onMac || caseInsensitive)('装机版 CLI 在两个都装着时用正式版', async () => {
    const env = await machine(['dev', 'installed'])
    const host = await resolveConnection({ env, bundled: true })

    expect(host.token).toBe('t-installed')
  })

  it.skipIf(onMac)('一个都没有时报 CONFIG_MISSING，列出查过的位置', async () => {
    const env = await machine([])

    try {
      await discoverHostConfig(env, false)
      expect.unreachable('应该抛出')
    } catch (error) {
      expect((error as GdboxError).code).toBe('CONFIG_MISSING')
      expect((error as GdboxError).message).toContain('mcp-server.json')
    }
  })

  it.skipIf(onMac)('GDBOX_HOST_CONFIG 和 --config 优先于自动查找', async () => {
    const env = await machine(['installed'])
    const elsewhere = join(await tempDir(), 'mcp-server.json')
    await fs.writeFile(elsewhere, JSON.stringify({ port: 17873, token: 't-elsewhere' }))

    expect((await resolveConnection({ env: { ...env, GDBOX_HOST_CONFIG: elsewhere } })).token).toBe(
      't-elsewhere'
    )
    expect((await resolveConnection({ env, configPath: elsewhere })).token).toBe('t-elsewhere')
  })
})
