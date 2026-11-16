/**
 * 资产列表一条都没有时显示哪种空状态。
 *
 * 原因不同，用户下一步该做的事也不同：回收站、收藏是固定视图，只说一句；
 * 搜索或筛选把东西筛没了，该去清除筛选；文件夹本身是空的，该去导入。
 * 以前一律显示「暂无资产 / 添加资产」，搜了个不存在的词也让人去导入。
 */
export type FileListEmptyKind = 'trash' | 'favorites' | 'filtered' | 'noFolder' | 'folder'

export interface FileListEmptyInput {
  /** selectionStore.selectedShortcut：'recent' / 'deleted' 是回收站，'favorites' 是收藏 */
  shortcut?: string | null
  /** 有关键字或任何筛选条件 */
  hasQuery?: boolean
  folderKey?: string
}

export function fileListEmptyKind(input: FileListEmptyInput): FileListEmptyKind {
  if (input.shortcut === 'recent' || input.shortcut === 'deleted') return 'trash'
  if (input.shortcut === 'favorites') return 'favorites'
  if (input.hasQuery) return 'filtered'
  if (!input.folderKey) return 'noFolder'
  return 'folder'
}

/** 每种空状态的标题 key */
export const FILE_LIST_EMPTY_TITLE: Record<FileListEmptyKind, string> = {
  trash: 'assetLib.fileList.emptyTrash',
  favorites: 'assetLib.fileList.emptyFavorites',
  filtered: 'assetLib.fileList.emptyFiltered',
  noFolder: 'assetLib.fileList.selectFolder',
  folder: 'assetLib.fileList.empty'
}
