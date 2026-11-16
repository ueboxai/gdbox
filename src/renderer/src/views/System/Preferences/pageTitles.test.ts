import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import zhCN from '@renderer/i18n/locales/zh-CN'
import enUS from '@renderer/i18n/locales/en-US'

/**
 * 偏好设置的页标题要和左栏的名字一致：左栏点「项目库」，标题不能变成「项目」。
 * MCP 例外：面板里已有同名小标题，页头故意用 client 的标题（见 index.vue 注释）。
 */
const dir = 'src/renderer/src/views/System/Preferences'
const index = readFileSync(`${dir}/index.vue`, 'utf8')
const sidebar = readFileSync(`${dir}/components/PreferencesSidebar.vue`, 'utf8')

const pairs = (source: string, field: string): Map<string, string> =>
  new Map(
    [...source.matchAll(new RegExp(`(\\w+): \\{\\s*${field}: '([\\w.]+)'`, 'g'))].map((m) => [
      m[1],
      m[2]
    ])
  )

const sidebarPairs = (): Map<string, string> =>
  new Map([...sidebar.matchAll(/key: '(\w+)',\s*labelKey: '([\w.]+)'/g)].map((m) => [m[1], m[2]]))

const lookup = (locale: unknown, key: string): unknown =>
  key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], locale)

describe('偏好设置页标题', () => {
  const titles = pairs(index, 'titleKey')
  const labels = sidebarPairs()

  it('能解析出两边的配置', () => {
    expect(titles.size).toBeGreaterThan(10)
    expect(labels.size).toBeGreaterThan(10)
  })

  for (const [name, locale] of [
    ['zh-CN', zhCN],
    ['en-US', enUS]
  ] as const) {
    it(`${name}：页标题与左栏名一致`, () => {
      const mismatched: string[] = []
      for (const [page, titleKey] of titles) {
        const labelKey = labels.get(page)
        if (!labelKey) continue
        if (lookup(locale, titleKey) !== lookup(locale, labelKey)) mismatched.push(page)
      }
      expect(mismatched).toEqual([])
    })
  }
})
