import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { normalizeBrowserAddress } from './address'

describe('手动浏览器地址', () => {
  it.each([
    [' unrealengine.com/feed?tags=news ', 'https://unrealengine.com/feed?tags=news'],
    ['https://example.com/a#b', 'https://example.com/a#b'],
    ['http://example.com/', 'http://example.com/'],
    ['example.com:8443/path', 'https://example.com:8443/path'],
    ['//example.com/path', 'https://example.com/path']
  ])('补全地址 %s', (input, expected) => {
    expect(normalizeBrowserAddress(input)).toBe(expected)
  })
  it.each(['', ' ', null, {}, 'javascript:alert(1)', 'http://127.0.0.1', 'localhost:3000'])(
    '拒绝非法或危险地址 %s',
    (input) => {
      expect(() => normalizeBrowserAddress(input)).toThrow()
    }
  )
  it('本机路径和 file:// 地址规整成 file://，交给浏览器授权', () => {
    const file = join(tmpdir(), '报告 1.html')
    const url = pathToFileURL(file).href
    expect(normalizeBrowserAddress(file)).toBe(url)
    expect(normalizeBrowserAddress(` ${url} `)).toBe(url)
  })
  it.each([
    ['not a url', 'https://www.bing.com/search?q=not%20a%20url'],
    ['unrealengine', 'https://www.bing.com/search?q=unrealengine'],
    [
      '  虚幻 5.4 材质 ',
      'https://www.bing.com/search?q=%E8%99%9A%E5%B9%BB%205.4%20%E6%9D%90%E8%B4%A8'
    ]
  ])('不像网址的输入拿去搜 %s', (input, expected) => {
    expect(normalizeBrowserAddress(input)).toBe(expected)
  })
})
