/**
 * 「闪存」—— 用户按下发送那一瞬间的编辑器状态。
 *
 * ## 要解决的是时间差，不是能力缺失
 *
 * 用户在场景树里选中几个节点，快捷键拉起小窗口，发一句「啥意思」。等模型思考完
 * 再去调 `editor_scene_tree`，查到的是**那个时候**的编辑器 —— 用户很可能已经切了
 * 窗口、换了选区。两边说的不是同一件事，答得再好也答的是另一个问题。
 *
 * 所以「这个」必须在用户说出它的那一刻就被钉住，跟着这条消息一起进模型上下文。
 *
 * ## 这不是 V2 的黑板
 *
 * `focusContext.ts` 的头注释记着 V2 那块 per-session 黑板为什么被拆：它缓存
 * 「当前开着什么」，会过期。闪存回答的是**另一个问题**：
 *
 * | | V2 黑板 | 闪存 |
 * |---|---|---|
 * | 回答 | 「**现在**开着什么」 | 「用户**说这句话时**开着什么」 |
 * | 过期 | 缺陷 | 本意 —— 它就该停在那一刻 |
 * | 寿命 | 跨消息、跨轮次 | 只属于一条消息，随它进 JSONL，永不改写 |
 *
 * 和 `<runtime-status>` 信封是同一种东西（见 `runtimeEnvelope.ts`）：发送瞬间机器
 * 核对过的事实，只追加不回头改。**闪存就是信封的一个新段落，不是新机制。**
 *
 * ## 为什么不走 `getFocusContext()`
 *
 * 那个函数把异常吞掉返回空对象 —— 「没连」「超时」「连着但什么都没开」三种情况
 * 长得一模一样。而闪存必须分得清：查不到就整块不出现，绝不能把一次超时写成
 * 「用户什么都没开着」送进模型。所以这里直接调 `callRequest` 自己判。
 */

import type { FocusContext } from './focusContext'
import type { SessionProjectScope } from './sessionScope'
import type {
  EditorSnapshot,
  EditorSnapshotCaptureResult as CaptureResult
} from '../../../shared/editorSnapshot'

// 类型定义在 `shared/` —— 预加载层和渲染层也要认识它，而它们不该依赖 `src/main/**`。
// 主进程侧统一从这个文件拿，不用两处 import。
export type { EditorSnapshot, CaptureResult }

/** 抓取超时。顺带的事不能拖住主事：卡住就放弃，绝不让一条消息发不出去 */
const TIMEOUT_MS = 2_000

export interface CaptureInput {
  /** 这一轮算出来的作用域。目标连接从它来，**绝不传 undefined 让底层挑** */
  scope: SessionProjectScope
  /**
   * 此刻有没有任何交互式编辑器连着。
   *
   * 用来区分「一个都没连」和「连着，但不是这条对话的工程」。作用域本身分不出来：
   * 两种情况它都只是没有 `targetConnectionId`。
   */
  anyConnected: boolean
  timeoutMs?: number
}

/**
 * 问引擎「用户此刻在看什么、选了什么」。
 *
 * **永远不抛。** 这是发送流程上顺带的一步，任何失败都只意味着「这条消息不带快照」。
 *
 * 目标连接必须显式给。不给的话服务端看到只有一个活连接就会自动选它
 * （`server.ts` 的 `pickDefaultConnectionId`）—— 那就是**别的工程**的快照，
 * 而且从结果上完全看不出来。
 */
export async function captureEditorSnapshot(input: CaptureInput): Promise<CaptureResult> {
  const { scope, anyConnected } = input
  const connectionId = scope.targetConnectionId

  if (!connectionId) {
    // 一个都没连 vs 连着但不是你的工程 —— 对用户是两句完全不同的话
    return { ok: false, reason: anyConnected ? 'project-offline' : 'not-connected' }
  }

  try {
    /*
     * 懒加载 `serviceManager`。
     *
     * 静态引它会把 WebSocket 服务、任务执行器一路拉进来，最终连上
     * `better-sqlite3` 的原生模块 —— 而这个文件的纯函数（格式化、剥块）被
     * `host/eventBridge` 引着，那条链上的测试会因此在 vitest 的 worker 线程里
     * 加载原生模块，整个测试进程段错误退出（AGENTS.md 第 7 节记着这个坑）。
     */
    const { serviceManager } = await import('../../services')
    const focus = await serviceManager
      .getWebSocketService()
      .callRequest<FocusContext>(
        'editor.get_focus_context',
        {},
        connectionId,
        input.timeoutMs ?? TIMEOUT_MS
      )

    // 插件成功回复时一定是个对象（什么都没开也有 openScenes / selectedNodes），
    // 所以拿到 null/undefined 只能是协议对不上，按失败处理
    if (!focus) return { ok: false, reason: 'error' }

    return {
      ok: true,
      snapshot: {
        capturedAt: new Date().toISOString(),
        project: {
          projectName: scope.connectedProject?.projectName || '',
          ...(scope.connectedProject?.projectPath
            ? { projectPath: scope.connectedProject.projectPath }
            : {}),
          connectionId
        },
        focus
      }
    }
  } catch (error) {
    const code = (error as { code?: string } | undefined)?.code
    const reason = code === 'E_TIMEOUT' ? 'timeout' : 'error'
    console.warn(`[AgentV3] 闪存抓取失败（${reason}）:`, (error as Error).message)
    return { ok: false, reason }
  }
}

/** 路径大小写、斜杠方向、结尾斜杠都可能不一致（同 `sessionScope.ts`） */
function normalizePath(value: string | undefined): string {
  return (value || '').trim().toLowerCase().replace(/\\/g, '/').replace(/\/+$/, '')
}

/**
 * 这份快照说的，是不是这一轮真正要操作的那个工程。
 *
 * 执行前的最后一道闸。前面每一步都做对了它永远不会拦下任何东西 —— 留着是因为
 * 一旦拦不住，后果是「拿着 A 工程的选区，在 B 工程上动手」：模型会照着一份看起来
 * 完全合理的快照去改一个根本不是它的资产，而且全程不报错。
 *
 * **认路径不认连接 id**：编辑器重连一次 id 就换，工程还是那个工程。
 */
export function snapshotMatchesScope(
  snapshot: EditorSnapshot,
  scope: SessionProjectScope
): boolean {
  // 这一轮压根没有目标工程（归属的没连上）。块描述的东西这轮碰不到，不给
  if (!scope.targetConnectionId) return false

  const target = scope.connectedProject
  const snapshotPath = normalizePath(snapshot.project.projectPath)
  const targetPath = normalizePath(target?.projectPath)
  if (snapshotPath && targetPath) return snapshotPath === targetPath

  // 有一边没记下路径时退回比名字。两边都没有就当对不上 —— 宁可不给块
  const snapshotName = (snapshot.project.projectName || '').trim().toLowerCase()
  const targetName = (target?.projectName || '').trim().toLowerCase()
  return Boolean(snapshotName) && snapshotName === targetName
}

const BLOCK_OPEN = '<editor-snapshot'
const BLOCK_CLOSE = '</editor-snapshot>'

/** `选中 N 个` / `选中 73 个，只列前 50` */
function countLabel(shown: number, total: number): string {
  return total > shown ? `${total}, showing ${shown}` : String(total)
}

/** 把快照拼成进模型的那个块。不带坐标：模型用不上，而一条节点的坐标占的字数和它的名字一样多 */
export function formatEditorSnapshotBlock(snapshot: EditorSnapshot): string {
  const focus = snapshot.focus
  const lines: string[] = []

  const attrs = [`captured_at="${snapshot.capturedAt}"`]
  if (snapshot.project.projectName) attrs.push(`project="${snapshot.project.projectName}"`)
  lines.push(`${BLOCK_OPEN} ${attrs.join(' ')}>`)

  const scene = focus.editedScene
  lines.push(
    scene
      ? `edited_scene: ${scene.name}${scene.path ? ` (${scene.path})` : ''}`
      : 'edited_scene: none'
  )

  const nodes = focus.selectedNodes ?? []
  if (nodes.length > 0) {
    lines.push(
      `selected_nodes (${countLabel(nodes.length, focus.selectedNodeCount ?? nodes.length)}):`
    )
    lines.push(...nodes.map((node) => `- ${node.name} (${node.class}) ${node.path}`))
  } else {
    lines.push('selected_nodes: none')
  }

  const fileSystem = focus.fileSystem
  const files = fileSystem?.selectedFiles ?? []
  const folders = fileSystem?.selectedFolders ?? []
  if (files.length > 0 || folders.length > 0) {
    lines.push('filesystem_selection:')
    if (files.length > 0) {
      lines.push(
        `  files (${countLabel(files.length, fileSystem?.selectedFileCount ?? files.length)}):`
      )
      lines.push(...files.map((file) => `  - ${file.name} ${file.path}`))
    }
    if (folders.length > 0) lines.push(`  folders: ${folders.join(', ')}`)
  } else {
    lines.push('filesystem_selection: none')
  }

  lines.push(BLOCK_CLOSE)
  return lines.join('\n')
}

/**
 * 把开头那个块剥掉，还原用户真正说的话。
 *
 * 插话的「已生效」回执靠**文本相等**匹配（`agentStream.markSteerApplied`）：
 * 界面存的是用户打的原话，而模型收到的是「块 + 原话」。不剥的话两边永远对不上，
 * 用户会一直看着自己那句插话显示「未生效」—— 而它其实早就进去了。
 *
 * 只认开头的那一个块。用户自己在消息中间打出这串字符不该被动到。
 */
export function stripEditorSnapshotBlock(text: string): string {
  if (!text.startsWith(BLOCK_OPEN)) return text
  const end = text.indexOf(BLOCK_CLOSE)
  if (end < 0) return text
  return text.slice(end + BLOCK_CLOSE.length).replace(/^\r?\n\r?\n?/, '')
}

/**
 * 系统提示词里那段**不变**的解读规则。
 *
 * 和信封规则同一个道理（见 `runtimeEnvelope.ts` 的 `RUNTIME_ENVELOPE_RULES`）：
 * 事实每轮不同、规则一个字不变，混在一起写会让 Prompt Cache 一次也命中不了。
 *
 * 全英文的理由同 `createAgent.ts` 的 `buildSystemPrompt`。
 */
export const EDITOR_SNAPSHOT_RULES: readonly string[] = Object.freeze([
  'Editor snapshot:',
  'Some user messages start with an `<editor-snapshot>` block — what the Godot editor looked like **at the moment the user pressed send**, captured before you began thinking.',
  '- It is a point-in-time record, not live state. The user may have changed the selection seconds later; that does not change what they were pointing at when they spoke. Snapshots on older messages are historical observations, exactly like older `<runtime-status>` envelopes.',
  '- When the user says "this" / "these" / "here" without naming anything: if the snapshot has exactly one kind of selection (only nodes, or only files), that is what they mean — act on it, do not ask and do not call a tool first. If both are selected, or the sentence works either way, ask one short question instead of guessing.',
  '- Call `editor_scene_tree` only when you need the state **right now** — the user asks you to look again, or the thing you are about to change may have moved since. Do not call it merely to confirm what the snapshot already says.'
])
