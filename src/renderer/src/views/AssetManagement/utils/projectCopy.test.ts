import { describe, expect, it, vi } from 'vitest'
import { collectProjectCopyEntries, copyEntriesToFolder, resolveAssetFile } from './projectCopy'

describe('projectCopy', () => {
  it('resolves vault-relative paths and keeps absolute ones', () => {
    expect(resolveAssetFile({ filePath: 'art/hero.png' }, 'D:/Vault')).toBe('D:/Vault/art/hero.png')
    expect(resolveAssetFile({ originPath: 'E:\\pack\\hero.png' }, 'D:/Vault')).toBe(
      'E:\\pack\\hero.png'
    )
    expect(resolveAssetFile({}, 'D:/Vault')).toBe('')
  })

  it('expands a batch of files and folders, folder files keep the folder name', async () => {
    const listFolder = vi.fn(async () => [{ filePath: 'sfx/jump.wav' }, { filePath: '' }])
    const entries = await collectProjectCopyEntries(
      {
        type: 'batch',
        children: [
          { type: 'file', filePath: 'art/hero.png' },
          { type: 'folder', id: 'f1', name: 'Sounds' }
        ]
      },
      'D:/Vault',
      listFolder
    )
    expect(listFolder).toHaveBeenCalledWith('f1')
    expect(entries).toEqual([
      { src: 'D:/Vault/art/hero.png', rel: 'hero.png' },
      { src: 'D:/Vault/sfx/jump.wav', rel: 'Sounds/jump.wav' }
    ])
  })

  it('skips files that already exist and counts failures without stopping', async () => {
    const copy = vi.fn(async (src: string) => {
      if (src.endsWith('bad.png')) throw new Error('denied')
    })
    const result = await copyEntriesToFolder(
      [
        { src: 'D:/a/keep.png', rel: 'keep.png' },
        { src: 'D:/a/bad.png', rel: 'bad.png' },
        { src: 'D:/a/new.png', rel: 'new.png' }
      ],
      'C:/game/art',
      { exists: async (p) => p.endsWith('keep.png'), copy }
    )
    expect(result).toEqual({ copied: 1, skipped: 1, failed: 1 })
    expect(copy).toHaveBeenCalledWith('D:/a/new.png', 'C:/game/art/new.png')
  })
})
