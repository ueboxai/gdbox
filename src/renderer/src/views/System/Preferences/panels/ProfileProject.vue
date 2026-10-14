<script setup lang="ts">
/**
 * 项目设置
 *
 * 管的是「从盒子打开工程」这个动作前后发生什么：用哪个 Godot 打开、打开后藏不藏窗口。
 * 真相源在主进程（`appSettingsManager`）—— 打开工程和隐藏窗口都在 `shell:openUproject`
 * 里做，覆盖所有从盒子启动工程的入口；这里的 ref 只是显示态。
 */
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { message } from '@renderer/utils/messageManager'
import AppSwitch from '@renderer/components/AppSwitch.vue'
import AppButton from '@renderer/components/AppButton.vue'
import AppSpin from '@renderer/components/AppSpin.vue'

const { t } = useI18n()

const hideWindowOnProjectLaunch = ref(false)
/** 用户指定的 Godot；空串 = 自动查找 */
const godotPath = ref('')
/** 按当前设置实际找到的那个。undefined = 还在找 */
const godotFound = ref<{ path: string; version: string } | null | undefined>(undefined)

async function refreshGodot(): Promise<void> {
  godotFound.value = undefined
  try {
    godotFound.value = await window.api.appSettings.locateGodot()
  } catch {
    godotFound.value = null
  }
}

onMounted(async () => {
  try {
    const settings = await window.api.appSettings.get()
    // 只认 true，和主进程的兜底保持一致：读不出来时宁可不藏窗口
    hideWindowOnProjectLaunch.value = settings.hideWindowOnProjectLaunch === true
    godotPath.value = settings.godotPath ?? ''
  } catch (error) {
    console.error('加载项目设置失败:', error)
  }
  await refreshGodot()
})

async function saveGodotPath(path: string): Promise<boolean> {
  try {
    await window.api.appSettings.set({ godotPath: path })
    godotPath.value = path
    await refreshGodot()
    return true
  } catch (error) {
    console.error('保存 Godot 路径失败:', error)
    message.error(t('profile.general.settingSaveFailed'))
    return false
  }
}

/** 让用户指一个 Godot 可执行文件。不是 Godot 4 就退回原来的设置，并说清楚 */
async function chooseGodot(): Promise<void> {
  const result = await window.api.dialog.showOpenDialog({
    properties: ['openFile'],
    filters:
      window.api.platform === 'darwin'
        ? [{ name: 'Godot', extensions: ['app'] }]
        : window.api.platform === 'win32'
          ? [{ name: 'Godot', extensions: ['exe'] }]
          : []
  })
  const picked = result.canceled ? '' : (result.filePaths?.[0] ?? '')
  if (!picked) return
  const previous = godotPath.value
  if (!(await saveGodotPath(picked))) return
  if (!godotFound.value) {
    message.error(t('profile.project.godotInvalid'))
    await saveGodotPath(previous)
  }
}

/**
 * 写回主进程。
 *
 * 走开关的 change 事件而不是 watch：watch 分不清「用户拨的」和「刚从主进程
 * 读回来的」，得靠一个「加载完了没有」的标志兜着，而那个标志本身又要和 Vue
 * 的异步 watch 抢时序 —— 抢输了就是打开设置页的一瞬间把用户设的值覆盖掉。
 */
async function applyHideWindowOnProjectLaunch(enabled: boolean): Promise<void> {
  hideWindowOnProjectLaunch.value = enabled
  try {
    await window.api.appSettings.set({ hideWindowOnProjectLaunch: enabled })
  } catch (error) {
    console.error('保存项目设置失败:', error)
    message.error(t('profile.general.settingSaveFailed'))
    hideWindowOnProjectLaunch.value = !enabled
  }
}
</script>

<template>
  <div class="settings-content">
    <section class="settings-section">
      <h4 class="section-title">{{ $t('profile.project.godot') }}</h4>
      <div class="settings-list">
        <div class="setting-item">
          <div class="setting-info">
            <div class="setting-label">
              <template v-if="godotFound">
                {{ $t('profile.project.godotFound', { version: godotFound.version }) }}
              </template>
              <template v-else-if="godotFound === null">
                {{ $t('profile.project.godotNotFound') }}
              </template>
              <AppSpin v-else size="small" />
            </div>
            <div class="setting-desc">
              <template v-if="godotFound">{{ godotFound.path }}</template>
              <template v-else-if="godotFound === null">
                {{ $t('profile.project.godotNotFoundDesc') }}
              </template>
              <template v-if="!godotPath && godotFound">
                · {{ $t('profile.project.godotAuto') }}
              </template>
            </div>
          </div>
          <div class="setting-actions">
            <AppButton v-if="godotPath" size="small" variant="text" @click="saveGodotPath('')">
              {{ $t('profile.project.godotUseAuto') }}
            </AppButton>
            <AppButton size="small" @click="chooseGodot">
              {{ $t('profile.project.godotChoose') }}
            </AppButton>
          </div>
        </div>
      </div>
    </section>

    <section class="settings-section">
      <h4 class="section-title">{{ $t('profile.project.openBehavior') }}</h4>
      <div class="settings-list">
        <div class="setting-item">
          <div class="setting-info">
            <div class="setting-label">{{ $t('profile.project.hideWindowOnLaunch') }}</div>
            <div class="setting-desc">{{ $t('profile.project.hideWindowOnLaunchDesc') }}</div>
          </div>
          <AppSwitch
            :checked="hideWindowOnProjectLaunch"
            @change="applyHideWindowOnProjectLaunch"
          />
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped lang="less">
.settings-content {
  display: flex;
  flex-direction: column;
  gap: var(--space-10);
}

.settings-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.section-title {
  margin: 0;
  padding-bottom: var(--space-2);
  border-bottom: 1px solid var(--color-border-subtle);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
  letter-spacing: 0.02em;
}

.settings-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.setting-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
}

.setting-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}

.setting-label {
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
}

.setting-desc {
  font-size: 12px;
  color: var(--color-text-muted);
  word-break: break-all;
}

.setting-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
}
</style>
