import { describe, expect, it } from 'vitest'
import { createI18n } from 'vue-i18n'
import zhCN from '@renderer/i18n/locales/zh-CN'
import enUS from '@renderer/i18n/locales/en-US'
import {
  UNC_PATH_EXAMPLE,
  UNC_PATH_PREFIX,
  VAULT_NAME_INVALID_CHARS
} from './utils/networkBrowsePath'

// 用真的 vue-i18n 渲染：写进语言包的反斜杠会被消息编译吃掉，`|` 会被当成复数分隔符
describe('网络路径相关文案', () => {
  for (const locale of ['zh-CN', 'en-US'] as const) {
    it(`${locale}：UNC 例子、前缀和非法字符原样显示`, () => {
      const messages: Record<string, unknown> = { 'zh-CN': zhCN, 'en-US': enUS }
      const i18n = createI18n({ legacy: false, locale, messages } as never)
      const t = (i18n.global as unknown as { t: (key: string, params: object) => string }).t
      const example = { example: UNC_PATH_EXAMPLE }
      expect(t('createVaultModal.network.pathPlaceholder', example)).toContain(
        '\\\\192.168.1.100\\Assets'
      )
      expect(t('createVaultModal.nas.browsePathPlaceholder', example)).toContain(
        '\\\\192.168.1.100\\Assets'
      )
      expect(t('vaultSwitcher.modals.editBrowsePathModal.pathPlaceholder', example)).toContain(
        '\\\\192.168.1.100\\Assets'
      )
      expect(t('createVaultModal.errors.networkPathFormat', { prefix: UNC_PATH_PREFIX })).toContain(
        '\\\\'
      )
      expect(
        t('createVaultModal.errors.nameInvalidChars', { chars: VAULT_NAME_INVALID_CHARS })
      ).toContain('< > : " / \\ | ? *')
    })
  }
})
