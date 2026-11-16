/**
 * 评审 → 作者返工 → 复验，在盒子里直接转，不经过制作人；返工轮数封顶。
 *
 * ## 为什么
 *
 * 2026-10-20《缝天旅人》：200 件活里一半是「只读验证 / 独立复评」，每次评审交回都先进
 * 制作人的上下文（每步十几万 token），制作人读完再给作者重写一份派活，作者改完又回到
 * 制作人、再派评审……一个首房的美术样板被这样来回磨了 R1–R8 八轮。转述本身不产生信息，
 * 只付钱和等待。
 *
 * ## 规则
 *
 * - `team_send` 带 `review_of: <作者>` 时，这件活按评审跑：要求评审最后一行给 VERDICT。
 * - FAIL：原意见转给作者返工，作者交回后同一位评审复验，循环直到 PASS。
 * - 同一项（任务 id，没给就是作者名）累计被打回超过 `MAX_REVIEW_FIX_ROUNDS` 次，
 *   盒子不再自动转，交回制作人：记为已知缺口或者问用户。PASS 清零。
 * - BLOCKED、没给 VERDICT、返工中途停下：都交回制作人，附上已经发生的几轮。
 */

import { parseVerdict } from '../goalLoop'

export const MAX_REVIEW_FIX_ROUNDS = 2

/** 每一棒的结论：`raw` 是队员原话（判 VERDICT、转给下一棒用），`text` 是带台账的完整回话 */
export interface ReviewRun {
  raw: string
  text: string
}

export interface ReviewLoopDeps {
  run: (name: string, message: string) => Promise<ReviewRun>
  bumpFails: (key: string) => Promise<number>
  clearFails: (key: string) => Promise<void>
}

export interface ReviewLoopInput {
  reviewer: string
  author: string
  brief: string
  task?: string
}

const clip = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max)}…（后略 ${text.length - max} 字）` : text

export function reviewContract(author: string): string {
  return [
    '---',
    `[GDBox] 这是对 ${author} 产出的独立评审。回话最后一行写且只写一行：`,
    'VERDICT: PASS — <依据>',
    `VERDICT: FAIL — <${author} 要修的具体问题>`,
    'VERDICT: BLOCKED — <为什么没法评>',
    `FAIL 会由盒子直接转给 ${author} 返工，返工完再回到你这里复验，不经过制作人。`
  ].join('\n')
}

export async function runReviewLoop(input: ReviewLoopInput, deps: ReviewLoopDeps): Promise<string> {
  const { reviewer, author, brief, task } = input
  const key = task?.trim() || author
  const contract = reviewContract(author)
  const log: string[] = []
  const finish = (...lines: string[]): string => [...log, ...lines].filter(Boolean).join('\n\n')

  let message = `${brief}\n\n${contract}`
  for (let round = 0; ; round++) {
    let review: ReviewRun
    try {
      review = await deps.run(reviewer, message)
    } catch (error) {
      // 头一次评审就停下：和普通派活一样按「停下了」抛给制作人；复验时停下，前面几轮得带回去
      if (round === 0) throw error
      return finish(
        `【复验没干完】${reviewer} 停下了：${error instanceof Error ? error.message : String(error)}`
      )
    }
    const verdict = parseVerdict(review.raw)
    if (!verdict) {
      return finish(
        review.text,
        `【没有自动转】${reviewer} 没给 VERDICT 行，盒子没把这次评审转给 ${author}。`
      )
    }
    if (verdict.kind === 'pass') {
      await deps.clearFails(key)
      return finish(review.text, round > 0 ? `【评审通过】经 ${round} 轮自动返工后通过。` : '')
    }
    if (verdict.kind === 'blocked') {
      return finish(review.text, `【评审卡住】${reviewer} 说没法评，需要你处理。`)
    }

    const fails = await deps.bumpFails(key)
    if (fails > MAX_REVIEW_FIX_ROUNDS) {
      return finish(
        review.text,
        `【返工到顶】「${key}」已被评审打回 ${fails} 次（自动返工上限 ${MAX_REVIEW_FIX_ROUNDS} 轮），` +
          `盒子不再自动转给 ${author}。不要原样重派：把剩下的问题记为已知缺口继续往下走，` +
          '或者问用户要不要接着磨。'
      )
    }

    log.push(`${reviewer} 第 ${round + 1} 次评审：FAIL — ${verdict.reason}`)
    let fix: ReviewRun
    try {
      fix = await deps.run(
        author,
        [
          `[GDBox] 独立评审没通过，盒子把意见直接转给你（第 ${fails}/${MAX_REVIEW_FIX_ROUNDS} 轮自动返工` +
            (task ? `，任务 ${task}` : '') +
            '）。',
          `${reviewer} 要你修的：${verdict.reason}`,
          '',
          '评审全文：',
          clip(review.raw, 6000),
          '',
          '只修评审指出的问题，不要借机扩大改动。修完自己跑一遍相关检查，交回改了什么、怎么验的。' +
            '交回后同一位评审会复验。'
        ].join('\n')
      )
    } catch (error) {
      return finish(
        review.text,
        `【返工没干完】${author} 停下了：${error instanceof Error ? error.message : String(error)}`
      )
    }
    log.push(`${author} 第 ${fails} 轮返工交回：\n${clip(fix.raw, 1500)}`)

    message = [
      `[GDBox] 复验（第 ${fails} 轮返工之后）。${author} 按你上次的意见返工，交回如下：`,
      clip(fix.raw, 6000),
      '',
      '查你上次指出的问题是否真的解决、有没有带出新问题。标准和上次一样，不放宽也不加码。原评审要求：',
      brief,
      '',
      contract
    ].join('\n')
  }
}
