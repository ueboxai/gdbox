<script setup lang="ts">
/**
 * 对话顶栏的「运行」：把这条对话所属工程的游戏开在窗口里，改完一句话点一下就能玩到新版本。
 *
 * 只在对话归属了一个有路径的工程时出现 —— 不知道是哪个工程就没东西可运行。
 * 游戏开着时按钮变成「重开」（主进程关掉上一局再开），旁边多一个「停止」。
 */
import AppTooltip from '@renderer/components/AppTooltip.vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { PhArrowClockwise, PhPlay, PhStop } from '@phosphor-icons/vue'
import { message } from '@/utils/messageManager'
import { useGamePlay } from '@renderer/composables/useGamePlay'
import { useChatSessionsStore } from '@renderer/store/modules/chatSessions'

const props = defineProps<{ chatSid?: string }>()

const { t } = useI18n()
const chatStore = useChatSessionsStore()

const projectPath = computed<string>(
  () => (props.chatSid ? chatStore.sessionById(props.chatSid)?.project?.projectPath : '') || ''
)

const { running, starting, play, stop } = useGamePlay(projectPath, (status) => {
  message.error(
    status.errors?.length
      ? t('assistant.playGame.crashedWith', { error: status.errors[0] })
      : t('assistant.playGame.crashed')
  )
})

async function handlePlay(): Promise<void> {
  const result = await play()
  if (!result.success && result.error) message.error(result.error)
}
</script>

<template>
  <span v-if="projectPath" class="play-game">
    <AppTooltip
      placement="bottom"
      :title="running ? t('assistant.playGame.restartTip') : t('assistant.playGame.playTip')"
    >
      <button
        type="button"
        class="play-btn"
        :class="{ running }"
        :disabled="starting"
        @click="handlePlay"
      >
        <PhArrowClockwise v-if="running" class="icon" />
        <PhPlay v-else class="icon" weight="fill" />
        <span>{{
          starting
            ? t('assistant.playGame.starting')
            : running
              ? t('assistant.playGame.restart')
              : t('assistant.playGame.play')
        }}</span>
      </button>
    </AppTooltip>
    <AppTooltip v-if="running" placement="bottom" :title="t('assistant.playGame.stop')">
      <button
        type="button"
        class="stop-btn"
        :aria-label="t('assistant.playGame.stop')"
        @click="stop"
      >
        <PhStop class="icon" weight="fill" />
      </button>
    </AppTooltip>
  </span>
</template>

<style scoped lang="less">
.play-game {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}

.play-btn,
.stop-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 4px 10px;
  border-radius: var(--radius-full);
  border: 1px solid var(--color-border);
  background: var(--color-bg-surface);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  white-space: nowrap;
  cursor: pointer;
  transition:
    background 0.2s ease,
    border-color 0.2s ease,
    color 0.2s ease;

  &:hover:not(:disabled) {
    border-color: var(--color-border-strong);
    color: var(--color-text-primary);
  }

  &:disabled {
    cursor: progress;
    color: var(--color-text-disabled);
    background: var(--color-bg-surface-hover);
    box-shadow: none;
  }
}

.stop-btn {
  padding: 4px 8px;
}

.icon {
  font-size: var(--font-size-sm);
}
</style>
