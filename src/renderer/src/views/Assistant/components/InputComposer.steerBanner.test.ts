import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const inputComposerSource = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/views/Assistant/components/InputComposer.vue'),
  'utf8'
)

describe('InputComposer running state', () => {
  it('drops the banner and the labelled queue button', () => {
    expect(inputComposerSource).not.toContain('assistantInputComposer.steerBanner')
    expect(inputComposerSource).not.toContain('steer-banner')
    expect(inputComposerSource).not.toContain('steer-btn')
  })

  it('keeps the stop button while running and adds send once there is something to send', () => {
    // 跑着停止键常驻；输入框有东西时发送键并排出现（行为用例见 InputComposer.stopAndIme.test.ts）
    expect(inputComposerSource).toContain('v-if="props.isGenerating"')
    expect(inputComposerSource).toContain('v-if="!props.isGenerating || canSendFollowUp"')
    expect(inputComposerSource).toContain('@click="handlePrimaryAction"')
  })
})
