import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { manageIdle } from './idleManagement'
import { readMcpSettings, writeMcpSettings } from './mcp/store'
import { ensureConnected, shutdownMcp } from './mcp'
import { recordUse } from './idleStore'

let root: string
const day = 86_400_000
vi.mock('electron', () => ({ app: { getPath: () => root } }))
vi.mock('./mcp/epicToolsets', () => ({ discoverEpicMcpServersFromRuntime: async () => ({}) }))
vi.mock('./plugins/registry', () => ({ enabledPluginMcpServers: async () => ({}) }))
vi.mock('./skills', () => ({ discoverEnabledSkills: async () => [{ name: 'paint' }] }))

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'uebox-idle-'))
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(0)
  await writeMcpSettings({
    version: 1,
    mcpServers: { draw: { command: 'draw', env: { theme: 'blue' } } }
  })
})
afterEach(async () => {
  await shutdownMcp()
  vi.useRealTimers()
  rmSync(root, { recursive: true, force: true })
})

it('starts existing installations fresh, reminds at 14 days, and defaults to reminders only', async () => {
  expect(await manageIdle('mcp')).toEqual({ auto: false, rows: [] })
  await manageIdle('skill')
  vi.setSystemTime(14 * day - 1)
  expect((await manageIdle('mcp')).rows).toEqual([])
  vi.setSystemTime(14 * day)
  expect((await manageIdle('mcp')).rows[0]).toEqual({ id: 'draw', since: 0 })
  expect((await manageIdle('skill')).rows[0].id).toBe('paint')
  vi.setSystemTime(31 * day)
  expect((await manageIdle('mcp')).rows[0].disabled).toBeUndefined()
})

it('counts calls, protects kept items and skills, and gives restored MCP a fresh interval', async () => {
  const config = await readMcpSettings()
  await manageIdle('mcp', { action: 'auto', enabled: true })
  await manageIdle('skill')
  vi.setSystemTime(5 * day)
  await recordUse('mcp', 'draw')
  vi.setSystemTime(30 * day)
  expect((await manageIdle('mcp')).rows[0].disabled).toBeUndefined()
  await manageIdle('mcp', { action: 'keep', id: 'draw' })
  vi.setSystemTime(35 * day)
  expect((await manageIdle('mcp')).rows[0].kept).toBe(true)
  expect((await manageIdle('skill')).rows[0].disabled).toBeUndefined()
  const off = await manageIdle('mcp', { action: 'unkeep', id: 'draw' })
  expect(off.rows[0].disabled).toBe('auto')
  expect((await manageIdle('mcp', { action: 'restore', id: 'draw' })).rows).toEqual([])
  expect(await readMcpSettings()).toEqual(config)
  vi.setSystemTime(49 * day)
  expect((await manageIdle('mcp')).rows[0].lastUsed).toBe(5 * day)
})

it('removes live MCP tools and reconnects the same server on restore', async () => {
  await writeMcpSettings({
    version: 1,
    mcpServers: {
      echo: {
        command: process.execPath,
        args: [join(process.cwd(), 'tests/fixtures/mcp/echo-server.mjs')]
      }
    }
  })
  const client = await ensureConnected()
  expect(client.toolsOf('echo').length).toBeGreaterThan(0)
  vi.setSystemTime(day)
  const tool = client.toolsOf('echo')[0]
  await tool.execute('test', { message: 'test' })
  await manageIdle('mcp', { action: 'auto', enabled: true })
  vi.setSystemTime(day * 30)
  expect((await manageIdle('mcp')).rows[0].lastUsed).toBe(day)
  vi.setSystemTime(day * 31)
  expect((await manageIdle('mcp')).rows[0].disabled).toBe('auto')
  expect(client.toolsOf('echo')).toHaveLength(0)
  await expect(tool.execute('old-session', { message: 'test' })).rejects.toThrow('disabled')
  await manageIdle('mcp', { action: 'restore', id: 'echo' })
  expect(client.toolsOf('echo').length).toBeGreaterThan(0)
}, 30_000)
