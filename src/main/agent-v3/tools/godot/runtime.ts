/**
 * 不依赖编辑器的三件事：检查、试玩、截图。都是起一个无头（或屏幕外）的 Godot 跑完就退。
 *
 * 为什么不交给编辑器做：编辑器不一定开着，开着也是用户正在用的那一个 ——
 * 在里面跑游戏会抢走他的画面。无头跑一遍几秒钟，结果只给模型看。
 *
 * 三个都串行：同时起两个 Godot 导入同一个工程会互相踩 `.godot/` 缓存。
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { app } from 'electron'
import { z } from 'zod'

import { defineTool, type UnrealAgentTool } from '../defineTool'
import { digestGodotLog, runGodot } from '../../../godot/run'
import { ensureImported, markImported } from '../../../godot/importState'
import { godotResourcesDir } from '../../../godot/editorLinkAddon'
import { requireGodot, resolveProjectDir } from './project'
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
  const keys = Object.keys(samples[0].v)
  const rows: string[] = []
  let last = ''
  for (const s of samples) {
    const row = keys.map((k) => s.v[k]).join(' | ')
    if (row === last) continue
    last = row
    rows.push(`${s.t.toFixed(2)}s | ${row}`)
  }
  const shown =
    rows.length > maxRows
      ? [...rows.slice(0, maxRows - 5), `… ${rows.length - maxRows + 1} more rows …`, ...rows.slice(-4)]
      : rows
  return `time | ${keys.join(' | ')}\n${shown.join('\n')}`
}

export function createGodotCheckTool(): UnrealAgentTool<unknown> {
  return defineTool({
    name: 'godot_check',
    namespace: 'godot',
    risk: 'safe',
    concurrency: 'sequential',
    description:
      'Import the Godot project and run it headless for some frames, then report script and engine errors. ' +
      'Run it after every script or scene change and fix every error before saying you are done.',
    input: z.object({
      project_path: projectPathInput,
      scene: z.string().optional().describe('res:// scene to run instead of the main scene'),
      frames: z.number().int().min(1).max(3600).optional().describe('Frames to run at 60 fps. Default 120')
    }),
    async execute(args, { signal }) {
      const godot = (await requireGodot()).path
      const dir = resolveProjectDir(args.project_path)
      const frames = args.frames ?? 120
      const imported = await runGodot(godot, ['--headless', '--path', dir, '--import'], {
        timeoutMs: 180_000,
        signal
      })
      if (!imported.timedOut && imported.code === 0) markImported(dir)
      const runArgs = ['--headless', '--path', dir, '--fixed-fps', '60', '--quit-after', String(frames)]
      if (args.scene) runArgs.push(args.scene)
      const ran = await runGodot(godot, runArgs, { timeoutMs: 120_000, signal })

      const digest = digestGodotLog(`${imported.output}\n${ran.output}`)
      const lines: string[] = []
      if (ran.timedOut) {
        lines.push('The run did not exit in time and was stopped (possible infinite loop or blocking dialog).')
      }
      // Godot 崩溃时可能一个字都不打；只看日志会误报「没有错误」，所以退出码也要看
      let abnormal = false
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
        digest.errors.length === 0
          ? abnormal
            ? 'No error messages were printed.'
            : `No errors. Ran ${frames} frames${args.scene ? ` of ${args.scene}` : ''}.`
          : `${digest.errors.length} error(s):\n\n${digest.errors.slice(0, 30).join('\n\n')}`
      )
      if (digest.warnings.length) {
        lines.push(`${digest.warnings.length} warning(s):\n\n${digest.warnings.slice(0, 15).join('\n\n')}`)
      }
      if (digest.exitLeakNotices) {
        lines.push(
          `(${digest.exitLeakNotices} exit-time leak notice(s) from the engine were omitted; they are not caused by the project.)`
        )
      }
      return {
        text: lines.join('\n\n'),
        details: { errors: digest.errors, warnings: digest.warnings, timedOut: ran.timedOut }
      }
    }
  })
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
      'inputs press InputMap actions at given times; watch takes "NodePath:property[:sub]" relative to the scene root, ' +
      'e.g. "Player:position:y", ".:player:velocity" (a script variable holding a node), "%CharacterBody2D:velocity" (first node of that class). ' +
      'Optional screenshots at given times. Errors during the run are reported too.',
    input: z.object({
      project_path: projectPathInput,
      scene: z.string().optional().describe('res:// scene; default the main scene'),
      seconds: z.number().min(0.1).max(60).optional().describe('How long to run. Default 3'),
      inputs: z
        .array(
          z.object({
            action: z.string(),
            at: z.number().min(0).describe('Seconds from start'),
            hold: z.number().min(0.016).optional().describe('Seconds to hold. Default 0.1')
          })
        )
        .optional(),
      watch: z.array(z.string()).max(8).optional(),
      sample_interval: z.number().min(0.016).max(5).optional().describe('Seconds between samples. Default 0.1'),
      screenshots: z.array(z.number().min(0)).max(3).optional().describe('Times (seconds) to capture frames')
    }),
    async execute(args, { signal }) {
      const godot = (await requireGodot()).path
      const dir = resolveProjectDir(args.project_path)
      // 运行器和配置放在 .gdbox/tmp（带 .gdignore，Godot 不会把它当工程资源导入），跑完删掉
      const meta = join(dir, '.gdbox')
      const runId = `run-${Date.now()}`
      const tmp = join(meta, 'tmp', runId)
      mkdirSync(tmp, { recursive: true })
      if (!existsSync(join(meta, '.gdignore'))) writeFileSync(join(meta, '.gdignore'), '')
      const shotsDir = mkdtempSync(join(tmpdir(), 'gdbox-run-'))
      try {
        writeFileSync(join(tmp, 'gdbox_run.gd'), readFileSync(runnerPath()))
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
          screenshots: shots
        }
        const configPath = join(tmp, 'config.json')
        writeFileSync(configPath, JSON.stringify(config))
        // 只有要截图才开窗口（放到屏幕外），否则 headless
        const runArgs = [
          ...(shots.length ? ['--position', '10000,10000'] : ['--headless']),
          '--path',
          dir,
          '--fixed-fps',
          '60',
          '-s',
          `res://.gdbox/tmp/${runId}/gdbox_run.gd`,
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
        const table = summarizeWatch(lines)
        if (table) parts.push(table)
        if (warnings.length) parts.push(warnings.join('\n'))
        if (!shotsAllowed && args.screenshots?.length) parts.push(EDITOR_SCREENSHOT_SKIPPED_NOTE)
        parts.push(
          digest.errors.length
            ? `${digest.errors.length} error(s):\n\n${digest.errors.slice(0, 20).join('\n\n')}`
            : 'No errors during the run.'
        )
        const images = shots
          .filter((s) => existsSync(s.path))
          .map((s) => ({ data: readFileSync(s.path), mimeType: 'image/png' }))
        return {
          text: parts.join('\n\n'),
          images,
          details: { errors: digest.errors, timedOut: ran.timedOut }
        }
      } finally {
        rmSync(tmp, { recursive: true, force: true })
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
      frames: z.number().int().min(1).max(600).optional().describe('Frame to capture at 60 fps. Default 30')
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

export function godotRuntimeTools(): UnrealAgentTool<never>[] {
  return [
    createGodotCheckTool(),
    createGodotRunTool(),
    createGodotScreenshotTool(),
    createImportToProjectTool()
  ] as unknown as UnrealAgentTool<never>[]
}
