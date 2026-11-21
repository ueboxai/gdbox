import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  checkBrowserUrl,
  displayUrl,
  grantLocalFile,
  handleLocalFileRequest,
  localPathFromAddress,
  localPathOf,
  resetLocalFileGrants
} from './localFiles'

const root = mkdtempSync(join(tmpdir(), 'browser-local-'))
const site = join(root, 'site')
const other = join(root, 'other')
mkdirSync(join(site, 'css'), { recursive: true })
mkdirSync(join(site, '.git'), { recursive: true })
mkdirSync(other, { recursive: true })
writeFileSync(join(site, '报告.html'), '<title>报告</title>')
writeFileSync(join(site, 'css', 'a.css'), 'body{}')
writeFileSync(join(site, '.env'), 'SECRET=1')
writeFileSync(join(site, '.git', 'config'), '[core]')
writeFileSync(join(site, 'model.fbx'), 'binary')
writeFileSync(join(site, 'gbk.html'), Buffer.from([0x3c, 0x70, 0x3e, 0xc4, 0xe3, 0xba, 0xc3]))
writeFileSync(join(root, 'secret.txt'), 'outside')
writeFileSync(join(other, 'b.pdf'), '%PDF-1.4')
writeFileSync(join(other, 'c.txt'), 'sibling')
writeFileSync(join(site, 'fresh.html'), Buffer.from([0xc4, 0xe3]))
// 文件夹里一个指到外面的联接（pnpm 在 Windows 上就这么建 node_modules）
symlinkSync(other, join(site, 'linked'), 'junction')

afterAll(() => rmSync(root, { recursive: true, force: true }))
beforeEach(() => resetLocalFileGrants())

async function body(url: string): Promise<{ status: number; type: string | null; text: string }> {
  const response = await handleLocalFileRequest(new Request(url))
  return {
    status: response.status,
    type: response.headers.get('content-type'),
    text: response.status === 200 ? await response.text() : ''
  }
}

describe('内置浏览器里的本机文件', () => {
  it('授权文件所在的文件夹，网页旁边的样式按相对路径加载得到', async () => {
    const page = await grantLocalFile(join(site, '报告.html'))
    expect(page.protocol).toBe('uebox-file:')
    expect(await body(page.href)).toMatchObject({
      status: 200,
      type: 'text/html; charset=utf-8'
    })
    // 不是 UTF-8 的网页不替它声明，让它自己的 meta 说了算
    expect(await body(new URL('gbk.html', page).href)).toMatchObject({ type: 'text/html' })
    const css = await body(new URL('css/a.css', page).href)
    expect(css).toMatchObject({ status: 200, text: 'body{}' })
    expect(css.type).toContain('text/css')
  })

  it('同一个文件夹共用一个源，不同文件夹各自一个', async () => {
    const a = await grantLocalFile(join(site, '报告.html'))
    const b = await grantLocalFile(join(site, 'css', 'a.css').replace('a.css', '../报告.html'))
    const c = await grantLocalFile(join(other, 'b.pdf'))
    expect(a.host).toBe(b.host)
    expect(c.host).not.toBe(a.host)
  })

  it('读不到文件夹以外和以点开头的文件', async () => {
    const page = await grantLocalFile(join(site, '报告.html'))
    for (const path of [
      '../secret.txt',
      '%2e%2e/secret.txt',
      '.env',
      '.git/config',
      '..%5csecret.txt'
    ]) {
      expect((await body(`uebox-file://${page.host}/${path}`)).status, path).toBe(404)
    }
  })

  it('PDF、图片这类只授权文件本身，旁边的文件读不到', async () => {
    const pdf = await grantLocalFile(join(other, 'b.pdf'))
    expect((await body(pdf.href)).status).toBe(200)
    expect((await body(new URL('c.txt', pdf).href)).status).toBe(404)
  })

  it('符号链接和联接按真实位置算越界', async () => {
    const page = await grantLocalFile(join(site, '报告.html'))
    expect(localPathOf(new URL('linked/c.txt', page))).not.toBeNull()
    expect((await body(new URL('linked/c.txt', page).href)).status).toBe(404)
  })

  it('网页改过之后重新判断编码', async () => {
    const page = await grantLocalFile(join(site, 'fresh.html'))
    expect((await body(page.href)).type).toBe('text/html')
    writeFileSync(join(site, 'fresh.html'), '<p>你好</p>')
    expect((await body(page.href)).type).toBe('text/html; charset=utf-8')
  })

  it('没授权过的授权号一律 404，也不算可导航的地址', async () => {
    await grantLocalFile(join(site, '报告.html'))
    const forged = 'uebox-file://0123456789abcdef0123456789abcdef/%E6%8A%A5%E5%91%8A.html'
    expect((await body(forged)).status).toBe(404)
    expect(checkBrowserUrl(forged).ok).toBe(false)
  })

  it('页面导航放行已授权的本机地址，file: 和内网照旧拒绝', async () => {
    const page = await grantLocalFile(join(site, '报告.html'))
    expect(checkBrowserUrl(new URL('css/a.css', page).href).ok).toBe(true)
    expect(checkBrowserUrl(pathToFileURL(join(site, '报告.html')).href).ok).toBe(false)
    expect(checkBrowserUrl('http://127.0.0.1/').ok).toBe(false)
    expect(checkBrowserUrl('https://example.com/').ok).toBe(true)
  })

  it('不存在、是文件夹或浏览器显示不了的文件不授权', async () => {
    await expect(grantLocalFile(join(site, 'missing.html'))).rejects.toThrow('文件不存在')
    await expect(grantLocalFile(join(site, 'css'))).rejects.toThrow('文件夹')
    await expect(grantLocalFile(join(site, 'model.fbx'))).rejects.toThrow('.fbx')
  })

  it('给界面和模型看的地址换回 file://，带着锚点', async () => {
    const page = await grantLocalFile(join(site, '报告.html'))
    expect(displayUrl(`${page.href}#part`)).toBe(
      `${pathToFileURL(join(site, '报告.html')).href}#part`
    )
    expect(displayUrl('https://example.com/')).toBe('https://example.com/')
    expect(localPathOf(page)).toBe(join(site, '报告.html'))
  })

  it('认 file:// 地址和本机绝对路径，网址和搜索词不认', () => {
    const file = join(site, '报告.html')
    expect(localPathFromAddress(pathToFileURL(file).href)).toBe(file)
    expect(localPathFromAddress(`  ${file}  `)).toBe(file)
    expect(localPathFromAddress('https://example.com/a.html')).toBeNull()
    expect(localPathFromAddress('//example.com/a')).toBeNull()
    expect(localPathFromAddress('报告')).toBeNull()
  })
})
