<script setup lang="ts">
/**
 * 中转站网页「聊天 → GDBox」唤起（gdbox://add-provider?key=…）。挂在 App 根上：
 * 主进程收到链接后跳到设置页的模型面板，预填的新服务商由 AIProviderSettings 打开。
 * 冷启动时链接比界面先到，挂载时补查一次。
 */
import { onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()

function openModels(): void {
  void router.push({ path: '/preferences', query: { tab: 'models' } })
}

let unsubscribe: (() => void) | null = null
onMounted(async () => {
  unsubscribe = window.api.aiProvider.onLink(openModels)
  if (await window.api.aiProvider.hasLink()) openModels()
})
onUnmounted(() => unsubscribe?.())
</script>

<template>
  <span hidden />
</template>
