/**
 * 「运行游戏」按钮的状态：这个工程的游戏在不在跑、开、关。
 *
 * 主进程开了、关了、崩了都会推 `game:status`（见 main/ipc/playGame.ts），这里只认自己这个工程的。
 * 崩了的话把报错交给调用方显示 —— 用户玩着玩着窗口没了，得知道为什么。
 */

import { onBeforeUnmount, ref, watch, type Ref } from 'vue'

interface GameStatus {
  projectDir: string
  running: boolean
  exitCode?: number | null
  errors?: string[]
}

const sameDir = (a: string, b: string): boolean =>
  a.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() ===
  b.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

export function useGamePlay(
  projectPath: Ref<string>,
  onCrash?: (status: GameStatus) => void
): {
  running: Ref<boolean>
  starting: Ref<boolean>
  play: () => Promise<{ success: boolean; error?: string }>
  stop: () => Promise<void>
} {
  const running = ref(false)
  const starting = ref(false)

  const refresh = async (): Promise<void> => {
    if (!projectPath.value) {
      running.value = false
      return
    }
    const result = (await window.api.invoke('game:status', projectPath.value).catch(() => null)) as {
      running?: boolean
    } | null
    running.value = Boolean(result?.running)
  }
  watch(projectPath, () => void refresh(), { immediate: true })

  // preload 的 on() 剥掉了 IpcRendererEvent，第一个参数就是 payload；返回值要原样交给 off()
  const handle = window.api.on('game:status', (...args: unknown[]) => {
    const status = args[0] as GameStatus | undefined
    if (!projectPath.value || !status?.projectDir) return
    // 主进程给的是工程目录；对话上记的可能是目录也可能是 project.godot
    const mine = projectPath.value.replace(/[\\/]project\.godot$/i, '')
    if (!sameDir(mine, status.projectDir)) return
    running.value = status.running
    if (!status.running && status.exitCode !== null && status.exitCode !== undefined && status.exitCode !== 0) {
      onCrash?.(status)
    }
  })
  onBeforeUnmount(() => window.api.off('game:status', handle))

  const play = async (): Promise<{ success: boolean; error?: string }> => {
    if (!projectPath.value || starting.value) return { success: false }
    starting.value = true
    try {
      return (await window.api.invoke('game:play', projectPath.value)) as { success: boolean; error?: string }
    } finally {
      starting.value = false
    }
  }

  const stop = async (): Promise<void> => {
    if (!projectPath.value) return
    await window.api.invoke('game:stop', projectPath.value)
  }

  return { running, starting, play, stop }
}
