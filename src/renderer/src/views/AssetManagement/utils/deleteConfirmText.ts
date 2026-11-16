/**
 * 删除确认正文选哪一句：单项写名字，只有文件 / 只有文件夹时不出现「0 个文件夹」这类零项。
 * 返回的 kind 对应语言包里 `deleteConfirm.content.*`（共享库是 `deleteConfirm.network.content.*`）。
 */
export type DeleteConfirmKind = 'named' | 'files' | 'folders' | 'mixed'

export function deleteConfirmMessage(options: {
  filesCount: number
  foldersCount: number
  name?: string
}): { kind: DeleteConfirmKind; params: Record<string, string | number> } {
  const { filesCount, foldersCount, name } = options
  if (filesCount + foldersCount === 1 && name) return { kind: 'named', params: { name } }
  if (foldersCount === 0) return { kind: 'files', params: { count: filesCount } }
  if (filesCount === 0) return { kind: 'folders', params: { count: foldersCount } }
  return { kind: 'mixed', params: { filesCount, foldersCount } }
}
