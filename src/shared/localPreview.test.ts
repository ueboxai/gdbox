import { describe, expect, it } from 'vitest'
import { filePathOfUrl, localPreviewType, opensInBrowserPane } from './localPreview'

describe('内置浏览器能显示的本地文件', () => {
  it('按扩展名给类型，大小写不敏感，认不出的不给', () => {
    expect(localPreviewType('C:/a/Report.HTML')).toBe('text/html')
    expect(localPreviewType('/a/b.pdf')).toBe('application/pdf')
    expect(localPreviewType('C:/a/model.fbx')).toBeUndefined()
    expect(localPreviewType('C:/a.b/README')).toBeUndefined()
  })

  it('网页、PDF、图片、音视频点了进面板，文本交给系统', () => {
    for (const path of ['a.html', 'a.pdf', 'a.png', 'a.svg', 'a.mp4', 'a.mp3']) {
      expect(opensInBrowserPane(`C:/x/${path}`), path).toBe(true)
    }
    for (const path of ['a.txt', 'a.md', 'a.json', 'a.uasset']) {
      expect(opensInBrowserPane(`C:/x/${path}`), path).toBe(false)
    }
  })

  it('file:// 地址还原成路径', () => {
    expect(filePathOfUrl('file:///C:/UE%20Project/%E6%8A%A5%E5%91%8A.html', true)).toBe(
      'C:\\UE Project\\报告.html'
    )
    expect(filePathOfUrl('file:///Users/a/b.pdf', false)).toBe('/Users/a/b.pdf')
    expect(filePathOfUrl('file://nas/share/a.html', true)).toBe('\\\\nas\\share\\a.html')
    expect(filePathOfUrl('https://example.com/', true)).toBeNull()
    expect(filePathOfUrl('not a url', true)).toBeNull()
  })
})
