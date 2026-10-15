import type { AgentReviewTarget } from '@core/shared/agentReview'

import { isResPath, type ChangeGroup } from './changeSummary'

/**
 * 「本轮改动」清单 → 可以送去审查的目标。
 *
 * ## 为什么要过滤
 *
 * 清单里混着几种东西：工程内的资源（`res://…`）、硬盘上的文件
 * （`D:/proj/说明.html`）、素材库资产、以及取不到目标的调用（编辑器操作、美术风格）。
 * 审查按 `res://` 路径去工程目录里查「这个资源现在什么状态」，其余几种它答不上来 ——
 * 送过去只会换回一句「资源不存在」，然后在界面上冒出一条假的错误。
 *
 * 失败的那些步骤也不在这里剔除：一次生成可能「报了错但文件已经写出来了」，
 * 该不该报警由工程的实际状态说了算，不由工具回了什么说了算。
 */
export function reviewTargetsFrom(groups: ChangeGroup[]): AgentReviewTarget[] {
  const targets: AgentReviewTarget[] = []

  for (const group of groups) {
    if (group.local) continue
    if (!isResPath(group.target)) continue

    targets.push({
      path: group.target,
      action: group.action,
      ...(group.kind ? { kind: group.kind } : {})
    })
  }

  return targets
}

/**
 * 自动体检的资产上限。
 *
 * 体检要在编辑器里把每个资产 load 一遍，跑在游戏线程上 —— 用户这时多半正
 * 盯着编辑器看 AI 做了什么，卡一下就很显眼。超过这个数就不自动跑，留给
 * 用户自己点。
 */
export const AUTO_REVIEW_MAX_TARGETS = 20

/** 这一轮结束时要不要自动跑一次引擎体检。只看改了几个资产 */
export function shouldAutoReview(targets: AgentReviewTarget[]): boolean {
  return targets.length > 0 && targets.length <= AUTO_REVIEW_MAX_TARGETS
}
