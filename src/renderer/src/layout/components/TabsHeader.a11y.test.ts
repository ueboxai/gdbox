import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/layout/components/TabsHeader.vue'),
  'utf8'
)

describe('TabsHeader 的按钮读屏可识别', () => {
  it('三个窗口按钮都有 aria-label 和 title', () => {
    for (const key of ['minimize', 'maximize', 'close']) {
      expect(source).toContain(`:aria-label="t('chatWindow.${key}')"`)
      expect(source).toContain(`:title="t('chatWindow.${key}')"`)
    }
  })

  it('标签关闭叉是带 aria-label 的按钮，点击区 24px', () => {
    expect(source).toMatch(
      /<button[^>]*class="tab-close"[^>]*:aria-label="t\('tabs\.closeTab'\)"[\s\S]*?<PhX \/>\s*<\/button>/
    )
    expect(source).toMatch(/\.tab-close\s*\{[^}]*width:\s*24px;[^}]*height:\s*24px;/s)
  })

  it('固定的标签页显示图钉、不显示关闭叉，关闭判断统一走 isTabUserClosable', () => {
    expect(source).toMatch(/<PhPushPin\s+v-if="tab\.fixed"[\s\S]*?class="tab-pin"/)
    expect(source).toMatch(/v-else-if="isTabUserClosable\(tab\)"[\s\S]*?class="tab-close"/)
    expect(source).toContain('if (!tab || !isTabUserClosable(tab)) return')
    expect(source).toContain('disabled: !isTabUserClosable(tab)')
  })
})
