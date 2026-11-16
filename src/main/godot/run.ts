import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'

/**
 * GDBox 在后台起的 Godot（检查、截图、试玩）用一份独立的用户数据目录。
 *
 * 所有 Godot 共用 %APPDATA%\Godot 下的编辑器设置和缓存。用户自己开着编辑器、或者别的 Godot 进程
 * 正好在启动/退出时，后台这个会偶发失败（实测踩到过）。后台运行用不到用户的编辑器设置，隔开最稳。
 */
export function isolatedGodotEnv(
  root: string = join(tmpdir(), 'gdbox-godot-userdata')
): NodeJS.ProcessEnv {
  const appData = join(root, 'Roaming')
  const localAppData = join(root, 'Local')
  mkdirSync(appData, { recursive: true })
  mkdirSync(localAppData, { recursive: true })
  return process.platform === 'win32'
    ? { ...process.env, APPDATA: appData, LOCALAPPDATA: localAppData }
    : {
        ...process.env,
        XDG_DATA_HOME: join(root, 'data'),
        XDG_CONFIG_HOME: join(root, 'config'),
        XDG_CACHE_HOME: join(root, 'cache')
      }
}

export interface RunResult {
  code: number | null
  output: string
  timedOut: boolean
}

/**
 * 跑一次 Godot 命令行，stdout 和 stderr 合在一起收（Godot 的报错两边都会打）。
 * 超时就杀掉，不留后台进程。
 */
export function runGodot(
  godotPath: string,
  args: string[],
  options: {
    timeoutMs: number
    signal?: AbortSignal
    cwd?: string
    /**
     * 这一次单独用的用户数据目录（`user://` 存档、设置都落在它下面）。不给就用后台共用的那一份。
     * 回放回归每遍都给一个新的：上一遍写下的存档留到下一遍，两遍就跑不出同一个结果
     */
    userDataRoot?: string
  }
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(godotPath, args, {
      cwd: options.cwd,
      windowsHide: true,
      env: isolatedGodotEnv(options.userDataRoot)
    })
    let output = ''
    let timedOut = false
    const onData = (chunk: Buffer): void => {
      output += chunk.toString('utf8')
      // 防止失控的日志撑爆内存
      if (output.length > 2_000_000) output = output.slice(-1_000_000)
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, options.timeoutMs)
    const onAbort = (): void => {
      child.kill()
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })
    child.on('error', (err) => {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      resolve({ code, output, timedOut })
    })
  })
}

export interface LogDigest {
  errors: string[]
  warnings: string[]
  /** 被过滤掉的退出期泄漏报告条数 */
  exitLeakNotices: number
}

/**
 * 退出时的资源泄漏报告。Godot 4.7.x 里，headless 运行期间只要播过音频，
 * 退出时就会打这几类 ERROR/WARNING，跟游戏本身无关，会淹没真正的报错。
 * 只过滤这几条确切的句式，并把条数报出来，不做模糊匹配。
 */
const EXIT_LEAK_MARKERS = [
  'resources still in use at exit',
  'ObjectDB instances leaked at exit',
  'RID allocations of type',
  'Leaked instance:',
  'were leaked at exit'
]

/** 把 Godot 输出按条目归并：`ERROR:`/`WARNING:` 开头一条，后面缩进的 `at:` 行并进去。 */
export function digestGodotLog(output: string): LogDigest {
  const errors: string[] = []
  const warnings: string[] = []
  let exitLeakNotices = 0
  let current: { level: 'error' | 'warning'; lines: string[] } | null = null

  const flush = (): void => {
    if (!current) return
    const text = current.lines.join('\n')
    if (EXIT_LEAK_MARKERS.some((m) => text.includes(m))) exitLeakNotices++
    else (current.level === 'error' ? errors : warnings).push(text)
    current = null
  }

  for (const raw of output.split(/\r?\n/)) {
    const line = stripVTControlCharacters(raw)
    const trimmed = line.trimStart()
    if (/^(SCRIPT ERROR|USER ERROR|ERROR):/.test(trimmed)) {
      flush()
      current = { level: 'error', lines: [trimmed] }
    } else if (/^(USER WARNING|WARNING):/.test(trimmed)) {
      flush()
      current = { level: 'warning', lines: [trimmed] }
    } else if (current && /^\s+(at|GDScript backtrace)/.test(line)) {
      current.lines.push(trimmed)
    } else {
      flush()
    }
  }
  flush()
  return { errors: collapseRepeats(errors), warnings: collapseRepeats(warnings), exitLeakNotices }
}

/** 每帧都报的同一条错误只留一条，按首次出现的顺序，后面标出现次数。 */
function collapseRepeats(entries: string[]): string[] {
  const counts = new Map<string, number>()
  for (const e of entries) counts.set(e, (counts.get(e) ?? 0) + 1)
  return [...counts].map(([text, n]) => (n > 1 ? `${text}\n(×${n})` : text))
}
