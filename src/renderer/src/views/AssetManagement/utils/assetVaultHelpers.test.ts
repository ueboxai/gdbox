import { describe, expect, it } from 'vitest'
import { vaultDisplayName } from './assetVaultHelpers'

const t = (key: string): string => (key === 'assetLib.vault.default' ? '默认资产库' : key)

describe('vaultDisplayName', () => {
  it('默认库的旧名「默认保管库」显示为当前叫法，库里存的名字不动', () => {
    const vault = { name: '默认保管库', isSystem: true, systemKey: 'default' }
    expect(vaultDisplayName(vault, t)).toBe('默认资产库')
    expect(vault.name).toBe('默认保管库')
  })

  it('默认库被用户改过名、或是别的库时照原样显示', () => {
    expect(vaultDisplayName({ name: '我的库', isSystem: true, systemKey: 'default' }, t)).toBe(
      '我的库'
    )
    expect(vaultDisplayName({ name: '默认保管库', isSystem: false }, t)).toBe('默认保管库')
    expect(vaultDisplayName(null, t)).toBe('')
  })
})
