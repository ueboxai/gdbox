import { readFileSync } from 'node:fs'
import { parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import { computed, reactive, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'

// 抽出来的声明形状各不相同（computed、函数、常量表），这里按需取用
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

const emptyFilterForm = (): Record<string, unknown> =>
  reactive({
    fileCategory: undefined as string | undefined,
    assetTypes: [] as string[],
    sizeRange: undefined,
    dateRange: undefined,
    includeTags: [] as string[],
    excludeTags: [] as string[],
    hasNoTags: false,
    favoriteStatus: 'all',
    engineVersions: [] as string[]
  })

describe('标签筛选只有一份状态', () => {
  it('选一个标签徽标计 1，移除后归零', () => {
    const filterForm = emptyFilterForm()
    const { routingFilterCount } = handlers(
      'views/AssetManagement/index.vue',
      ['routingFilterCount'],
      {
        computed,
        filterForm
      }
    )
    filterForm.includeTags = ['7']
    expect(routingFilterCount.value).toBe(1)
    filterForm.includeTags = []
    expect(routingFilterCount.value).toBe(0)
  })

  it('筛选栏不再有第二份 tags 状态', () => {
    const bar = readFileSync(
      'src/renderer/src/views/AssetManagement/components/AssetFilterBar.vue',
      'utf8'
    )
    expect(bar).not.toMatch(/update:tags'/)
    expect(bar).not.toMatch(/\btagsProxy\b/)
  })
})

describe('右键改变选中时详情面板跟着换', () => {
  const setup = (selected: string[]): { state: { selected: string[] } } & Extracted => {
    const state = { selected: [...selected] }
    const emit = vi.fn()
    const context = {
      getItemId: (item: { id: string }) => item.id,
      getSelectedIds: () => state.selected,
      clearSelection: () => (state.selected = []),
      setSelected: (id: string) => state.selected.push(id),
      emit
    }
    const { selectForContextMenu } = handlers(
      'views/AssetManagement/components/AssetFileList.vue',
      ['selectForContextMenu'],
      context
    )
    return { state, emit, selectForContextMenu }
  }

  it('右键集合外的资产：选中改为它，并通知详情面板', () => {
    const { state, emit, selectForContextMenu } = setup(['a', 'c'])
    selectForContextMenu({ id: 'b', type: 'file' })
    expect(state.selected).toEqual(['b'])
    expect(emit).toHaveBeenCalledWith('file-click', { id: 'b', type: 'file' })
  })

  it('右键多选集合内的项：选中不动，菜单仍处理整个集合', () => {
    const { state, emit, selectForContextMenu } = setup(['a', 'b'])
    selectForContextMenu({ id: 'b', type: 'file' })
    expect(state.selected).toEqual(['a', 'b'])
    expect(emit).not.toHaveBeenCalled()
  })

  it('右键文件夹：详情面板换成文件夹', () => {
    const { emit, selectForContextMenu } = setup([])
    selectForContextMenu({ id: 'f1', type: 'folder' })
    expect(emit).toHaveBeenCalledWith('folder-select', { id: 'f1', type: 'folder' })
  })
})

describe('搜索时文件夹统计用真实总数', () => {
  it('搜索结果为空时仍报文件夹里的文件数', () => {
    const { selectedFolderDetail } = handlers(
      'views/AssetManagement/index.vue',
      ['selectedFolderDetail'],
      {
        computed,
        selectedKeys: ref(['tex']),
        currentPath: ref('/ALL/贴图'),
        treeData: ref([{ key: 'tex', title: '贴图' }]),
        t: (key: string) => key,
        currentFiles: ref([]),
        assetViewStore: { mode: 'assets' },
        selectionStore: { selectedShortcut: null },
        isSearching: ref(true),
        isShowingDeleted: ref(false),
        currentFolderCounts: reactive({ folders: 0, files: 4 })
      }
    )
    expect(selectedFolderDetail.value).toMatchObject({ foldersCount: 0, filesCount: 4 })
  })
})

describe('头脑风暴卡片底色', () => {
  it('走主题变量，不写死只适配深色的 rgba', () => {
    const { STUDIO_TOOL_TINTS } = handlers(
      'views/Notebook/components/NoteStudioPanel.vue',
      ['STUDIO_TOOL_TINTS'],
      {}
    )
    expect(STUDIO_TOOL_TINTS.brainstorm).toMatch(/var\(--color-/)
  })
})
