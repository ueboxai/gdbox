import { h } from 'vue'
import AppButton from '@renderer/components/AppButton.vue'
import { confirmDialog, type DialogHandle } from '@renderer/utils/dialog'

/**
 * 重新生成、编辑用户消息之前的确认。
 *
 * 这两个动作都会把这一条之后的消息连同内核 transcript 一起截掉。最后一轮截掉的
 * 只是正要被替换的那条回答，不用问；不是最后一轮时，后面几轮问答会一起没掉，
 * 用户点的是「重来」，不知道它会顺手删历史，所以要先问。
 */

/** 第 `index` 条之后还有几轮（按用户消息数） */
export function countLaterTurns(messages: readonly { role: string }[], index: number): number {
  let count = 0
  for (let i = index + 1; i < messages.length; i++) {
    if (messages[i].role === 'user') count++
  }
  return count
}

export type DiscardChoice = 'continue' | 'cancel'

export interface DiscardLaterTurnsOptions {
  title: string
  count: number
  /** 确认按钮文字，写清这一下会做什么；不传用通用的「继续」 */
  okText?: string
  t: (key: string, params?: Record<string, unknown>) => string
}

export function askDiscardLaterTurns(options: DiscardLaterTurnsOptions): Promise<DiscardChoice> {
  const { title, count, okText, t } = options
  return new Promise<DiscardChoice>((resolve) => {
    let settled = false
    let handle: DialogHandle | null = null
    const pick = (choice: DiscardChoice): void => {
      if (settled) return
      settled = true
      handle?.destroy()
      resolve(choice)
    }
    handle = confirmDialog({
      title,
      content: t('assistant.chat.discardLaterTurns', { count }),
      danger: true,
      focusCancel: true,
      afterClose: () => pick('cancel'),
      footer: () =>
        h(
          'div',
          {
            class: 'discard-later-turns-footer',
            style:
              'display: flex; justify-content: flex-end; gap: var(--space-2); padding-top: var(--space-3)'
          },
          [
            h(AppButton, { 'data-choice': 'cancel', onClick: () => pick('cancel') }, () =>
              t('assistant.chat.discardCancel')
            ),
            h(
              AppButton,
              {
                'data-choice': 'continue',
                variant: 'primary',
                danger: true,
                onClick: () => pick('continue')
              },
              () => okText ?? t('assistant.chat.discardContinue')
            )
          ]
        )
    })
  })
}
