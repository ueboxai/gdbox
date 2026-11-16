/**
 * 回放回归的工具和宿主实现：`regression_add`（存一条用例）、`regression_run`（跑回归），
 * 以及交付机器门要用的「起 Godot 跑回放」「跑 godot_check」。
 *
 * 判定、缓存、晋升规则都在 `core/regression/`，这里只做起 Godot 的那一半。
 * 用例库在 `<userData>/regression/`，模型的文件工具写不进去（`pathBoundary.ts`）。
 */

import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { readFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { app } from 'electron'
import { z } from 'zod'

import { defineTool, type UnrealAgentTool } from '../defineTool'
import { digestGodotLog, runGodot } from '../../../godot/run'
import { ensureImported } from '../../../godot/importState'
import { godotResourcesDir } from '../../../godot/editorLinkAddon'
import { requireGodot, resolveProjectDir } from './project'
import { collectProjectScripts, createGodotCheckTool, prepareProjectRunner } from './runtime'
import { runInputSchema } from '../../core/regression/inputSchema'
import { describeAssert, missingWatches } from '../../core/regression/assert'
import {
  admitCase,
  formatReport,
  runRegression,
  type ReplayExecutor
} from '../../core/regression/runner'
import {
  createRegressionStore,
  regressionDirFor,
  type RegressionStore
} from '../../core/regression/store'
import type { GateDeps } from '../../core/regression/gate'
import { snapshotStoreFor } from '../../core/team/snapshots'

export function regressionRoot(): string {
  return join(app.getPath('userData'), 'regression')
}

const stores = new Map<string, RegressionStore>()
export function regressionStoreFor(projectDir: string): RegressionStore {
  const dir = regressionDirFor(regressionRoot(), projectDir)
  let store = stores.get(dir)
  if (!store) {
    store = createRegressionStore(dir, projectDir)
    stores.set(dir, store)
  }
  return store
}

/** 起一个无头 Godot 跑一遍回放。和 `godot_run` 同一个运行器，只是逐帧采样、不截图 */
export function godotReplayExecutor(projectDir: string): ReplayExecutor {
  return async (config, signal) => {
    const godot = (await requireGodot()).path
    // 每遍一个全新的 user://：游戏写的存档、设置不许留到下一遍或下一条用例
    const userDataRoot = mkdtempSync(join(tmpdir(), 'gdbox-replay-'))
    const runner = prepareProjectRunner(
      projectDir,
      'replay',
      join(godotResourcesDir(), 'gdbox_run.gd')
    )
    try {
      const configPath = join(runner.tmp, 'config.json')
      writeFileSync(configPath, JSON.stringify(config))
      await ensureImported(godot, projectDir, signal)
      const ran = await runGodot(
        godot,
        [
          '--headless',
          '--path',
          projectDir,
          '--fixed-fps',
          '60',
          '-s',
          runner.script,
          '--',
          `--gdbox-config=${configPath}`
        ],
        { timeoutMs: Math.max(30_000, (config.seconds + 20) * 1000), signal, userDataRoot }
      )
      return {
        lines: ran.output.split(/\r?\n/),
        timedOut: ran.timedOut,
        errors: digestGodotLog(ran.output).errors
      }
    } finally {
      runner.cleanup()
      rmSync(userDataRoot, { recursive: true, force: true })
    }
  }
}

/** 交付机器门的宿主依赖：真 Godot、真快照仓库、真用例库 */
export function gateDepsFor(projectDir: string): GateDeps {
  const snapshots = snapshotStoreFor(projectDir)
  const checkTool = createGodotCheckTool()
  return {
    store: regressionStoreFor(projectDir),
    snapshots,
    exec: godotReplayExecutor(projectDir),
    check: async (signal) => {
      const result = await checkTool.execute('machine-gate', { project_path: projectDir }, signal)
      return ((result.details as { errors?: string[] } | undefined)?.errors ?? []).slice()
    }
  }
}

const projectPathInput = z
  .string()
  .optional()
  .describe('Godot 工程目录。不给就用这条对话绑定的工程')

const assertSchema = z.object({
  expr: z
    .string()
    .min(1)
    .describe(
      '要判的值，写法同 godot_run 的 watch，如 "Player:global_position:x"、"max(@balls:global_position:y)"、"changed(@units:position)"'
    ),
  op: z.enum(['==', '!=', '<', '<=', '>', '>=']),
  value: z.union([z.string(), z.number(), z.boolean()]),
  when: z
    .union([z.enum(['final', 'ever', 'always']), z.object({ at: z.number().min(0) })])
    .describe('final = 结束时；ever = 某一刻满足过；always = 每一帧都满足；{at: 秒} = 那一刻'),
  tol: z.number().min(0).optional().describe('数值比较的容差')
})

/** 工程脚本里调 `randomize()` 的地方（res://路径:行），最多 5 处。给不稳定用例指路 */
async function randomizeSites(projectDir: string): Promise<string[]> {
  const sites: string[] = []
  for (const script of await collectProjectScripts(projectDir)) {
    const file = join(projectDir, script.path.slice('res://'.length))
    const lines = (await readFile(file, 'utf8').catch(() => '')).split(/\r?\n/)
    lines.forEach((line, i) => {
      if (/\brandomize\s*\(\s*\)/.test(line) && !line.trimStart().startsWith('#')) {
        sites.push(`${script.path}:${i + 1}`)
      }
    })
    if (sites.length >= 5) break
  }
  return sites.slice(0, 5)
}

export function createRegressionAddTool(): UnrealAgentTool<unknown> {
  return defineTool({
    name: 'regression_add',
    namespace: 'godot',
    risk: 'safe',
    concurrency: 'sequential',
    description:
      '把一段已经验证过的行为存成回放用例：这串输入打下去，游戏应该变成这样。' +
      '盒子当场在当前工程上连跑两遍，两遍都过、而且结果一致才收（不一致的标为不稳定，不进门禁）。' +
      '收进来的是候选用例；下一次冠军晋升时它会被锁定，之后每次交付都必须过，谁都删不掉。' +
      '参数和 godot_run 一样，再加 asserts。游戏里用了随机数的，回放时种子在 Engine 元数据 "gdbox_seed" 上。',
    input: z.object({
      project_path: projectPathInput,
      title: z.string().min(1).describe('一句话说这条用例证明什么，如「首房起跳冲刺能到出口」'),
      scene: z.string().optional().describe('res:// 场景；不给就是主场景'),
      seconds: z.number().min(0.1).max(120),
      seed: z.number().int().optional().describe('随机种子，默认 1'),
      inputs: z.array(runInputSchema).default([]),
      watch: z.array(z.string()).max(16).default([]),
      asserts: z.array(assertSchema).min(1)
    }),
    async execute(args, { signal, report }) {
      const dir = resolveProjectDir(args.project_path)
      const draft = {
        id: 'draft',
        title: args.title,
        scene: args.scene ?? '',
        seconds: args.seconds,
        seed: args.seed ?? 1,
        inputs: args.inputs,
        viewport: 'project' as const,
        watch: [...args.watch, ...missingWatches(args.asserts, args.watch)],
        asserts: args.asserts
      }
      report({ text: '在当前工程上连跑两遍…' })
      const admission = await admitCase(godotReplayExecutor(dir), draft, signal)
      const store = regressionStoreFor(dir)
      const origin = { by: 'agent', at: Date.now() }
      if (!admission.ok && !admission.flaky) {
        throw new Error(
          `没收：这条用例在当前工程上就不过。用例必须在提交时就是对的。\n${admission.failures.join('\n')}`
        )
      }
      if (!admission.ok) {
        const saved = await store.add({
          ...draft,
          status: 'flaky',
          flakyReason: admission.reason,
          origin
        })
        const hints = await randomizeSites(dir)
        return {
          text: [
            `存为不稳定用例 ${saved.id}，不进门禁：${admission.reason}`,
            hints.length
              ? `工程里这些地方按随机种子取值：${hints.join('、')}。回放时盒子把种子放在 Engine 元数据上，` +
                '改成 `if Engine.has_meta("gdbox_seed"): rng.seed = Engine.get_meta("gdbox_seed") else: rng.randomize()`' +
                '（全局随机数用 `seed(...)`），正常游玩不受影响，再存这条用例就能过。'
              : '',
            '不确定的根源在游戏，不在用例：换个写法重存同一条还会不稳定。'
          ]
            .filter(Boolean)
            .join('\n'),
          details: { id: saved.id, status: 'flaky' }
        }
      }
      const saved = await store.add({ ...draft, origin })
      return {
        text:
          `已收为候选用例 ${saved.id}「${saved.title}」（两遍都过，结果一致，用时 ${Math.round(admission.result.ms / 1000)} 秒/遍）。` +
          `判的是：${saved.asserts.map(describeAssert).join('；')}。下次冠军晋升时锁定。`,
        details: { id: saved.id, status: 'candidate' }
      }
    }
  })
}

export function createRegressionRunTool(): UnrealAgentTool<unknown> {
  return defineTool({
    name: 'regression_run',
    namespace: 'godot',
    risk: 'safe',
    concurrency: 'sequential',
    description:
      '跑回放回归：把锁定和候选用例在当前工程上跑一遍，回过与不过（不过的附实际值）。不花模型 token；' +
      '工程没变的用例直接用上次结果。改完东西交回之前跑一遍，别把验收过的东西改坏。',
    input: z.object({
      project_path: projectPathInput,
      ids: z.array(z.string()).optional().describe('只跑这几条；不给就跑全部锁定和候选用例')
    }),
    async execute(args, { signal, report }) {
      const dir = resolveProjectDir(args.project_path)
      const store = regressionStoreFor(dir)
      const { cases, tampered } = await store.list()
      const picked = cases.filter((c) =>
        args.ids?.length
          ? args.ids.includes(c.id)
          : c.status === 'locked' || c.status === 'candidate'
      )
      const tree = await snapshotStoreFor(dir).workTree()
      const result = await runRegression(godotReplayExecutor(dir), store, picked, tree, {
        ...(signal ? { signal } : {}),
        onProgress: (text) => report({ text })
      })
      const titles = new Map(picked.map((c) => [c.id, c.title]))
      const locked = new Set(picked.filter((c) => c.status === 'locked').map((c) => c.id))
      const brokenLocked = result.results
        .filter((r) => !r.pass && locked.has(r.id))
        .map((r) => r.id)
      return {
        text: [
          formatReport(result, titles),
          brokenLocked.length
            ? `其中锁定用例 ${brokenLocked.join('、')} 没过：交付会被机器门拦下。`
            : '',
          tampered.length ? `用例 ${tampered.join('、')} 的文件被改过或被删了。` : ''
        ]
          .filter(Boolean)
          .join('\n\n'),
        details: { passed: result.passed, failed: result.failed }
      }
    }
  })
}

export function regressionTools(): UnrealAgentTool<never>[] {
  return [
    createRegressionAddTool(),
    createRegressionRunTool()
  ] as unknown as UnrealAgentTool<never>[]
}
