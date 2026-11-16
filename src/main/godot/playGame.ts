/**
 * 把游戏开在一个真窗口里给用户玩。
 *
 * 和 `godot_run` 不是一回事：那个是 Agent 自己按时间表按键、盯数值的无头试玩；
 * 这个是给人玩的 —— 窗口在屏幕上、用户的键盘鼠标、玩多久用户说了算。
 * 入口有三个：对话顶栏的「运行」、项目卡片、Agent 的 `godot_play`（用户说「打开我玩一下」）。
 *
 * - 先按需导入：Agent 刚生成的图和声音还没导入的话，游戏里看不到。
 * - 每个工程同时只开一局：再点一次是重开，不是多开一个窗口 —— 改完代码点一下就是看新版本。
 * - 输出收进 `.gdbox/tmp/play.log`（只留最近一截），Agent 能读到用户玩的时候报了什么错。
 * - 不用后台检查那份隔离的用户数据目录：这是用户在玩，存档该和他自己运行时是同一份。
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { ensureImported } from './importState'

export interface GameStatus {
  projectDir: string
  running: boolean
  /** 退出码；还在跑或被我们关掉的是 null */
  exitCode?: number | null
  /** 退出前日志里的报错（最多几条） */
  errors?: string[]
}

interface Running {
  child: ChildProcess
  log: string
  stoppedByUs: boolean
}

const LOG_LIMIT = 200_000
const games = new Map<string, Running>()
let listener: ((status: GameStatus) => void) | undefined

/** 运行状态变了（开了、关了、崩了）通知界面 */
export function setGameStatusListener(fn: ((status: GameStatus) => void) | undefined): void {
  listener = fn
}

const keyOf = (projectDir: string): string =>
  projectDir.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

function logPath(projectDir: string): string {
  return join(projectDir, '.gdbox', 'tmp', 'play.log')
}

function flushLog(projectDir: string, log: string): void {
  try {
    const dir = join(projectDir, '.gdbox', 'tmp')
    mkdirSync(dir, { recursive: true })
    // .gdbox 不让 Godot 导入
    if (!existsSync(join(projectDir, '.gdbox', '.gdignore')))
      writeFileSync(join(projectDir, '.gdbox', '.gdignore'), '')
    writeFileSync(logPath(projectDir), log)
  } catch {
    // 日志写不下不影响游戏
  }
}

/** 日志里的报错行：Godot 的 `ERROR:` / `SCRIPT ERROR:`，连同下一行的位置 */
export function errorsInLog(log: string, max = 8): string[] {
  const lines = log.split(/\r?\n/)
  const found: string[] = []
  for (let i = 0; i < lines.length && found.length < max; i++) {
    const line = lines[i]!
    if (/^(SCRIPT )?ERROR:/.test(line.trim())) {
      const at = lines[i + 1]?.trim()
      found.push(at && /^at:/.test(at) ? `${line.trim()} (${at})` : line.trim())
    }
  }
  return found
}

export function isGameRunning(projectDir: string): boolean {
  return games.has(keyOf(projectDir))
}

export function stopGame(projectDir: string): boolean {
  const game = games.get(keyOf(projectDir))
  if (!game) return false
  game.stoppedByUs = true
  game.child.kill()
  return true
}

export interface PlayOptions {
  /** `res://` 场景；不给就是工程的主场景 */
  scene?: string
  signal?: AbortSignal
}

export async function playGame(
  godotPath: string,
  projectDir: string,
  options: PlayOptions = {}
): Promise<{ pid: number }> {
  if (!existsSync(join(projectDir, 'project.godot')))
    throw new Error(`${projectDir} 下没有 project.godot`)
  const key = keyOf(projectDir)
  const previous = games.get(key)
  if (previous) {
    previous.stoppedByUs = true
    previous.child.kill()
    games.delete(key)
  }

  await ensureImported(godotPath, projectDir, options.signal)

  const args = ['--path', projectDir, ...(options.scene ? [options.scene] : [])]
  const child = spawn(godotPath, args, { windowsHide: false, stdio: ['ignore', 'pipe', 'pipe'] })
  const spawnError = await new Promise<Error | undefined>((resolve) => {
    child.once('error', resolve)
    child.once('spawn', () => resolve(undefined))
  })
  if (spawnError) throw spawnError

  const game: Running = { child, log: '', stoppedByUs: false }
  games.set(key, game)
  const append = (chunk: Buffer): void => {
    game.log += chunk.toString('utf8')
    if (game.log.length > LOG_LIMIT) game.log = game.log.slice(-LOG_LIMIT)
  }
  child.stdout?.on('data', append)
  child.stderr?.on('data', append)
  // 定时落盘：Agent 在用户还玩着的时候也能读到报错
  const timer = setInterval(() => flushLog(projectDir, game.log), 2_000)
  child.once('exit', (code) => {
    clearInterval(timer)
    flushLog(projectDir, game.log)
    if (games.get(key) === game) games.delete(key)
    // 被「重开」顶掉的那一局不报：新的一局已经报过「在跑」了
    if (!game.stoppedByUs || !games.has(key)) {
      listener?.({
        projectDir,
        running: false,
        exitCode: game.stoppedByUs ? null : code,
        errors: errorsInLog(game.log)
      })
    }
  })
  listener?.({ projectDir, running: true })
  return { pid: child.pid ?? 0 }
}

/** 这一局到目前为止的输出（还在跑的读内存，已经退了的读落盘那份） */
export function gameLog(projectDir: string): string {
  return games.get(keyOf(projectDir))?.log ?? ''
}
