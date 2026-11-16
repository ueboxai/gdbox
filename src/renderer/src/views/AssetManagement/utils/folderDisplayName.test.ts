import { describe, expect, it } from 'vitest'
import { displayFolderName, displayFolderPath } from './folderDisplayName'

describe('displayFolderName', () => {
  it('根文件夹 ALL 显示成本地化名称，其他名字原样', () => {
    expect(displayFolderName('ALL', '全部')).toBe('全部')
    expect(displayFolderName('Textures', '全部')).toBe('Textures')
    expect(displayFolderName('all', 'All')).toBe('all')
    expect(displayFolderName(undefined, 'All')).toBe('')
  })
})

describe('displayFolderPath', () => {
  it('路径里的根目录段 ALL 显示成本地化名称', () => {
    expect(displayFolderPath('/ALL/贴图', '全部')).toBe('/全部/贴图')
    expect(displayFolderPath('/ALL', 'All')).toBe('/All')
    expect(displayFolderPath('/ALL/ALLx/a', '全部')).toBe('/全部/ALLx/a')
    expect(displayFolderPath(undefined, '全部')).toBe('')
  })
})
