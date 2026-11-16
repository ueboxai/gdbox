/**
 * 单个工具调用的参数流到多长就掐掉这次回复。
 *
 * ## 为什么
 *
 * 2026-10-21 端到端测试：一个队员的一次回复在 765 秒里流回 10.7 万个片段 —— 模型在往一个
 * 工具调用里塞没完没了的参数。pi-ai 每收到一个片段都要把累积的整段参数解析一遍（平方复杂度，
 * 补丁 `patches/@earendil-works__pi-ai@1.2.0.patch` 已把它降成线性），主进程被占住 13 分钟，
 * 所有会话一起停摆。补丁解决了「慢」，这里解决「没完没了」：正常的写文件、改场景参数都在
 * 几十 KB 以内，几百 KB 的单次参数几乎一定是模型跑飞了，早掐早好。
 *
 * 掐掉后回一条失败回话，说清楚为什么、下次怎么做；不重发（同一个请求重发多半还是跑飞）。
 */

import { createAssistantMessageEventStream, type Api, type Model } from '@earendil-works/pi-ai'
import type { StreamFn } from '@earendil-works/pi-agent-core'

import { failedAssistantMessage } from './team/requestGate'

/** 单个工具调用的参数上限（字符）。远高于正常写一个脚本文件的量 */
export const MAX_TOOL_ARGS_CHARS = 512 * 1024

export function toolArgsTooLargeMessage(maxChars: number): string {
  return (
    `一个工具调用的参数超过了 ${Math.round(maxChars / 1024)}KB，这次回复已被中止。` +
    '大段内容请分几次写（先写骨架，再逐段编辑或追加），不要一次塞进一个工具调用。'
  )
}

export function toolArgsLimitStreamFn(
  inner: StreamFn,
  maxChars: number = MAX_TOOL_ARGS_CHARS
): StreamFn {
  return async (model: Model<Api>, context, options) => {
    // 自己的中止器接在外面那个后面：超限时只掐这一次请求
    const controller = new AbortController()
    const outer = options?.signal
    const forwardAbort = (): void => controller.abort(outer?.reason)
    if (outer?.aborted) controller.abort(outer.reason)
    else outer?.addEventListener('abort', forwardAbort, { once: true })

    const stream = await inner(model, context, { ...options, signal: controller.signal })
    const out = createAssistantMessageEventStream()
    void (async () => {
      const sizes = new Map<number, number>()
      try {
        for await (const event of stream) {
          if (event.type === 'toolcall_delta') {
            const size = (sizes.get(event.contentIndex) ?? 0) + event.delta.length
            sizes.set(event.contentIndex, size)
            if (size > maxChars) {
              controller.abort(new Error('tool arguments too large'))
              out.push({
                type: 'error',
                reason: 'error',
                error: failedAssistantMessage(model, toolArgsTooLargeMessage(maxChars))
              })
              return
            }
          }
          out.push(event)
          if (event.type === 'done' || event.type === 'error') return
        }
      } catch (error) {
        out.push({
          type: 'error',
          reason: outer?.aborted ? 'aborted' : 'error',
          error: failedAssistantMessage(
            model,
            error instanceof Error ? error.message : String(error)
          )
        })
      } finally {
        outer?.removeEventListener('abort', forwardAbort)
        out.end()
      }
    })()
    return out
  }
}
