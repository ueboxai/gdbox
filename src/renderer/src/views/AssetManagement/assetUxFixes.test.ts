import { readFileSync } from 'node:fs'
import { parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'

// Run the actual handlers with deferred IO; no real vault is opened or modified.
function handlers(
  file: string,
  names: string[],
  context: Record<string, unknown>,
  extra = ''
): Record<string, (...args: unknown[]) => unknown> {
  const source = parse(readFileSync(`src/renderer/src/${file}`, 'utf8')).descriptor.scriptSetup!
    .content
  const ast = ts.createSourceFile('handlers.ts', source, ts.ScriptTarget.Latest, true)
  const declarations = ast.statements.filter(
    (statement) =>
      ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some((item) => names.includes(item.name.getText(ast)))
  )
  const code = ts.transpileModule(
    declarations.map((item) => item.getText(ast)).join('\n;\n') + '\n;\n' + extra,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
  ).outputText
  return new Function(...Object.keys(context), `${code}; return { ${names.join(', ')} }`)(
    ...Object.values(context)
  )
}

const menuContext = (baidu: boolean, webdav: boolean): Record<string, unknown> => ({
  t: (key: string) => key,
  baiduyunStore: { isAuthenticated: baidu },
  webdavStore: { isConnected: webdav },
  PhDownloadSimple: 'i',
  PhPencilSimple: 'i',
  PhTag: 'i',
  PhStar: 'i',
  PhArrowsClockwise: 'i',
  PhFolderOpen: 'i',
  PhImage: 'i',
  PhCloudArrowUp: 'i',
  PhTrash: 'i',
  PhPalette: 'i'
})

const keys = (items: unknown): string[] => (items as Array<{ key: string }>).map((i) => i.key)
const MENUS = ['cloudUploadMenuItems', 'buildAssetMenuItems', 'buildFolderMenuItems']

describe('资产右键菜单', () => {
  it('收藏前后顺序一致，只换收藏那一项', () => {
    const { buildAssetMenuItems, buildFolderMenuItems } = handlers(
      'views/AssetManagement/components/AssetFileList.vue',
      MENUS,
      menuContext(true, true)
    )
    const plain = keys(buildAssetMenuItems(false))
    const fav = keys(buildAssetMenuItems(true))
    expect(fav).toEqual(plain.map((k) => (k === 'favorite' ? 'unfavorite' : k)))
    const folder = keys(buildFolderMenuItems(false))
    const favFolder = keys(buildFolderMenuItems(true))
    expect(favFolder).toEqual(
      folder.map((k) => (k === 'favorite-folder' ? 'unfavorite-folder' : k))
    )
    // 已收藏的文件夹也能改颜色
    expect(favFolder).toContain('set-color-folder')
  })

  it('网盘上传只在对应服务已授权时出现，都没授权不留空分隔线', () => {
    const only = handlers(
      'views/AssetManagement/components/AssetFileList.vue',
      MENUS,
      menuContext(true, false)
    )
    const withBaidu = keys(only.buildAssetMenuItems(false))
    expect(withBaidu).toContain('upload-baiduyun')
    expect(withBaidu).not.toContain('upload-webdav')

    const none = handlers(
      'views/AssetManagement/components/AssetFileList.vue',
      MENUS,
      menuContext(false, false)
    )
    const plain = keys(none.buildAssetMenuItems(false))
    expect(plain).not.toContain('upload-baiduyun')
    expect(plain).not.toContain('upload-webdav')
    expect(plain.slice(-2)).toEqual(['divider-asset-1', 'delete'])
  })

  it('多选上传按右键动作对象逐个上传', async () => {
    const handleUploadToBaiduyun = vi.fn()
    const a = { assetKey: 'a' }
    const b = { assetKey: 'b' }
    const c = { assetKey: 'c' }
    const run = async (clicked: unknown): Promise<unknown[]> => {
      handleUploadToBaiduyun.mockClear()
      const { handleContextMenuClick } = handlers(
        'views/AssetManagement/components/AssetFileList.vue',
        ['menuActionSources', 'getItemId', 'handleContextMenuClick'],
        {
          currentRightClickAsset: ref(clicked),
          selectedItems: ref([a, c]),
          libraryCaps: ref({ team: false }),
          handleUploadToBaiduyun
        }
      )
      await handleContextMenuClick('upload-baiduyun', {})
      return handleUploadToBaiduyun.mock.calls.map((call) => call[0])
    }
    expect(await run(a)).toEqual([a, c])
    expect(await run(b)).toEqual([b])
  })
})

describe('资产列表空白处右键', () => {
  it('导入文件 / 导入文件夹交给页面上同一套导入入口', async () => {
    const emit = vi.fn()
    const { emptyAreaMenuItems, handleContextMenuClick } = handlers(
      'views/AssetManagement/components/AssetFileList.vue',
      ['emptyAreaMenuItems', 'handleContextMenuClick'],
      {
        computed: (fn: () => unknown) => ({
          get value() {
            return fn()
          }
        }),
        t: (key: string) => key,
        libraryCaps: ref({ canImport: false, team: false }),
        currentRightClickAsset: ref(null),
        emit,
        PhFilePlus: 'i',
        PhFolderPlus: 'i',
        PhArrowClockwise: 'i'
      }
    )
    const items = (emptyAreaMenuItems as unknown as { value: Array<Record<string, unknown>> }).value
    expect(items.slice(0, 2).map((i) => [i.key, i.disabled])).toEqual([
      ['import-files', true],
      ['import-folder', true]
    ])
    await handleContextMenuClick('import-files', {})
    await handleContextMenuClick('import-folder', {})
    expect(emit.mock.calls).toEqual([['import-files'], ['import-folder']])
  })
})

describe('服务器资产库删除', () => {
  const setup = (apiKey: string): Record<string, ReturnType<typeof vi.fn>> => {
    const confirmDialog = vi.fn()
    const fetchMock = vi.fn(async () => ({ json: async () => ({ success: true }) }))
    vi.stubGlobal('fetch', fetchMock)
    const { handleDeleteVault } = handlers(
      'views/ServerManagement/index.vue',
      ['handleDeleteVault', 'deleteVault'],
      {
        t: (key: string, params?: Record<string, unknown>) =>
          params ? `${key}:${JSON.stringify(params)}` : key,
        confirmDialog,
        serverApiKey: ref(apiKey),
        getServerUrl: () => 'http://srv',
        getAuthHeaders: () => ({}),
        deletingVaultId: ref(null),
        message: { success: vi.fn(), error: vi.fn() },
        loadVaultList: vi.fn()
      }
    )
    handleDeleteVault({ vaultId: 'v1', name: 'Props' })
    return { confirmDialog, fetchMock }
  }

  it('先确认再删，正文写库名，并按是否填了管理员密钥说明服务器文件的去留', async () => {
    const { confirmDialog, fetchMock } = setup('')
    expect(fetchMock).not.toHaveBeenCalled()
    const options = confirmDialog.mock.calls[0][0]
    expect(options.danger).toBe(true)
    expect(options.content).toContain('createVaultModal.confirm.deleteWithoutApiKey')
    expect(options.content).toContain('Props')
    await options.onOk()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const withKey = setup('admin-key')
    expect(withKey.confirmDialog.mock.calls[0][0].content).toContain(
      'createVaultModal.confirm.deleteWithApiKey'
    )
    vi.unstubAllGlobals()
  })
})
