import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string): string =>
  readFileSync(resolve(process.cwd(), 'src/renderer/src/views/Assistant', file), 'utf8')

/** 写死的浅色值在浅色主题下看不见，一律走主题变量 */
describe('助手页浅色主题', () => {
  it('「滚动到底部」图标走主题色，按钮带可读名称', () => {
    const source = read('Welcome.vue')
    expect(source).not.toContain('#ffffffa9')
    expect(source).toMatch(
      /class="scroll-to-bottom-btn"\s*:aria-label="t\('assistant\.chat\.scrollToBottom'\)"/
    )
  })

  it('回复加载点走主题色', () => {
    expect(read('components/AIBubble.vue')).not.toContain('#cfcfd6')
  })

  it('用户气泡的复制、编辑图标带提示和可读名称', () => {
    const source = read('components/UserBubble.vue')
    expect(source).toMatch(/class="tool tool-button"\s+:aria-label="t\('assistant\.chat\.copy'\)"/)
    expect(source).toMatch(
      /class="tool tool-button"\s+:aria-label="t\('assistant\.chat\.editMessage'\)"/
    )
  })
})
