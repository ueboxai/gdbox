<script setup lang="ts">
/**
 * 引擎桥接没起来时的横幅。
 *
 * ## 为什么需要它
 *
 * 端口被别的程序占了的时候，主进程把失败类别 `startErrorCode` 和端口经 `ws:status`
 * 暴露出来。横幅按类别显示本地化文案；主进程拼的中文原句 `startError` 只在认不出
 * 类别时作为细节显示（英文界面不能直接显示那句中文）。
 *
 * 于是真机上是这样：应用一切正常，只是 UE 永远连不上。用户看不到任何异常，
 * 插件那头每 5 秒往 UE 日志里刷一条红字，而他不会去看 UE 的日志。这句话写得再好，
 * 不显示出来就等于不存在。
 *
 * ## 为什么挂在常驻布局上
 *
 * 桥接是整个应用的能力，不属于某一页。挂在页面上的话，用户切个标签就再也看不到了。
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { PhPlugsConnected, PhX } from '@phosphor-icons/vue'

import { restartBridge } from '@renderer/api/bridge'
import { message as toast } from '@renderer/utils/messageManager'
import AppButton from '@renderer/components/AppButton.vue'
import { useBridgeStatus } from '@renderer/composables/useBridgeStatus'

const { t } = useI18n()

/**
 * 状态是会变的，所以不能只在挂载时问一次 —— 订阅和退订都在 useBridgeStatus 里。
 *
 * 桥接在运行期可以被停、被重启（设置里的开关、`serviceManager.restart()`）。
 * 只读一次的话两个方向都坏：用户关掉占用端口的程序、重启桥接之后横幅还挂着说
 * 连不上；反过来运行中桥接挂掉则根本不提示 —— 回到「应用一切正常、UE 永远连不上」
 * 那个症状，正是这条横幅要消灭的东西。
 */
const bridge = useBridgeStatus()
const reason = computed(() => bridge.value?.startError ?? '')
const message = computed(() => {
  const status = bridge.value
  if (!status) return ''
  if (status.startErrorCode === 'EADDRINUSE') {
    return t('bridgeBanner.portInUse', { port: status.port })
  }
  if (status.startErrorCode === 'EACCES') {
    return t('bridgeBanner.noPermission', { port: status.port })
  }
  return status.startError ?? ''
})
const dismissed = ref(false)
const retrying = ref(false)

async function retry(): Promise<void> {
  retrying.value = true
  try {
    // 成功时 startError 经 ws:status-changed 被擦掉，横幅自己消失；失败时横幅还在，
    // 点了没变化会像没点上，所以单独提示一句
    const result = await restartBridge()
    if (!result.success) toast.error(t('bridgeBanner.retryFailed'))
  } finally {
    retrying.value = false
  }
}

// 换了一条新原因就重新弹出来：用户消掉的是上一条，不是这一条。
// watch 只在值真的变了时才跑，所以这里不用再比一次旧值。
watch(reason, (next) => {
  if (next) dismissed.value = false
})
</script>

<template>
  <div v-if="reason && !dismissed" class="bridge-banner" role="status">
    <PhPlugsConnected :size="18" class="bridge-banner__icon" />
    <div class="bridge-banner__text">
      <strong>{{ t('bridgeBanner.title') }}</strong>
      <span>{{ message }}</span>
    </div>
    <AppButton size="small" :loading="retrying" @click="retry">
      {{ t('bridgeBanner.retry') }}
    </AppButton>
    <AppButton
      variant="text"
      size="small"
      :aria-label="t('common.close')"
      @click="dismissed = true"
    >
      <template #icon><PhX :size="16" /></template>
    </AppButton>
  </div>
</template>

<style scoped lang="less">
.bridge-banner {
  /* 挂在内容列里，内容区 flex: 1 会把它压扁；它只占自己那一行 */
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-4);
  background: var(--color-warning-bg);
  border-bottom: 1px solid var(--color-warning-border);
  color: var(--color-text-primary);
}

.bridge-banner__icon {
  color: var(--color-warning-text);
  flex-shrink: 0;
}

.bridge-banner__text {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: baseline;
  flex: 1;
  min-width: 0;
  font-size: var(--font-size-sm);
}

.bridge-banner__text span {
  color: var(--color-text-secondary);
}
</style>
