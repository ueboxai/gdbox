import { describe, expect, it } from 'vitest'
import { fileListEmptyKind } from './fileListEmptyState'

describe('fileListEmptyKind', () => {
  it('回收站和收藏视图各说各的，不受筛选影响', () => {
    expect(fileListEmptyKind({ shortcut: 'recent', hasQuery: true, folderKey: 'A' })).toBe('trash')
    expect(fileListEmptyKind({ shortcut: 'deleted' })).toBe('trash')
    expect(fileListEmptyKind({ shortcut: 'favorites', hasQuery: true })).toBe('favorites')
  })

  it('有搜索或筛选时提示清除筛选，而不是去导入', () => {
    expect(fileListEmptyKind({ hasQuery: true, folderKey: 'A' })).toBe('filtered')
  })

  it('没选文件夹和选了空文件夹分开', () => {
    expect(fileListEmptyKind({})).toBe('noFolder')
    expect(fileListEmptyKind({ folderKey: 'A' })).toBe('folder')
  })
})
