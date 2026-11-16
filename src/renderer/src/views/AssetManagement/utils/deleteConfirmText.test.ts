import { describe, expect, it } from 'vitest'
import { deleteConfirmMessage } from './deleteConfirmText'

describe('deleteConfirmMessage', () => {
  it('单个文件写出名字', () => {
    expect(deleteConfirmMessage({ filesCount: 1, foldersCount: 0, name: 'Rock.png' })).toEqual({
      kind: 'named',
      params: { name: 'Rock.png' }
    })
  })

  it('只有文件时只说文件数，不出现 0 个文件夹', () => {
    expect(deleteConfirmMessage({ filesCount: 3, foldersCount: 0 })).toEqual({
      kind: 'files',
      params: { count: 3 }
    })
  })

  it('只有文件夹时只说文件夹数', () => {
    expect(deleteConfirmMessage({ filesCount: 0, foldersCount: 2 })).toEqual({
      kind: 'folders',
      params: { count: 2 }
    })
  })

  it('文件和文件夹都有时两个数都写', () => {
    expect(deleteConfirmMessage({ filesCount: 2, foldersCount: 1 }).kind).toBe('mixed')
  })
})
