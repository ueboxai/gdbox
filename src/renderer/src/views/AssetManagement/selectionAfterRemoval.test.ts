/**
 * 删除、恢复、Ctrl+取消选中之后，选中集合和详情面板不能停在已经不在的那一项上。
 *
 * 红灯用例：
 * - 删除成功后详情面板还显示已删的资产 / 文件夹；
 * - 回收站恢复了两项，列表空了，底栏仍是「已选择 2 项」；
 * - Ctrl+点已选中的项取消选中，详情面板却显示刚取消的那一项。
 */
import { readFileSync } from 'node:fs'
import { parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Extracted = Record<string, any>

// 从 SFC 里只抽出要测的那几条声明来跑，不挂整页
function handlers(file: string, names: string[], context: Record<string, unknown>): Extracted {
  const source = parse(readFileSync(`src/renderer/src/${file}`, 'utf8')).descriptor.scriptSetup!
    .content
  const ast = ts.createSourceFile('handlers.ts', source, ts.ScriptTarget.Latest, true)
  const declarations = ast.statements.filter(
    (statement) =>
      ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some((item) => names.includes(item.name.getText(ast)))
  )
  const code = ts.transpileModule(declarations.map((item) => item.getText(ast)).join('\n;\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText
  return new Function(...Object.keys(context), `${code}; return { ${names.join(', ')} }`)(
    ...Object.values(context)
  )
}

const FILE_LIST = 'views/AssetManagement/components/AssetFileList.vue'

const message = { success: vi.fn(), warning: vi.fn(), error: vi.fn() }
const t = (key: string): string => key

function fileListContext(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    message,
    t,
    resolveErrorText: (_err: unknown, fallback: string) => fallback,
    currentVault: ref({ id: 'v1', vaultType: 'local' }),
    isHttpNetworkVault: ref(false),
    VaultType: { NETWORK: 'network' },
    assetContext: {
      removeFiles: vi.fn(),
      removeTreeNodes: vi.fn(),
      refreshTree: vi.fn(async () => undefined),
      refreshCurrentFolder: vi.fn(async () => undefined)
    },
    clearSelection: vi.fn(),
    setSelected: vi.fn(),
    window: {},
    ...overrides
  }
}

describe('列表移除后通知详情面板', () => {
  it('删除成功后把删掉的键发给父组件', async () => {
    const emit = vi.fn()
    const { performMixedDelete } = handlers(
      FILE_LIST,
      ['performMixedDelete'],
      fileListContext({
        emit,
        assetDataAPI: { batchDelete: vi.fn(async () => ({ deleted: 1 })) },
        assetFolderAPI: { batchDelete: vi.fn(async () => undefined) }
      })
    )
    await performMixedDelete(['a1'], ['f1'])
    expect(emit).toHaveBeenCalledWith('items-removed', ['a1', 'f1'])
  })

  it('删除失败不通知', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const emit = vi.fn()
    const { performMixedDelete } = handlers(
      FILE_LIST,
      ['performMixedDelete'],
      fileListContext({
        emit,
        assetDataAPI: {
          batchDelete: vi.fn(async () => {
            throw new Error('boom')
          })
        },
        assetFolderAPI: { batchDelete: vi.fn() }
      })
    )
    await performMixedDelete(['a1'], [])
    expect(emit).not.toHaveBeenCalled()
  })

  it('回收站恢复成功的项从选中集合里移除', async () => {
    const emit = vi.fn()
    const setSelected = vi.fn()
    const { performRestoreInTrash } = handlers(
      FILE_LIST,
      ['performRestoreInTrash'],
      fileListContext({
        emit,
        setSelected,
        assetDataAPI: {
          restoreMany: vi.fn(async () => ({ restored: ['a1', 'a2'], failed: [] }))
        },
        assetFolderAPI: { restore: vi.fn() }
      })
    )
    await performRestoreInTrash(['a1', 'a2'], [])
    expect(setSelected).toHaveBeenCalledWith(['a1', 'a2'], false)
    expect(emit).toHaveBeenCalledWith('items-removed', ['a1', 'a2'])
  })

  it('彻底删除成功的项从选中集合里移除', async () => {
    const emit = vi.fn()
    const setSelected = vi.fn()
    const { performPermanentDeleteInTrash } = handlers(
      FILE_LIST,
      ['performPermanentDeleteInTrash'],
      fileListContext({
        emit,
        setSelected,
        assetDataAPI: { hardDeleteMany: vi.fn(async () => ({ deleted: ['a1'] })) },
        assetFolderAPI: { hardDelete: vi.fn() }
      })
    )
    await performPermanentDeleteInTrash(['a1'], [])
    expect(setSelected).toHaveBeenCalledWith(['a1'], false)
    expect(emit).toHaveBeenCalledWith('items-removed', ['a1'])
  })
})

describe('Ctrl+点击取消选中后的详情面板', () => {
  const files = [
    { type: 'folder', id: 'f1', name: 'F' },
    { type: 'file', assetKey: 'a1', name: 'A' },
    { type: 'file', assetKey: 'a2', name: 'B' }
  ]

  function setup(selectedAfterClick: string[]): {
    emit: ReturnType<typeof vi.fn>
    click: (file: unknown, event: MouseEvent) => void
  } {
    const emit = vi.fn()
    const { handleItemClick } = handlers(FILE_LIST, ['handleItemClick', 'getItemId'], {
      contextMenuRef: ref(null),
      handleSelectionClick: vi.fn(),
      isSelected: (id: string) => selectedAfterClick.includes(id),
      getSelectedIds: () => selectedAfterClick,
      props: { files },
      emit,
      emitFolderOpen: vi.fn()
    })
    return { emit, click: handleItemClick }
  }

  it('取消的那一项不显示，改显示剩余选中里最后一项', () => {
    const { emit, click } = setup(['f1', 'a2'])
    click(files[1], new MouseEvent('click', { ctrlKey: true }))
    expect(emit).toHaveBeenCalledWith('file-click', files[2])
    expect(emit).not.toHaveBeenCalledWith('file-click', files[1])
  })

  it('剩下的是文件夹就显示文件夹', () => {
    const { emit, click } = setup(['f1'])
    click(files[1], new MouseEvent('click', { ctrlKey: true }))
    expect(emit).toHaveBeenCalledWith('folder-select', files[0])
  })

  it('一项都不剩就清空详情面板', () => {
    const { emit, click } = setup([])
    click(files[1], new MouseEvent('click', { ctrlKey: true }))
    expect(emit).toHaveBeenCalledWith('empty-click')
    expect(emit).toHaveBeenCalledTimes(1)
  })
})

describe('资产库页收到移除通知', () => {
  function setup(): Extracted & {
    selectedAsset: ReturnType<typeof ref>
    selectedListFolder: ReturnType<typeof ref>
  } {
    const selectedAsset = ref<Record<string, unknown> | null>({ assetKey: 'a1', id: 1 })
    const selectedListFolder = ref<Record<string, unknown> | null>({ key: 'f1' })
    const extracted = handlers(
      'views/AssetManagement/index.vue',
      ['handleItemsRemoved', 'folderSelectionRequestToken'],
      { selectedAsset, selectedListFolder }
    )
    return { ...extracted, selectedAsset, selectedListFolder }
  }

  it('详情面板上的资产 / 文件夹在被移除的集合里就清空', () => {
    const { handleItemsRemoved, selectedAsset, selectedListFolder } = setup()
    handleItemsRemoved(['a1', 'f1'])
    expect(selectedAsset.value).toBeNull()
    expect(selectedListFolder.value).toBeNull()
  })

  it('不在集合里的保持不动', () => {
    const { handleItemsRemoved, selectedAsset, selectedListFolder } = setup()
    handleItemsRemoved(['other'])
    expect(selectedAsset.value).not.toBeNull()
    expect(selectedListFolder.value).not.toBeNull()
  })
})
