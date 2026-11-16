<template>
  <div class="voice-status-panel">
    <span role="status" aria-live="polite">{{ displayText }}</span>
    <template v-if="voice.active.value">
      <AppButton variant="text" size="small" @click="emit('open-call')">
        {{ t('assistantInputComposer.voice.boundCall', { name: boundTitle }) }}
      </AppButton>
      <AppButton
        variant="text"
        size="small"
        :aria-pressed="voice.muted.value"
        @click="voice.setMuted(!voice.muted.value)"
      >
        {{
          t(
            voice.muted.value
              ? 'assistantInputComposer.voice.unmute'
              : 'assistantInputComposer.voice.mute'
          )
        }}
      </AppButton>
    </template>
    <AppButton v-if="voice.connecting.value" variant="text" size="small" @click="voice.stop()">
      {{ t('assistantInputComposer.voice.cancelConnection') }}
    </AppButton>
    <template v-if="voice.error.value && !voice.connecting.value && !voice.active.value">
      <AppButton v-if="unconfigured" variant="text" size="small" @click="openModelSettings">
        {{ t('assistantInputComposer.voice.openModelSettings') }}
      </AppButton>
      <AppButton v-else variant="text" size="small" @click="emit('retry')">
        {{ t('assistantInputComposer.voice.retry') }}
      </AppButton>
      <AppButton variant="text" size="small" @click="voice.clearError()">
        {{ t('common.close') }}
      </AppButton>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * 语音通话的状态条：连接中 / 通话中 / 出错，以及静音、回到通话那条对话、重试。
 *
 * 首页放在问候语上方；对话页放进输入框那一层（`chatComposerRef`），
 * 这样高度算进 `--composer-height`，不会盖住铺满整页的消息区最后几行。
 */
import AppButton from '@renderer/components/AppButton.vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import type { RealtimeVoiceState } from '../composables/useRealtimeVoice'

const props = defineProps<{
  voice: RealtimeVoiceState
  statusText: string
  boundTitle: string
}>()

const emit = defineEmits<{
  (event: 'open-call'): void
  (event: 'retry'): void
}>()

const { t } = useI18n()
const router = useRouter()

/** 没配实时语音：重试没用，只说一句并给设置入口。主进程原文不铺到界面上 */
const unconfigured = computed(() => props.voice.errorCode.value === 'unconfigured')
const displayText = computed(() => {
  if (!props.voice.error.value) return props.statusText
  return unconfigured.value
    ? t('assistantInputComposer.voice.unconfigured')
    : props.voice.error.value
})

function openModelSettings(): void {
  props.voice.clearError()
  void router.push({ path: '/preferences', query: { tab: 'models' } })
}
</script>

<style scoped>
.voice-status-panel {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}
</style>
