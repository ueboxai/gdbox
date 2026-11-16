<template>
  <!--
    冠军区：当前最好的可交付版本（过了 godot_check、全部锁定回放用例和独立验收），
    加上守着它的回放用例。读的是主进程 `core/regression/` 的记录，见
    docs/P1-回放回归与冠军指针设计-2026-10-21.md。
    「恢复到冠军」先在原地确认一次：会改工程文件，但退回前会存一份，能反悔。
  -->
  <section
    class="champion"
    :class="{ 'is-pixel': pixel }"
    :aria-label="t('assistant.teamBoard.champion.title')"
  >
    <div class="champion-head">
      <PhTrophy class="champion-icon" />
      <span class="champion-title" :title="t('assistant.teamBoard.champion.hint')">
        {{ t('assistant.teamBoard.champion.title') }}
      </span>
      <span class="champion-summary">
        {{
          champion.current
            ? t('assistant.teamBoard.champion.summary', {
                snapshot: champion.current.snapshot,
                ago: ago(champion.current.promotedAt),
                passed: champion.current.passed,
                total: champion.current.total
              })
            : t('assistant.teamBoard.champion.none')
        }}
      </span>
      <AppButton
        v-if="champion.current && !confirming"
        size="small"
        variant="text"
        :disabled="running"
        :title="running ? t('assistant.teamBoard.champion.restoreRunning') : undefined"
        @click="confirming = true"
      >
        {{ t('assistant.teamBoard.champion.restore') }}
      </AppButton>
    </div>
    <p v-if="champion.current?.reason" class="champion-reason">{{ champion.current.reason }}</p>
    <div v-if="confirming" class="champion-confirm" role="alertdialog">
      <span>{{ t('assistant.teamBoard.champion.restoreConfirm') }}</span>
      <AppButton size="small" variant="primary" @click="confirm">
        {{ t('assistant.teamBoard.champion.restore') }}
      </AppButton>
      <AppButton size="small" variant="text" @click="confirming = false">
        {{ t('common.cancel') }}
      </AppButton>
    </div>
    <p v-if="champion.tampered.length" class="champion-warn">
      {{ t('assistant.teamBoard.champion.tampered', { ids: champion.tampered.join(', ') }) }}
    </p>
    <button
      v-if="champion.cases.length"
      type="button"
      class="fold"
      :aria-expanded="open"
      @click="open = !open"
    >
      <PhCaretRight class="caret" :class="{ 'is-open': open }" />
      {{ t('assistant.teamBoard.champion.cases', { n: champion.cases.length }) }}
    </button>
    <ul v-if="open" class="cases">
      <li v-for="item in champion.cases" :key="item.id" class="case">
        <AppTag :tone="TONES[item.status]">
          {{ t(`assistant.teamBoard.champion.status.${item.status}`) }}
        </AppTag>
        <span class="case-id">{{ item.id }}</span>
        <span class="case-title">{{ item.title }}</span>
        <span v-if="item.note" class="case-note">{{ item.note }}</span>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { PhCaretRight, PhTrophy } from '@phosphor-icons/vue'

import AppButton from '@renderer/components/AppButton.vue'
import AppTag from '@renderer/components/AppTag.vue'
import type { TagTone } from '@renderer/components/AppTag.types'
import type { TeamChampionView } from '@core/shared/agentTeam'

import { useTeamLabels } from './teamBoardLabels'

defineProps<{
  champion: TeamChampionView
  /** 团队正在跑：这时不能恢复（队员可能正在写文件） */
  running?: boolean
  /** 像素画风：底是深木色，字换成委托板那套颜色 */
  pixel?: boolean
}>()
const emit = defineEmits<{ restore: [] }>()
const { t } = useI18n()
const { ago } = useTeamLabels()

const TONES: Record<TeamChampionView['cases'][number]['status'], TagTone> = {
  locked: 'success',
  candidate: 'info',
  flaky: 'warning',
  retired: 'neutral'
}

const open = ref(false)
const confirming = ref(false)

function confirm(): void {
  confirming.value = false
  emit('restore')
}
</script>

<style scoped lang="less">
.champion {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  font-size: var(--font-size-sm);

  p {
    margin: 0;
  }
}

.champion-head,
.champion-confirm {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.champion-icon {
  flex-shrink: 0;
  color: var(--color-warning-text);
}

.champion-title {
  color: var(--color-text-primary);
  font-weight: 600;
}

.champion-summary,
.champion-reason,
.case-note {
  color: var(--color-text-secondary);
}

.champion-confirm {
  color: var(--color-text-primary);
}

.champion-warn {
  color: var(--color-danger-text);
}

.fold {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 0;
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  font-family: inherit;
  font-size: var(--font-size-sm);
  cursor: pointer;

  &:hover {
    color: var(--color-text-primary);
  }

  &:focus-visible {
    outline: 2px solid var(--color-border-focus);
    outline-offset: 1px;
    border-radius: var(--radius-sm);
  }
}

.caret {
  flex-shrink: 0;
  transition: transform 0.15s ease;

  &.is-open {
    transform: rotate(90deg);
  }
}

.cases {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.case {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-2);
}

.case-id {
  color: var(--color-text-secondary);
  font-family: var(--font-family-mono);
}

.case-title {
  color: var(--color-text-primary);
}

.is-pixel {
  .champion-summary,
  .champion-reason,
  .case-note,
  .case-id,
  .fold {
    color: var(--q-dim);
  }

  .fold:hover,
  .champion-title,
  .champion-confirm,
  .case-title {
    color: var(--q-paper);
  }
}
</style>
