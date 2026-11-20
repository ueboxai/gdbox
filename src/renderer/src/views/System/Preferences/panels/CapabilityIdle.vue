<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CapabilityKind, IdleAction, IdleView } from '@core/shared/capabilityIdle'
import { manageIdle } from '@renderer/api/capabilityIdle'
import AppButton from '@renderer/components/AppButton.vue'
import AppSwitch from '@renderer/components/AppSwitch.vue'

const props = defineProps<{ kind: CapabilityKind }>()
const emit = defineEmits<{ changed: [] }>()
const { t, locale } = useI18n()
const view = ref<IdleView>()
const busy = ref(false)
const error = ref('')

async function refresh(action?: IdleAction): Promise<void> {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    view.value = await manageIdle(props.kind, action)
    if (action) emit('changed')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    busy.value = false
  }
}
const reload = (): void => {
  void refresh()
}
onMounted(() => {
  reload()
  window.addEventListener('focus', reload)
})
onUnmounted(() => window.removeEventListener('focus', reload))
</script>

<template>
  <section v-if="kind === 'mcp' || view?.rows.length || error" class="idle">
    <h4>{{ t('capabilityIdle.title') }}</h4>
    <label v-if="kind === 'mcp'" class="line">
      {{ t('capabilityIdle.auto') }}
      <AppSwitch
        :checked="view?.auto"
        :disabled="busy || !view"
        :aria-label="t('capabilityIdle.auto')"
        @update:checked="(enabled) => refresh({ action: 'auto', enabled })"
      />
    </label>
    <div v-for="row in view?.rows" :key="row.id" class="line">
      <span>
        <strong>{{ row.id }}</strong> ·
        {{
          t(
            row.disabled === 'auto'
              ? 'capabilityIdle.autoOff'
              : row.disabled
                ? 'capabilityIdle.off'
                : row.kept
                  ? 'capabilityIdle.kept'
                  : 'capabilityIdle.unused'
          )
        }}
        <small>{{
          t(row.lastUsed ? 'capabilityIdle.last' : 'capabilityIdle.never', {
            date: new Date(row.lastUsed ?? row.since).toLocaleDateString(locale)
          })
        }}</small>
      </span>
      <AppButton
        v-if="row.disabled"
        :disabled="busy"
        @click="refresh({ action: 'restore', id: row.id })"
      >
        {{ t('capabilityIdle.restore') }}
      </AppButton>
      <template v-else>
        <AppButton
          :disabled="busy"
          @click="refresh({ action: row.kept ? 'unkeep' : 'keep', id: row.id })"
        >
          {{ t(row.kept ? 'capabilityIdle.unkeep' : 'capabilityIdle.keep') }}
        </AppButton>
        <AppButton
          v-if="!row.kept"
          :disabled="busy"
          @click="refresh({ action: 'disable', id: row.id })"
        >
          {{ t('capabilityIdle.disable') }}
        </AppButton>
      </template>
    </div>
    <div v-if="error" role="alert">
      {{ t('capabilityIdle.failed') }} {{ error }}
      <AppButton :disabled="busy" @click="reload">{{ t('capabilityIdle.retry') }}</AppButton>
    </div>
  </section>
</template>

<style scoped>
.idle,
.line {
  display: grid;
  gap: var(--space-2);
}
.line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
}
.line > span {
  flex: 1;
}
small {
  display: block;
  color: var(--color-text-secondary);
}
</style>
