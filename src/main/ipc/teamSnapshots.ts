/**
 * 工作室模式的快照宿主：每个队员交回改动时存一份工程快照，制作人可以列出来、退回到某一份。
 *
 * 存、列、退回的实现在 `core/team/snapshots.ts`（工程里一个独立的 git 库，`.gdbox/snapshots`）。
 * 这里只做宿主那一半：用哪个 git、操作哪个工程、退回之后让编辑器跟上。
 *
 * 和虚幻版本最大的不同：Godot 的场景、资源、脚本都是文本，退回不需要关编辑器。
 * 文件换回去之后让连着的编辑器重扫一遍、把开着的场景从磁盘重新加载就行。
 */

import { execFile } from 'child_process'

import { getTargetProjectPath } from '../agent-v3/core/projectTargetContext'
import {
  createSnapshotStore,
  type GitRunner,
  type SnapshotStore,
  type TeamSnapshots
} from '../agent-v3/core/team/snapshots'

const gitRunner: GitRunner = (args, cwd) =>
  new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd, windowsHide: true, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0
        resolve({ code, stdout: String(stdout), stderr: String(stderr || error?.message || '') })
      }
    )
  })

/** 退回之后让编辑器跟上：重扫文件系统，开着的场景从磁盘重新加载。编辑器没连就算了 */
async function refreshEditor(): Promise<string> {
  try {
    const { callEditor } = await import('../agent-v3/tools/editorRpc')
    await callEditor('editor.rescan', {}, { timeoutMs: 10_000 })
    const status = await callEditor<{ open_scenes?: string[] }>('editor.status', {}, { timeoutMs: 5_000 })
    for (const path of status.open_scenes ?? []) {
      await callEditor('editor.reload_scene', { path }, { timeoutMs: 10_000 }).catch(() => undefined)
    }
    return '编辑器已重扫文件，开着的场景已从磁盘重新加载。'
  } catch {
    return '编辑器没连着；下次打开工程时会读到退回后的文件。'
  }
}

export function createTeamSnapshots(): TeamSnapshots {
  const stores = new Map<string, SnapshotStore>()
  const storeFor = (projectDir: string): SnapshotStore => {
    let store = stores.get(projectDir)
    if (!store) {
      store = createSnapshotStore(projectDir, gitRunner)
      stores.set(projectDir, store)
    }
    return store
  }
  const currentProject = (): string => {
    const dir = getTargetProjectPath()
    if (!dir) throw new Error('这一轮没有归属工程，没法存快照')
    return dir
  }

  return {
    async save(message) {
      const dir = getTargetProjectPath()
      return dir ? storeFor(dir).save(message) : null
    },
    list: (limit) => storeFor(currentProject()).list(limit),
    async rollback(id, report) {
      const store = storeFor(currentProject())
      try {
        await store.resolve(id)
      } catch (error) {
        const known = await store.list(5).catch(() => [])
        throw new Error(
          `${error instanceof Error ? error.message : String(error)}。最近的：${
            known.map((s) => s.id).join('、') || '（无）'
          }`
        )
      }
      // 先把眼下的状态存一份：退回本身也能反悔
      const before = await store.save('退回前的状态（自动存）')
      report(`正在退回到 ${id}…`)
      const after = await store.restore(id)
      const editor = await refreshEditor()
      return [
        `已退回到 ${id}${after ? `（存为 ${after.id}）` : ''}。`,
        before ? `退回前的状态存为 ${before.id}，要反悔就退回到它。` : '',
        editor
      ]
        .filter(Boolean)
        .join('\n')
    }
  }
}
