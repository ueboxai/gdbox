import { describe, expect, it } from 'vitest'
import { buildFolderSearchTree, excludeCurrentFolder } from './folderSearchTree'

const folder = (
  folderKey: string,
  folderName: string,
  fatherKey?: string,
  hasChildren = false
): AssetFolder => ({
  folderKey,
  folderName,
  fatherKey,
  type: 'normal',
  hasChildren
})

describe('buildFolderSearchTree', () => {
  it('builds a visible ancestor branch for deep global folder matches', () => {
    const result = buildFolderSearchTree([
      folder('role', '角色', 'ALL', true),
      folder('hero', '哈珀', 'role', true),
      folder('music', '音乐', 'hero')
    ])

    expect(result.treeData).toHaveLength(1)
    expect(result.treeData[0].key).toBe('ALL')
    expect(result.treeData[0].children?.[0].key).toBe('role')
    expect(result.treeData[0].children?.[0].children?.[0].key).toBe('hero')
    expect(result.treeData[0].children?.[0].children?.[0].children?.[0].key).toBe('music')
    expect(result.expandedKeys).toEqual(['ALL', 'role', 'hero'])
  })

  it('keeps matches visible when an ancestor is unavailable', () => {
    const result = buildFolderSearchTree([folder('music', '音乐', 'missing-parent')])

    expect(result.treeData[0].key).toBe('ALL')
    expect(result.treeData[0].children?.[0].key).toBe('music')
    expect(result.expandedKeys).toEqual(['ALL'])
  })
})

describe('excludeCurrentFolder', () => {
  it('列表里的文件夹搜索结果不含当前文件夹本身', () => {
    const rows = [
      folder('tex', '贴图', 'ALL'),
      folder('tex-a', 'A', 'tex'),
      folder('tex-b', 'B', 'tex')
    ]
    expect(excludeCurrentFolder(rows, 'tex').map((f) => f.folderKey)).toEqual(['tex-a', 'tex-b'])
    expect(excludeCurrentFolder(rows, undefined)).toHaveLength(3)
  })
})
