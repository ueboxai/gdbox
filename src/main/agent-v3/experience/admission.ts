/**
 * 一条新经验能不能进门、进门时挤掉谁。整理员写新经验、以及工程经验升为通用时共用。
 *
 * ## 为什么不按工具限条数
 *
 * 早先每个工具最多 5 条，理由是防稀释：召回时几条互相挤占。可稀释是召回那一侧的事，
 * 召回早已按工具名、报错片段、API 钥匙精确对上（`recall.ts`）—— 存得多不会让一次报错
 * 带上不相干的。按工具限条数防不了稀释，只会把不相干的知识挤在同一排座位上：
 * 同一个工具下所有 API 的坑抢 5 个位置，再加上没出过场的 0 分排最前，
 * 实际效果是「只留最近 5 条」（虚幻盒子 2026-10-15 发现，上游 23f1c9ea）。
 *
 * 现在只按层限总量，防的是文件无限长。
 */

import type { ExperienceEntry, RetireReason } from './experienceFile'
import { emptyStats, evictionScore, type EntryStats } from './lifecycle'
import { patternProblem } from './specificity'

/** 每一层（一个工程、或通用层）最多几条在用的 */
export const MAX_ACTIVE_PER_LAYER: Record<'project' | 'global', number> = {
  project: 60,
  global: 150
}
/** 每个文件留几条已退休的，给用户看「它曾经这么以为过」 */
export const MAX_RETIRED_PER_TOOL = 10

export function retireAs(entry: ExperienceEntry, reason: RetireReason): ExperienceEntry {
  return { ...entry, status: 'retired', retiredBecause: reason }
}

/**
 * 这个报错是不是已经有在用的经验对得上。
 *
 * 和召回用同一套判据（`patternProblem`）：一条太宽、召回时会被跳过的旧经验，
 * 不能在这里挡住新经验 —— 否则那个报错永远学不到一条像样的。
 */
export function covered(entries: ExperienceEntry[], tool: string, error: string): boolean {
  return entries.some(
    (entry) =>
      entry.status !== 'retired' &&
      entry.tool === tool &&
      patternProblem(tool, entry.errorPattern, error) === undefined
  )
}

/**
 * 写入时的查重：拿**片段**和已有片段比，不是拿报错原文。
 *
 * 不能复用 `covered`：它要的是完整报错，验证工具的片段不是一整行报错，
 * `patternProblem` 会判成「不是异常」，于是永远查不出重复。
 * 一个片段包含另一个就算同一件事。
 */
export function patternCovered(entries: ExperienceEntry[], tool: string, pattern: string): boolean {
  const p = pattern.trim().toLowerCase()
  return entries.some((entry) => {
    if (entry.status === 'retired' || entry.tool !== tool) return false
    const q = entry.errorPattern.trim().toLowerCase()
    return q !== '' && (p.includes(q) || q.includes(p))
  })
}

/** 最该走的那条：钉住的不走，试用先于转正，同档里提升低的先走 */
export function weakest(
  entries: ExperienceEntry[],
  ledger: Record<string, EntryStats>
): ExperienceEntry | undefined {
  const score = (entry: ExperienceEntry): number =>
    evictionScore(entry, ledger[entry.id] ?? emptyStats())
  return entries.filter((e) => e.status !== 'retired').sort((a, b) => score(a) - score(b))[0]
}

/**
 * 把新经验放进一个工具的条目里，顺带只留最近几条已退休的。
 * 不在这里限条数（见文件头），总量由整理员按层管（`curator.ts`）。
 */
export function admit(
  entries: ExperienceEntry[],
  incoming: ExperienceEntry
): ExperienceEntry[] | undefined {
  const next = [...entries, incoming]
  const retired = next.filter((e) => e.status === 'retired')
  const drop = new Set(
    retired.slice(0, Math.max(0, retired.length - MAX_RETIRED_PER_TOOL)).map((e) => e.id)
  )
  return next.filter((e) => !drop.has(e.id))
}
