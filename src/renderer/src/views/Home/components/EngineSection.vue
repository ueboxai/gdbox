<template>
  <section
    class="section engine-section"
    @dragenter.stop.prevent="handleDragEnter"
    @dragover.stop.prevent="handleDragOver"
    @dragleave.stop.prevent="handleDragLeave"
    @drop.stop.prevent="handleDrop"
  >
    <header class="section-header">
      <div class="flex items-center gap-3">
        <h2 class="section-title">{{ t('page.home.godot.title') }}</h2>
        <AppButton
          :title="t('page.home.godot.add')"
          :aria-label="t('page.home.godot.add')"
          @click="handleClickAdd"
        >
          <template #icon><PhPlus /></template>
        </AppButton>
        <AppButton
          :loading="refreshing"
          :title="t('page.home.godot.refresh')"
          :aria-label="t('page.home.godot.refresh')"
          @click="refresh"
        >
          <template #icon><PhArrowClockwise /></template>
        </AppButton>
      </div>
    </header>

    <div v-if="engines.length > 0" class="engine-list">
      <div
        v-for="engine in engines"
        :key="engine.path"
        class="engine-card"
        :title="engine.path"
        @dblclick="() => handleStart(engine)"
      >
        <div class="card-header">
          <div class="version">{{ shortVersion(engine.version) }}</div>
          <div class="status">
            <AppTag v-if="buildTag(engine.version)">{{ buildTag(engine.version) }}</AppTag>
            <AppTag v-if="lastOpenedPath === engine.path" class="status-tag">
              {{ t('page.home.godot.lastOpened') }}
            </AppTag>
            <PhStar
              v-if="isDefault(engine)"
              weight="fill"
              class="star-icon"
              :aria-label="t('page.home.godot.default')"
            />
          </div>
        </div>

        <div class="divider">
          <div class="divider-track" :style="{ width: `${progress[engine.path] ?? 0}%` }"></div>
        </div>
        <div class="launch-area">
          <button
            type="button"
            class="launch-trigger"
            @click.stop="() => handleStart(engine)"
            @dblclick.stop
          >
            {{ t('page.home.godot.start') }}
          </button>
        </div>

        <div class="more-menu">
          <AppDropdown :trigger="['click']" :overlay-style="{ marginTop: '4px' }">
            <button
              type="button"
              class="more-icon"
              :title="t('page.home.godot.more')"
              :aria-label="t('page.home.godot.more')"
              @dblclick.stop
            >
              <PhDotsThree />
            </button>
            <template #overlay>
              <AppMenu>
                <AppMenuItem
                  key="open-folder"
                  item-key="open-folder"
                  @click="() => handleOpenFolder(engine)"
                  >{{ t('page.home.godot.openFolder') }}</AppMenuItem
                >
                <AppMenuDivider />
                <AppMenuItem
                  key="set-default"
                  item-key="set-default"
                  @click="() => toggleDefault(engine)"
                  >{{
                    isDefault(engine)
                      ? t('page.home.godot.unsetDefault')
                      : t('page.home.godot.setDefault')
                  }}</AppMenuItem
                >
                <template v-if="engine.custom">
                  <AppMenuDivider />
                  <AppMenuItem
                    key="remove"
                    item-key="remove"
                    danger
                    @click="() => handleRemove(engine)"
                    >{{ t('page.home.godot.remove') }}</AppMenuItem
                  >
                </template>
              </AppMenu>
            </template>
          </AppDropdown>
        </div>
      </div>
    </div>

    <AppPageSkeleton v-else-if="!loaded" variant="engines" :count="4" />
    <AppEmpty
      v-else
      :title="scanFailed ? t('page.home.godot.scanFailed') : t('page.home.godot.empty')"
    >
      <template #action>
        <AppButton v-if="scanFailed" :loading="refreshing" @click="refresh">
          {{ t('page.home.godot.retry') }}
        </AppButton>
        <AppButton v-else variant="primary" @click="handleClickAdd">
          {{ t('page.home.godot.add') }}
        </AppButton>
      </template>
    </AppEmpty>

    <DragDropOverlay :visible="isDragOver" :title="t('page.home.godot.dropTitle')" />
  </section>
</template>

<script setup lang="ts">
import AppButton from '@renderer/components/AppButton.vue'
import AppDropdown from '@renderer/components/AppDropdown.vue'
import AppEmpty from '@renderer/components/AppEmpty.vue'
import AppMenu from '@renderer/components/AppMenu.vue'
import AppMenuDivider from '@renderer/components/AppMenuDivider.vue'
import AppMenuItem from '@renderer/components/AppMenuItem.vue'
import AppPageSkeleton from '@renderer/components/AppPageSkeleton.vue'
import AppTag from '@renderer/components/AppTag.vue'
import DragDropOverlay from '@renderer/components/DragDropOverlay.vue'
import { message } from '@/utils/messageManager'
import { PhArrowClockwise, PhDotsThree, PhPlus, PhStar } from '@phosphor-icons/vue'
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { buildTag, shortVersion } from './godotVersion'

type GodotEngine = { path: string; version: string; custom: boolean }

const LAST_OPENED_KEY = 'lastOpenedGodotPath'

const { t } = useI18n()

// 页面切走再回来先显示上次的结果，后台再扫一遍
const engines = ref<GodotEngine[]>([])
const defaultPath = ref('')
const loaded = ref(false)
const scanFailed = ref(false)
const refreshing = ref(false)
const lastOpenedPath = ref(localStorage.getItem(LAST_OPENED_KEY) || '')
const progress = ref<Record<string, number>>({})
const isDragOver = ref(false)

const samePath = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()
const isDefault = (engine: GodotEngine): boolean =>
  !!defaultPath.value && samePath(defaultPath.value, engine.path)

async function load(): Promise<boolean> {
  try {
    const res = await window.api.godotEngines.list()
    if (!res.success) throw new Error(res.error)
    engines.value = res.engines
    defaultPath.value = res.defaultPath
    scanFailed.value = false
  } catch (error) {
    console.warn('[EngineSection] Godot scan failed:', error)
    scanFailed.value = true
  }
  loaded.value = true
  if (lastOpenedPath.value) progress.value = { [lastOpenedPath.value]: 100 }
  return !scanFailed.value
}

onMounted(load)

async function refresh(): Promise<void> {
  if (refreshing.value) return
  refreshing.value = true
  try {
    if (!(await load())) message.error(t('page.home.godot.scanFailed'))
  } finally {
    refreshing.value = false
  }
}

async function addEngine(path: string): Promise<boolean> {
  const res = await window.api.godotEngines.add(path)
  if (!res.success || !res.engine) return false
  const engine = res.engine
  const index = engines.value.findIndex((e) => samePath(e.path, engine.path))
  if (index >= 0) engines.value.splice(index, 1, engine)
  else engines.value.push(engine)
  return true
}

async function addMany(paths: string[]): Promise<void> {
  let added = 0
  for (const p of paths) if (await addEngine(p)) added++
  if (added > 0) message.success(t('page.home.godot.addSuccess', { count: added }))
  else message.error(t('page.home.godot.notGodot'))
}

async function handleClickAdd(): Promise<void> {
  const result = await window.api.dialog.showOpenDialog({
    title: t('page.home.godot.add'),
    properties: ['openFile'],
    filters: window.api.platform === 'win32' ? [{ name: 'Godot', extensions: ['exe'] }] : []
  })
  if (result.canceled || !result.filePaths?.length) return
  await addMany(result.filePaths)
}

function handleDragEnter(e: DragEvent): void {
  if (e.dataTransfer?.types.includes('Files')) isDragOver.value = true
}

function handleDragOver(e: DragEvent): void {
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
}

function handleDragLeave(e: DragEvent): void {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const inside =
    e.clientX >= rect.left &&
    e.clientX <= rect.right &&
    e.clientY >= rect.top &&
    e.clientY <= rect.bottom
  if (!inside) isDragOver.value = false
}

async function handleDrop(e: DragEvent): Promise<void> {
  isDragOver.value = false
  const paths = Array.from(e.dataTransfer?.files || [])
    .map((f) => window.api.getPathForFile(f))
    .filter(Boolean)
  if (paths.length > 0) await addMany(paths)
}

async function handleStart(engine: GodotEngine): Promise<void> {
  progress.value = { [engine.path]: 0 }
  requestAnimationFrame(() => {
    progress.value = { [engine.path]: 100 }
  })
  const res = await window.api.godotEngines.launch(engine.path)
  if (!res.success) {
    progress.value = {}
    message.error(
      res.error || t('page.home.godot.startFailed', { version: shortVersion(engine.version) })
    )
    return
  }
  lastOpenedPath.value = engine.path
  localStorage.setItem(LAST_OPENED_KEY, engine.path)
}

async function handleOpenFolder(engine: GodotEngine): Promise<void> {
  await window.api.shell.showItemInFolder(engine.path)
}

async function toggleDefault(engine: GodotEngine): Promise<void> {
  const next = isDefault(engine) ? '' : engine.path
  await window.api.godotEngines.setDefault(next)
  defaultPath.value = next
}

async function handleRemove(engine: GodotEngine): Promise<void> {
  await window.api.godotEngines.remove(engine.path)
  engines.value = engines.value.filter((e) => !samePath(e.path, engine.path))
  if (isDefault(engine)) defaultPath.value = ''
  if (lastOpenedPath.value && samePath(lastOpenedPath.value, engine.path)) {
    lastOpenedPath.value = ''
    localStorage.removeItem(LAST_OPENED_KEY)
  }
}
</script>

<style lang="less" scoped>
.engine-section {
  position: relative;

  .engine-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: var(--space-4);
    margin-top: var(--space-4);
  }
}

.engine-card {
  position: relative;
  width: 100%;
  min-width: 220px;
  max-width: 240px;
  height: 132px;
  padding: var(--space-4);
  border-radius: var(--radius-xl);
  background: linear-gradient(135deg, transparent, var(--color-bg-surface));
  border: 1px solid var(--color-border-subtle);
  box-shadow: 0 6px 30px var(--shadow-color-strong);
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease,
    border-color 0.2s ease;
  overflow: hidden;
  cursor: pointer;
}

.engine-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 16px 35px var(--shadow-color-strong);
  border-color: var(--color-border);
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.version {
  font-size: 32px;
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
}

.status {
  display: flex;
  align-items: center;
  gap: 6px;
}

.status-tag {
  color: var(--color-text-on-solid);
  background: var(--color-accent-solid);
  border-color: var(--color-accent-solid);
}

.star-icon {
  font-size: 14px;
  color: var(--color-warning-text);
}

.divider {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 34px;
  height: 2px;
  border-radius: 2px;
  background: var(--color-border-subtle);
  overflow: hidden;
}

.divider-track {
  height: 100%;
  border-radius: 2px;
  background: var(--gradient-accent);
  box-shadow: 0 0 12px var(--color-accent-border);
  transition: width 1.6s cubic-bezier(0.25, 1, 0.5, 1);
}

.launch-area {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 8px;
  text-align: center;
  z-index: 2;
}

.launch-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 5px 24px;
  border-radius: 999px;
  font: inherit;
  font-size: 13px;
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
  background: var(--color-bg-surface-hover);
  border: 1px solid var(--color-border);
  cursor: pointer;
  transition: all 0.2s ease;
}

.launch-trigger:hover {
  filter: brightness(1.08);
  border-color: var(--color-border-strong);
}

.launch-trigger:focus-visible,
.more-icon:focus-visible {
  outline: 2px solid var(--color-border-focus);
  outline-offset: 2px;
}

.more-menu {
  position: absolute;
  right: 10px;
  bottom: 10px;
  z-index: 3;
}

.more-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-primary);
  cursor: pointer;
  transition: all 0.2s ease;
}

.more-icon:hover {
  background: var(--color-bg-surface-hover);
}
</style>
