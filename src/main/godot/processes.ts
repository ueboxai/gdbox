/**
 * 这台机器上正在跑的 Godot 编辑器。
 *
 * 只用在两处「连接之外」的判断：托盘点开工程前防止起第二个编辑器、
 * 启动后看进程还在不在。没装 GDBox Link 的编辑器盒子连不上，只能看进程。
 *
 * 编辑器的命令行里带着 `--path <工程目录>`（从项目管理器打开的也是），
 * 按它认是哪个工程。枚举进程不便宜（Windows 上要一两秒），只在点下去时查。
 */
import { execFile } from 'child_process'

import { normalizeProjectPath } from '../utils/projectPath'

function listCommandLines(): Promise<string[]> {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      execFile(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          'Get-CimInstance Win32_Process -Filter "Name LIKE \'godot%\'" | ForEach-Object { $_.CommandLine }'
        ],
        { timeout: 15_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
        (error, stdout) => resolve(error ? [] : stdout.split(/\r?\n/).filter(Boolean))
      )
    } else {
      execFile('ps', ['-eo', 'args'], { timeout: 10_000 }, (error, stdout) =>
        resolve(error ? [] : stdout.split('\n').filter((line) => /godot/i.test(line)))
      )
    }
  })
}

/** `--path` 后面那个参数（可能带引号）。命令行里没写就是 undefined */
export function pathArgument(commandLine: string): string | undefined {
  const match = /--path\s+(?:"([^"]+)"|(\S+))/.exec(commandLine)
  return match ? (match[1] ?? match[2]) : undefined
}

/** 这个工程有没有编辑器开着 */
export async function isGodotProjectRunning(projectDir: string): Promise<boolean> {
  const wanted = normalizeProjectPath(projectDir)
  for (const line of await listCommandLines()) {
    const path = pathArgument(line)
    if (path && normalizeProjectPath(path) === wanted) return true
  }
  return false
}
