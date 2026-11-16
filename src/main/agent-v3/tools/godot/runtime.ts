/**
 * 不依赖编辑器的三件事：检查、试玩、截图。都是起一个无头（或屏幕外）的 Godot 跑完就退。
 *
 * 为什么不交给编辑器做：编辑器不一定开着，开着也是用户正在用的那一个 ——
 * 在里面跑游戏会抢走他的画面。无头跑一遍几秒钟，结果只给模型看。
 *
 * 三个都串行：同时起两个 Godot 导入同一个工程会互相踩 `.godot/` 缓存。
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  copyFileSync,
  type Dirent
} from 'fs'
import { readdir, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, join } from 'path'
import { app } from 'electron'
import { z } from 'zod'

import { defineTool, type UnrealAgentTool } from '../defineTool'
import { digestGodotLog, runGodot, type LogDigest } from '../../../godot/run'
import { ensureImported, runImport } from '../../../godot/importState'
import { godotResourcesDir } from '../../../godot/editorLinkAddon'
import { requireGodot, resolveProjectDir } from './project'
import { versionHintsForErrors } from '../../../godot/versionNotes'
import { describeProbe, parseProbes } from '../../core/regression/assert'
import { runInputSchema } from '../../core/regression/inputSchema'
import { createImportToProjectTool } from './importAssets'
import {
  EDITOR_SCREENSHOT_SKIPPED_NOTE,
  editorScreenshotAllowed
} from '../../core/editorScreenshotScope'

const projectPathInput = z
  .string()
  .optional()
  .describe('Godot 工程目录（含 project.godot）。不给就用这条对话绑定的工程')

/** 运行器的输出：每隔一段时间的取值，只保留有变化的行，免得刷屏 */
export function summarizeWatch(lines: string[], maxRows = 60): string {
  const samples = lines
    .filter((l) => l.startsWith('GDBOX_WATCH '))
    .map(
      (l) => JSON.parse(l.slice('GDBOX_WATCH '.length)) as { t: number; v: Record<string, string> }
    )
  if (!samples.length) return ''
  // changed(...) 第一次采样不出值，列要从所有采样里收
  const keys = [...new Set(samples.flatMap((s) => Object.keys(s.v)))]
  const rows: string[] = []
  let last = ''
  for (const s of samples) {
    const row = keys.map((k) => s.v[k] ?? '-').join(' | ')
    if (row === last) continue
    last = row
    rows.push(`${s.t.toFixed(2)}s | ${row}`)
  }
  const shown =
    rows.length > maxRows
      ? [
          ...rows.slice(0, maxRows - 5),
          `… ${rows.length - maxRows + 1} more rows …`,
          ...rows.slice(-4)
        ]
      : rows
  return `time | ${keys.join(' | ')}\n${shown.join('\n')}`
}

/** 不进加载检查的目录：引擎缓存、GDBox 自己的东西、版本库 */
const SKIP_DIRS = new Set(['.godot', '.gdbox', '.git', 'node_modules'])

export interface ProjectScript {
  /** res:// 路径 */
  path: string
  /** 修改时间和大小，用来判断这批脚本自上次检查以来动没动过 */
  stamp: string
}

/**
 * 工程里所有要检查的 .gd。带 .gdignore 的目录引擎不认，跳过；
 * 顶层 addons/ 下带 plugin.cfg 的是装进来的编辑器插件，不是游戏代码，也跳过 ——
 * 自己写在 addons/ 下、没有 plugin.cfg 的代码照样检查。
 * 读不了的目录（被别的进程锁着、没权限）跳过，不让整个检查失败。
 */
export async function collectProjectScripts(dir: string, rel = ''): Promise<ProjectScript[]> {
  const here = join(dir, rel)
  if (rel && existsSync(join(here, '.gdignore'))) return []
  if (
    rel.startsWith('addons/') &&
    !rel.includes('/', 'addons/'.length) &&
    existsSync(join(here, 'plugin.cfg'))
  ) {
    return []
  }
  let entries: Dirent[]
  try {
    entries = await readdir(here, { withFileTypes: true })
  } catch {
    return []
  }
  const out: ProjectScript[] = []
  for (const e of entries) {
    const child = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) out.push(...(await collectProjectScripts(dir, child)))
    } else if (e.name.endsWith('.gd')) {
      const st = await stat(join(here, e.name)).catch(() => null)
      out.push({ path: `res://${child}`, stamp: st ? `${st.mtimeMs}:${st.size}` : '' })
    }
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

export interface LoadCheckResult {
  /** 检查器没跑完（没打出汇总行）时为 null */
  checked: number | null
  failed: string[]
  errors: string[]
}

/**
 * 解析 gdbox_load_check.gd 的输出。引擎给每条错误挂的回溯指向检查器自己，删掉；
 * 「Failed to load script "X" … Parse error」在 X 已经有一条 SCRIPT ERROR 时说的是同一件事，删掉；
 * 没有的话（缺依赖、extends 路径错）它就是唯一的原因，留着。
 */
export function summarizeLoadCheck(output: string): LoadCheckResult {
  const lines = output.split(/\r?\n/)
  const failed = lines
    .filter((l) => l.startsWith('GDBOX_LOADFAIL '))
    .map((l) => l.slice('GDBOX_LOADFAIL '.length).trim())
  const total = lines.find((l) => l.startsWith('GDBOX_LOADCHECK '))
  const all = digestGodotLog(output).errors.map((e) =>
    e
      .split('\n')
      .filter((l) => !l.includes('gdbox_load_check.gd') && !l.startsWith('GDScript backtrace'))
      .join('\n')
  )
  const errors = all.filter((e) => {
    const path = /^ERROR: Failed to load script "([^"]+)"/.exec(e)?.[1]
    return !path || !all.some((o) => o.startsWith('SCRIPT ERROR') && o.includes(`(${path}:`))
  })
  return { checked: total ? Number(total.split(' ')[1]) : null, failed, errors }
}

/** 错误的身份：消息加上 `at:` 那一行。消息本身不带文件路径，只看第一行会把别的脚本的同名错误当成重复 */
function errorKey(e: string): string {
  return e.split('\n').slice(0, 2).join('\n')
}

interface ExitInfo {
  code: number | null
  timedOut: boolean
}

/** godot_check 的汇报：把加载检查和场景试跑的结果合成一段，纯函数，方便单测 */
export function buildCheckReport(input: {
  loaded: LoadCheckResult
  imported: ExitInfo
  ran: ExitInfo
  digest: LogDigest
  frames: number
  scene?: string
}): { text: string; errors: string[] } {
  const { loaded, imported, ran, digest, frames, scene } = input
  // 场景用到的坏脚本两边都会报，去重，加载检查那条在前（它不带场景回溯，更干净）
  const seen = new Set(loaded.errors.map(errorKey))
  const errors = [...loaded.errors, ...digest.errors.filter((e) => !seen.has(errorKey(e)))]
  const lines: string[] = []
  // 检查没跑完和崩溃一样处理：最后一行不能说「No errors」
  let abnormal = false
  if (loaded.checked === null) {
    abnormal = true
    lines.push(
      'The script load check did not finish, so scripts the scene does not use were NOT checked.'
    )
  } else if (loaded.failed.length) {
    lines.push(
      `${loaded.failed.length} of ${loaded.checked} script(s) fail to load: ${loaded.failed.join(', ')}. ` +
        'They break as soon as anything uses them, even if the scene run below looks clean.'
    )
  }
  if (ran.timedOut) {
    lines.push(
      'The run did not exit in time and was stopped (possible infinite loop or blocking dialog).'
    )
  }
  // Godot 崩溃时可能一个字都不打；只看日志会误报「没有错误」，所以退出码也要看
  for (const [step, r] of [
    ['import', imported],
    ['run', ran]
  ] as const) {
    if (!r.timedOut && r.code !== 0 && r.code !== null) {
      abnormal = true
      lines.push(
        `Godot exited abnormally during ${step} (exit code ${r.code}). This can be a crash; run godot_check again to confirm before concluding.`
      )
    }
  }
  lines.push(
    errors.length === 0
      ? abnormal
        ? 'No error messages were printed.'
        : `No errors. Loaded ${loaded.checked} script(s), ran ${frames} frames${scene ? ` of ${scene}` : ''}.`
      : `${errors.length} error(s):\n\n${errors.slice(0, 30).join('\n\n')}`
  )
  if (digest.warnings.length) {
    lines.push(
      `${digest.warnings.length} warning(s):\n\n${digest.warnings.slice(0, 15).join('\n\n')}`
    )
  }
  if (digest.exitLeakNotices) {
    lines.push(
      `(${digest.exitLeakNotices} exit-time leak notice(s) from the engine were omitted; they are not caused by the project.)`
    )
  }
  return { text: lines.join('\n\n'), errors }
}

export function createGodotCheckTool(
  checkerPath = (): string => join(godotResourcesDir(), 'gdbox_load_check.gd')
): UnrealAgentTool<unknown> {
  return defineTool({
    name: 'godot_check',
    namespace: 'godot',
    risk: 'safe',
    concurrency: 'sequential',
    description:
      'Import the Godot project, load every script in it to catch errors in scripts the scene does not use yet, ' +
      'then run it headless for some frames and report script and engine errors. ' +
      'Run it after every script or scene change and fix every error before saying you are done.',
    input: z.object({
      project_path: projectPathInput,
      scene: z.string().optional().describe('res:// scene to run instead of the main scene'),
      frames: z
        .number()
        .int()
        .min(1)
        .max(3600)
        .optional()
        .describe('Frames to run at 60 fps. Default 120')
    }),
    async execute(args, { signal }) {
      const engine = await requireGodot()
      const godot = engine.path
      const dir = resolveProjectDir(args.project_path)
      const frames = args.frames ?? 120
      const imported = await runImport(godot, dir, signal)
      const loaded = await checkScriptsLoad(godot, dir, checkerPath(), signal)
      const runArgs = [
        '--headless',
        '--path',
        dir,
        '--fixed-fps',
        '60',
        '--quit-after',
        String(frames)
      ]
      if (args.scene) runArgs.push(args.scene)
      const ran = await runGodot(godot, runArgs, { timeoutMs: 120_000, signal })

      const digest = digestGodotLog(`${imported.output}\n${ran.output}`)
      const report = buildCheckReport({
        loaded,
        imported,
        ran,
        digest,
        frames,
        ...(args.scene ? { scene: args.scene } : {})
      })
      // 报错是这个引擎打的，所以按它的版本对，不按 project.godot 里声明的
      const hints = versionHintsForErrors(engine.version, [...report.errors, ...digest.warnings])
      return {
        text: hints
          ? `${report.text}

${hints}`
          : report.text,
        details: {
          errors: report.errors,
          warnings: digest.warnings,
          timedOut: ran.timedOut,
          scriptsChecked: loaded.checked,
          scriptsFailed: loaded.failed
        }
      }
    }
  })
}

/**
 * 往工程的 .gdbox/tmp 放一个运行器脚本（目录带 .gdignore，Godot 不会把它当工程资源导入）。
 * 返回它的 res:// 路径和这次的临时目录；用完调 cleanup。
 */
export function prepareProjectRunner(
  dir: string,
  prefix: string,
  runnerFile: string
): { tmp: string; script: string; cleanup: () => void } {
  const meta = join(dir, '.gdbox')
  const runId = `${prefix}-${Date.now()}`
  const tmp = join(meta, 'tmp', runId)
  mkdirSync(tmp, { recursive: true })
  const cleanup = (): void => rmSync(tmp, { recursive: true, force: true })
  try {
    if (!existsSync(join(meta, '.gdignore'))) writeFileSync(join(meta, '.gdignore'), '')
    const name = basename(runnerFile)
    writeFileSync(join(tmp, name), readFileSync(runnerFile))
    return { tmp, script: `res://.gdbox/tmp/${runId}/${name}`, cleanup }
  } catch (err) {
    cleanup()
    throw err
  }
}

/**
 * 上次干净跑完的加载检查，按工程记。脚本和 project.godot（autoload 在里面）都没动过就直接复用，
 * 只改了美术、音频时不用再起一个 Godot。
 */
const loadCheckCache = new Map<string, { signature: string; result: LoadCheckResult }>()

/** 起一个无头 Godot 把工程里每个脚本 load 一遍 */
async function checkScriptsLoad(
  godot: string,
  dir: string,
  checker: string,
  signal?: AbortSignal
): Promise<LoadCheckResult> {
  const scripts = await collectProjectScripts(dir)
  if (!scripts.length) return { checked: 0, failed: [], errors: [] }
  const projectStat = await stat(join(dir, 'project.godot')).catch(() => null)
  const signature = [
    `project.godot:${projectStat?.mtimeMs ?? ''}`,
    ...scripts.map((s) => `${s.path}:${s.stamp}`)
  ].join('\n')
  const cached = loadCheckCache.get(dir)
  if (cached?.signature === signature) return cached.result

  const runner = prepareProjectRunner(dir, 'check', checker)
  try {
    const listPath = join(runner.tmp, 'scripts.txt')
    writeFileSync(listPath, scripts.map((s) => s.path).join('\n'))
    const ran = await runGodot(
      godot,
      ['--headless', '--path', dir, '-s', runner.script, '--', `--gdbox-list=${listPath}`],
      { timeoutMs: 60_000, signal }
    )
    const result = summarizeLoadCheck(ran.output)
    if (result.checked !== null) loadCheckCache.set(dir, { signature, result })
    return result
  } finally {
    runner.cleanup()
  }
}

export function createGodotRunTool(
  runnerPath = (): string => join(godotResourcesDir(), 'gdbox_run.gd')
): UnrealAgentTool<unknown> {
  return defineTool({
    name: 'godot_run',
    namespace: 'godot',
    risk: 'safe',
    concurrency: 'sequential',
    description:
      'Play the game for a few seconds with scripted input and report how values change over time — verify behaviour without writing test scenes into the project. ' +
      'Each input is one of: an InputMap action, a key ("Space"), a mouse click on [x, y] or on a node path (e.g. "UI/StartButton"), or a drag between two of those. ' +
      'watch takes "NodePath:property[:sub]" relative to the scene root, ' +
      'e.g. "Player:position:y", ".:player:velocity" (a script variable holding a node), "%CharacterBody2D:velocity" (first node of that class), ' +
      '"Player:is_on_floor()" (a no-argument get_/is_/has_ method, e.g. child counts). ' +
      'For many nodes at once wrap it in count/min/max/mean/sum/changed over "@group", "%Class" (all of that class) or "Path/*" (children): ' +
      '"count(@enemies)", "max(@balls:global_position:y)", "mean(@units:velocity)" (vectors use their length), ' +
      '"changed(Terrain/*:position)" (fraction 0–1 of nodes whose value changed since the previous sample). ' +
      'Every run also reports positions or velocities that became NaN/inf and nodes that flew millions of pixels away. ' +
      'Optional screenshots at given times. Errors during the run are reported too.',
    input: z.object({
      project_path: projectPathInput,
      scene: z.string().optional().describe('res:// scene; default the main scene'),
      seconds: z.number().min(0.1).max(60).optional().describe('How long to run. Default 3'),
      inputs: z.array(runInputSchema).optional(),
      watch: z.array(z.string()).max(8).optional(),
      sample_interval: z
        .number()
        .min(0.016)
        .max(5)
        .optional()
        .describe('Seconds between samples. Default 0.1'),
      screenshots: z
        .array(z.number().min(0))
        .max(3)
        .optional()
        .describe('Times (seconds) to capture frames')
    }),
    async execute(args, { signal }) {
      const engine = await requireGodot()
      const godot = engine.path
      const dir = resolveProjectDir(args.project_path)
      // 运行器和配置放在 .gdbox/tmp，跑完删掉
      const runner = prepareProjectRunner(dir, 'run', runnerPath())
      const shotsDir = mkdtempSync(join(tmpdir(), 'gdbox-run-'))
      try {
        // 用户关掉了「允许编辑器截图」：照样试玩、照样回数值，只是不截图，并说一声
        const shotsAllowed = editorScreenshotAllowed()
        const shots = (shotsAllowed ? (args.screenshots ?? []) : []).map((at, i) => ({
          at,
          path: join(shotsDir, `shot_${i}.png`)
        }))
        const config = {
          scene: args.scene ?? '',
          seconds: args.seconds ?? 3,
          inputs: args.inputs ?? [],
          watch: args.watch ?? [],
          sample_interval: args.sample_interval ?? 0.1,
          screenshots: shots,
          full_viewport: true
        }
        const configPath = join(runner.tmp, 'config.json')
        writeFileSync(configPath, JSON.stringify(config))
        // 只有要截图才开窗口（放到屏幕外），否则 headless
        const runArgs = [
          ...(shots.length ? ['--position', '10000,10000'] : ['--headless']),
          '--path',
          dir,
          '--fixed-fps',
          '60',
          '-s',
          runner.script,
          '--',
          `--gdbox-config=${configPath}`
        ]
        // 新写进来的图和声音要先导入，否则运行时加载不出来
        await ensureImported(godot, dir, signal)
        const ran = await runGodot(godot, runArgs, {
          timeoutMs: Math.max(30_000, (config.seconds + 20) * 1000),
          signal
        })
        const lines = ran.output.split(/\r?\n/)
        const fatal = lines.find((l) => l.startsWith('GDBOX_FATAL'))
        const warnings = lines
          .filter((l) => l.startsWith('GDBOX_WARN'))
          .map((l) => l.slice('GDBOX_WARN '.length))
        const digest = digestGodotLog(ran.output)
        const parts: string[] = []
        if (fatal) parts.push(fatal.replace('GDBOX_FATAL ', 'Could not start: '))
        if (ran.timedOut) parts.push('The run did not finish in time and was stopped.')
        if (!fatal && !ran.timedOut && !lines.some((l) => l.startsWith('GDBOX_END'))) {
          parts.push('The run ended early (crash or quit).')
        }
        const probes = parseProbes(lines)
        if (probes.length) {
          parts.push(
            `${probes.length} broken value(s) found by the automatic checks:\n` +
              probes.map((p) => `- ${describeProbe(p)}`).join('\n')
          )
        }
        const table = summarizeWatch(lines)
        if (table) parts.push(table)
        if (warnings.length) parts.push(warnings.join('\n'))
        if (!shotsAllowed && args.screenshots?.length) parts.push(EDITOR_SCREENSHOT_SKIPPED_NOTE)
        parts.push(
          digest.errors.length
            ? `${digest.errors.length} error(s):\n\n${digest.errors.slice(0, 20).join('\n\n')}`
            : 'No errors during the run.'
        )
        const hints = versionHintsForErrors(engine.version, [
          ...(fatal ? [fatal] : []),
          ...digest.errors,
          ...warnings
        ])
        if (hints) parts.push(hints)
        const images = shots
          .filter((s) => existsSync(s.path))
          .map((s) => ({ data: readFileSync(s.path), mimeType: 'image/png' }))
        return {
          text: parts.join('\n\n'),
          images,
          details: { errors: digest.errors, timedOut: ran.timedOut }
        }
      } finally {
        runner.cleanup()
        rmSync(shotsDir, { recursive: true, force: true })
      }
    }
  })
}

export function createGodotScreenshotTool(
  screenshotsDir = (): string => join(app.getPath('userData'), 'godot-screenshots')
): UnrealAgentTool<unknown> {
  return defineTool({
    name: 'godot_screenshot',
    namespace: 'godot',
    risk: 'safe',
    concurrency: 'sequential',
    description:
      'Run the game off-screen for some frames and return the last rendered frame as an image you can see. ' +
      'Use it when a change is visible (layout, art, animation, UI) and look at it before reporting.',
    input: z.object({
      project_path: projectPathInput,
      scene: z.string().optional().describe('res:// scene to show instead of the main scene'),
      frames: z
        .number()
        .int()
        .min(1)
        .max(600)
        .optional()
        .describe('Frame to capture at 60 fps. Default 30')
    }),
    async execute(args, { signal }) {
      const godot = (await requireGodot()).path
      const dir = resolveProjectDir(args.project_path)
      const frames = args.frames ?? 30
      const work = mkdtempSync(join(tmpdir(), 'gdbox-shot-'))
      try {
        // Movie Maker 模式逐帧写 PNG，不需要往用户工程里加任何脚本；窗口放到屏幕外
        const runArgs = [
          '--path',
          dir,
          '--position',
          '10000,10000',
          '--write-movie',
          join(work, 'frame.png'),
          '--quit-after',
          String(frames)
        ]
        if (args.scene) runArgs.push(args.scene)
        // 没导入的贴图截出来是空的（只剩代码画的 HUD）——先确认导入过
        await ensureImported(godot, dir, signal)
        const ran = await runGodot(godot, runArgs, { timeoutMs: 90_000, signal })
        const pngs = readdirSync(work)
          .filter((f) => f.endsWith('.png'))
          .sort()
        const last = pngs.at(-1)
        if (!last) {
          const digest = digestGodotLog(ran.output)
          throw new Error(
            `No frame was rendered.${digest.errors.length ? `\n\n${digest.errors.slice(0, 10).join('\n\n')}` : ''}`
          )
        }
        const outDir = screenshotsDir()
        mkdirSync(outDir, { recursive: true })
        const saved = join(outDir, `${Date.now()}.png`)
        copyFileSync(join(work, last), saved)
        return {
          // 存盘路径写进文本：生图工具可以拿它当参考图，而模型只看得到文本
          text: `Frame ${pngs.length} of ${args.scene ?? 'the main scene'}. Saved to ${saved}`,
          images: [{ data: readFileSync(saved), mimeType: 'image/png' }],
          details: { path: saved }
        }
      } finally {
        rmSync(work, { recursive: true, force: true })
      }
    }
  })
}

/**
 * godot_play：把游戏开在真窗口里给用户玩（见 `godot/playGame.ts`）。
 * 用户说「打开我玩一下」「我试试」时用；自己验证行为用 godot_run。
 */
export function createGodotPlayTool(): UnrealAgentTool<unknown> {
  return defineTool({
    name: 'godot_play',
    namespace: 'godot',
    risk: 'safe',
    concurrency: 'sequential',
    description:
      'Open the game in a window for the user to play themselves (when they ask to try it). Relaunching replaces the running one. ' +
      'Reports errors from the first seconds; the full log keeps updating in .gdbox/tmp/play.log while they play. To verify behaviour yourself use godot_run.',
    input: z.object({
      project_path: projectPathInput,
      scene: z.string().optional().describe('res:// scene; default the main scene')
    }),
    async execute(args, { signal }) {
      const godot = (await requireGodot()).path
      const dir = resolveProjectDir(args.project_path)
      const { playGame, gameLog, isGameRunning, errorsInLog } = await import(
        '../../../godot/playGame'
      )
      await playGame(godot, dir, {
        ...(args.scene ? { scene: args.scene } : {}),
        ...(signal ? { signal } : {})
      })
      // 等几秒：脚本解析错、主场景缺失这类问题一启动就报，现在告诉用户比让他对着黑屏强
      await new Promise((resolve) => setTimeout(resolve, 4_000))
      const errors = errorsInLog(gameLog(dir))
      const running = isGameRunning(dir)
      const lines = [
        running
          ? "The game window is open on the user's screen."
          : 'The game exited within a few seconds of starting.',
        ...(errors.length
          ? ['Errors so far:', ...errors.map((e) => `- ${e}`)]
          : running
            ? ['No errors so far.']
            : [])
      ]
      return {
        text: lines.join('\n'),
        details: { running, errors },
        ...(running ? {} : { isError: true })
      }
    }
  })
}

export function godotRuntimeTools(): UnrealAgentTool<never>[] {
  return [
    createGodotCheckTool(),
    createGodotRunTool(),
    createGodotScreenshotTool(),
    createGodotPlayTool(),
    createImportToProjectTool()
  ] as unknown as UnrealAgentTool<never>[]
}
