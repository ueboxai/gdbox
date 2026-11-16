<template>
  <AppModal
    v-model:open="visible"
    :title="t('importToProjectModal.title')"
    :width="520"
    :mask-closable="false"
    @cancel="visible = false"
  >
    <div class="import-project-modal">
      <p class="source-summary">{{ sourceSummary }}</p>
      <label class="target-label" for="import-project-target">
        {{ t('importToProjectModal.targetLabel') }}
      </label>
      <div class="target-row">
        <a-input
          id="import-project-target"
          :value="targetDir"
          readonly
          :placeholder="t('importToProjectModal.targetPlaceholder')"
        />
        <AppButton :disabled="copying" @click="chooseTarget">
          {{ t('importToProjectModal.chooseFolder') }}
        </AppButton>
      </div>
      <p class="hint">{{ t('importToProjectModal.hint') }}</p>
    </div>

    <template #footer>
      <AppButton @click="visible = false">{{ t('importToProjectModal.cancel') }}</AppButton>
      <AppButton
        variant="primary"
        :loading="copying"
        :disabled="!targetDir || !source"
        @click="handleConfirm"
      >
        {{ t('importToProjectModal.confirm') }}
      </AppButton>
    </template>
  </AppModal>
</template>

<script setup lang="ts">
/**
 * 导入到项目（精简版）。
 *
 * 只做一件事：把选中的资产按原名复制进用户选的项目文件夹。
 * Godot 编辑器会自动扫描新文件，不需要引擎侧接口。
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppModal from '@renderer/components/AppModal.vue'
import AppButton from '@renderer/components/AppButton.vue'
import { message } from '@renderer/utils/messageManager'
import { useVaultStore } from '@renderer/store/modules/vaultStore'
import {
  collectProjectCopyEntries,
  copyEntriesToFolder,
  type ProjectCopySourceItem
} from '../../utils/projectCopy'

const props = defineProps<{
  open: boolean
  source?: ProjectCopySourceItem | null
}>()

const emit = defineEmits<{ (e: 'update:open', value: boolean): void }>()

const { t } = useI18n()
const vaultStore = useVaultStore()

const visible = computed({
  get: () => props.open,
  set: (value: boolean) => emit('update:open', value)
})

/** 记住上次选的目标文件夹：连续往同一个项目里放素材是常态 */
const LAST_TARGET_KEY = 'importToProject.lastTarget'
const targetDir = ref('')
const copying = ref(false)

watch(
  () => props.open,
  (open) => {
    if (open) targetDir.value = localStorage.getItem(LAST_TARGET_KEY) || ''
  },
  { immediate: true }
)

const sourceSummary = computed(() => {
  const source = props.source
  if (!source) return ''
  if (source.type === 'batch')
    return t('importToProjectModal.sourceItems', { count: source.children?.length || 0 })
  return t('importToProjectModal.sourceSingle', {
    name: source.assetName || source.name || source.title || source.folderName || ''
  })
})

const chooseTarget = async (): Promise<void> => {
  const result = await window.api.dialog.showOpenDialog({
    title: t('importToProjectModal.chooseFolder'),
    defaultPath: targetDir.value || undefined,
    properties: ['openDirectory', 'createDirectory']
  })
  if (!result.canceled && result.filePaths[0]) targetDir.value = result.filePaths[0]
}

const listFolder = async (folderKey: string) => {
  const result = await window.api.database.assetData.getByFolderKeyRecursive(folderKey)
  if (!result?.success) throw new Error(result?.error || 'getByFolderKeyRecursive failed')
  return result.data || []
}

const handleConfirm = async (): Promise<void> => {
  if (!props.source || !targetDir.value || copying.value) return
  copying.value = true
  try {
    const entries = await collectProjectCopyEntries(
      props.source,
      vaultStore.currentVault?.path || '',
      listFolder
    )
    if (entries.length === 0) {
      message.warning(t('importToProjectModal.noFiles'))
      return
    }
    localStorage.setItem(LAST_TARGET_KEY, targetDir.value)
    const result = await copyEntriesToFolder(entries, targetDir.value, {
      exists: async (path) => Boolean((await window.api.invoke('fs:exists', path))?.exists),
      copy: async (src, dest) => {
        const res = await window.api.fs.copyFile(src, dest)
        if (!res?.success) throw new Error(res?.error || 'copyFile failed')
      }
    })
    if (result.failed > 0) {
      message.error(t('importToProjectModal.copyFailed', { count: result.failed }))
    } else if (result.copied === 0) {
      message.info(t('importToProjectModal.allSkipped', { count: result.skipped }))
    } else {
      message.success(
        result.skipped > 0
          ? t('importToProjectModal.copiedWithSkipped', {
              count: result.copied,
              skipped: result.skipped
            })
          : t('importToProjectModal.copied', { count: result.copied })
      )
    }
    if (result.failed === 0) visible.value = false
  } catch (error) {
    console.error('[ImportToProject] 读取待导入资产失败:', error)
    message.error(t('importToProjectModal.loadFailed'))
  } finally {
    copying.value = false
  }
}
</script>

<style scoped>
.import-project-modal {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.source-summary {
  margin: 0;
  color: var(--color-text-primary);
}
.target-label {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}
.target-row {
  display: flex;
  gap: var(--space-2);
}
.hint {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}
</style>
