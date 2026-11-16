<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter, useRoute } from 'vue-router'
import { Layout } from 'ant-design-vue'
import { message } from '@renderer/utils/messageManager'
import { useI18n } from 'vue-i18n'
import SideMenu from './components/SideMenu.vue'
import TabsHeader from './components/TabsHeader.vue'
import AppPageLoading from '@renderer/components/AppPageLoading.vue'
import { pendingPage } from '@renderer/router/pageLoading'
import GlobalAudioPlayer from '@renderer/components/GlobalAudioPlayer.vue'
import ScreenshotMode from '@renderer/components/ScreenshotMode.vue'
import BridgeUnavailableBanner from '@renderer/components/BridgeUnavailableBanner.vue'
import AssetLockIndicator from '@renderer/components/AssetLockIndicator.vue'
import ImportProgressWidget from '@renderer/components/ImportProgressWidget.vue'
import SensitiveActionConfirm from '@renderer/components/SensitiveActionConfirm.vue'
import { useImportTasksStore } from '@renderer/store/modules/importTasks'
import { useAssetViewStore } from '@renderer/store/modules/assetViewStore'
import { useLayoutUiStore } from '@renderer/store/modules/layoutUiStore'
import { useVaultStore } from '@renderer/store/modules/vaultStore'
import { askEditorLinkInstall } from '@renderer/hooks/usePluginInstallNotice'
import { getTabCacheKey } from '@renderer/common/tabRoute'
import { useAppAgentRunner } from '@renderer/views/Assistant/composables/appAgentRunner'
import { useFollowUpDelivery } from '@renderer/views/Assistant/composables/followUpDelivery'
import { useSessionProjectSync } from '@renderer/views/Assistant/composables/sessionProjectSync'
import { useAutoReadAloud } from '@renderer/views/Assistant/composables/autoReadAloud'
import { hasVisibleSidebarFloatingOverlay, useSidebarPeek } from './composables/sidebarPeek'
import { useNotificationActivation } from './composables/notificationActivation'
import { useTrayBridge } from './composables/trayBridge'
// StatusBar 已移至 AssetManagement 专用，只在资产库页面显示

const { Content } = Layout

const router = useRouter()
const route = useRoute()
const { t } = useI18n()
const assetViewStore = useAssetViewStore()
const layoutUiStore = useLayoutUiStore()
const importTasksStore = useImportTasksStore()

/*
 * 导入进度挂件也挂在这一层，理由和资产锁指示器一样：正在导入这件事该看到的是人，
 * 而人此刻很可能正在别的页面上。挂在资产库页面里的时候，那个页面一失活 DOM 就被
 * keep-alive 卸掉，三十个 G 的导入在跑，界面上一点痕迹都没有。
 */
const runningImportTasks = computed(() =>
  importTasksStore.runningTasks(useVaultStore().currentVault?.id)
)

/** 点任务卡片 → 回资产库并定位到那个文件夹（`?folderKey=` 是页面已支持的入口） */
const handleImportTaskNavigate = (folderKey: string): void => {
  void router.push({ path: '/asset-management', query: { folderKey: folderKey || 'ALL' } })
}

/**
 * 挂件上的中止按钮。
 *
 * 真正会停的是发起这次导入的那一方（资产库页面监听 window 事件），
 * 这里只把「用户点了停」这件事广播出去。
 */
const handleImportTaskCancel = (taskId: string): void => {
  window.dispatchEvent(new CustomEvent('vault-import:cancel', { detail: { id: taskId } }))
}

/**
 * 点任务卡片上的「查看」：回资产库，由页面自己展开那次导入的结果。
 */
const handleImportTaskInspect = (taskId: string): void => {
  if (!importTasksStore.tasks.get(taskId)?.vaultResult) return
  void router.push('/asset-management')
  window.dispatchEvent(new CustomEvent('vault-import:inspect', { detail: { id: taskId } }))
}

/** 用户看过了，把这条失败任务收掉 */
const handleImportTaskDismiss = (taskId: string): void => {
  importTasksStore.removeTask(taskId)
}

const { sideMenuCollapseRequestVersion } = storeToRefs(layoutUiStore)

/*
 * 后台跑活的五样东西，都挂在这里 —— 常驻布局比任何一个页面活得久。
 *
 * 助手路由没开 keepAlive，用户切去看素材库那一刻它就卸载了，而 agent 照样在跑。
 * 「谁来发起一轮」（appAgentRunner，跟进队列和语音派活共用）、「什么时候该发下
 * 一条」（followUpDelivery）、「点了系统通知跳去哪」（notificationActivation）、
 * 「模型把这条对话改挂到别的工程下了」（sessionProjectSync）和「回复落定了念出
 * 来」（autoReadAloud）都不能拴在页面寿命上，否则用户切个页面就静默失效 ——
 * 通知那条尤其：他正是因为切走了才会收到那条通知；归属那条同理，模型改归属时
 * 用户多半正在别处等结果；朗读那条也一样，他就是因为要等才切走的。
 *
 * 顺序有讲究：投递会用到运行器，运行器要先装上。
 */
useAppAgentRunner()
useFollowUpDelivery()
useNotificationActivation()
useTrayBridge()
useSessionProjectSync()
useAutoReadAloud()

// 基于路由meta控制组件显示
const showMenu = computed(() => route.meta.showMenu !== false)
const showTab = computed(() => route.meta.showTab !== false)
/**
 * macOS 的红绿灯浮在内容上，得有人给它让位并提供拖拽区。
 * 平时侧边栏顶栏或标签栏已经担着这件事（见各自的 mac-controls-inset）；
 * 两个都不显示的路由（比如 /404）才补这一条 —— 不能反过来强开标签栏，
 * 那会把明确写了 showTab: false 的路由一起覆盖掉。
 */
const showMacTitlebarInset = computed(
  () => window.api?.platform === 'darwin' && !showTab.value && !showMenu.value
)

// 侧边栏收折状态 - 持久化到 localStorage
const SIDEBAR_COLLAPSED_KEY = 'sidebar-collapsed'
const getInitialCollapsedState = (): boolean => {
  const saved = localStorage.getItem(SIDEBAR_COLLAPSED_KEY)
  return saved === 'true'
}
const collapsed = ref(getInitialCollapsedState())

watch(sideMenuCollapseRequestVersion, () => {
  if (!collapsed.value) {
    collapsed.value = true
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, 'true')
  }
})

// TabsHeader组件引用
const tabsHeaderRef = ref()

// 动态获取当前打开的标签页作为缓存列表
// const tabsStore = useTabsStore()

// 已移除未使用的缓存视图计算属性，避免类型检查告警
// 切换侧边栏收折状态
const toggleCollapsed = () => {
  collapsed.value = !collapsed.value
  localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed.value))
}

/**
 * 收起后的浮出面板。
 *
 * 触发点在标签栏那枚按钮上（TabsHeader），面板本身是 SideMenu，
 * 两边都不是对方的父级，所以这份状态放在它们共同的父级这里。
 */
/**
 * 还该不该留着浮层。
 *
 * 一是鼠标其实还压在按钮或面板上（划得快时 mouseleave 会漏发，直接问 DOM 更准），
 * 二是右键菜单、重命名弹窗这些挂在 body 上的浮层还开着 —— 这时候收面板等于把上下文抽走。
 */
const shouldStayOpen = (): boolean => {
  if (document.querySelector('.side-menu:hover, .sidebar-toggle:hover')) return true
  return hasVisibleSidebarFloatingOverlay()
}

const sidebarPeek = useSidebarPeek({ collapsed: () => collapsed.value, shouldStayOpen })
const { peeking } = sidebarPeek

/** Esc 关掉浮出的侧边栏，和它盖住内容这件事对应 */
const handleGlobalKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape' && peeking.value) sidebarPeek.close()
}

// 菜单点击事件
const handleMenuClick = (key: string) => {
  const target = String(key || '').trim()
  console.log('[MainLayout] navigating from side menu:', target)
  if (!target) return
  router.push(target).catch((error) => {
    console.warn('[MainLayout] side menu navigation failed:', error)
  })
}

// 处理TabsHeader组件的激活tab变化事件
const handleActiveTabChange = (key: string) => {
  // 可以在这里添加一些全局的tab切换逻辑，比如记录用户行为等
  console.log('Active tab changed to:', key)
}

/**
 * 全局监听 Agent 创建文件夹的事件
 * 当用户不在资产库页面时，AssetManagement 组件可能被缓存，
 * 此时事件监听器虽然存在但可能无法正确触发刷新
 * 通过在 MainLayout 层面监听事件并设置 Store 标记，
 * 确保 AssetManagement 在 onActivated 时能正确刷新
 */
const handleAssetTreeRefresh = (
  _event: unknown,
  payload: { parentKey: string; createdCount: number }
) => {
  console.log('[MainLayout] 收到 Agent 创建文件夹事件，标记树需要刷新:', payload)
  assetViewStore.markTreeNeedsRefresh(payload)
}

/**
 * 活跃保管库被主进程换掉了（agent 的 switch_vault、网络库迁移）。
 *
 * 必须让界面跟上：用户看着 A 库、应用实际在 B 库上读写，
 * 这种不一致比切不过去糟糕得多 —— 他会以为自己的素材没了。
 * 所以还要明着说一声切到哪儿了，切库不能悄悄发生。
 */
const handleVaultSwitched = (_event: unknown, payload: { vaultId: string; name: string }): void => {
  if (!payload?.vaultId) return
  const vaultStore = useVaultStore()
  if (vaultStore.currentVault?.id === payload.vaultId) return

  vaultStore.applyExternalVaultSwitch(payload.vaultId)
  message.info(t('assetManagement.vault.switchedByAgent', { name: payload.name }))
}

/** 首次导入工程时问要不要装连接插件，同样挂在布局上：导入入口不只首页一个 */
let offEditorLinkInstallPrompt: (() => void) | null = null

onMounted(() => {
  // 监听 Agent 创建文件夹事件
  window.electron.ipcRenderer.on('asset-tree:refresh', handleAssetTreeRefresh)
  window.electron.ipcRenderer.on('vault:switched', handleVaultSwitched)
  document.addEventListener('keydown', handleGlobalKeydown)
  offEditorLinkInstallPrompt =
    window.api.database.project.onEditorLinkInstallPrompt?.(askEditorLinkInstall) ?? null
})

onUnmounted(() => {
  window.electron.ipcRenderer.removeListener('asset-tree:refresh', handleAssetTreeRefresh)
  window.electron.ipcRenderer.removeListener('vault:switched', handleVaultSwitched)
  document.removeEventListener('keydown', handleGlobalKeydown)
  offEditorLinkInstallPrompt?.()
  offEditorLinkInstallPrompt = null
})
</script>

<template>
  <Layout class="main-layout">
    <!-- 左侧菜单 -->
    <SideMenu
      v-if="showMenu"
      :collapsed="collapsed"
      :peeking="peeking"
      @menu-click="handleMenuClick"
      @toggle-collapsed="toggleCollapsed"
      @peek-enter="sidebarPeek.open()"
      @peek-leave="sidebarPeek.scheduleClose()"
      @peek-close="sidebarPeek.close()"
    />
    <Layout
      :class="[showMenu ? '' : 'no-menu', showMenu && collapsed ? 'sidebar-hidden' : '']"
      class="layout-container"
    >
      <!-- 没有标签栏也没有侧边栏时，替红绿灯留出的那条 -->
      <div v-if="showMacTitlebarInset" class="mac-titlebar-inset"></div>

      <!-- 顶部基础信息区域 -->
      <div v-if="showTab" class="tabs-header-wrapper">
        <TabsHeader
          ref="tabsHeaderRef"
          :collapsed="collapsed"
          :show-sidebar-toggle="showMenu"
          @active-tab-change="handleActiveTabChange"
          @toggle-collapsed="toggleCollapsed"
          @peek-enter="sidebarPeek.open()"
          @peek-leave="sidebarPeek.scheduleClose()"
        />
      </div>

      <!--
        引擎桥接没起来时的横幅。挂在这里而不是某一页：桥接是整个应用的能力，
        而主进程写好的那句原因（端口被谁占了、怎么办）以前根本没有出口。
        放在内容这一列（纵向）里而不是最外层：最外层是横向一排，横幅会变成和侧边栏、
        内容区并排的一列，把内容区挤到只剩一条
      -->
      <BridgeUnavailableBanner />

      <!-- 内容区域 -->
      <Content class="content glass" :class="!showMenu && !showTab ? 'full-content' : ''">
        <AppPageLoading v-if="pendingPage" class="pending-page" :path="pendingPage.path" />
        <div v-show="!pendingPage" class="route-content">
          <router-view v-slot="{ Component, route: pageRoute }">
            <keep-alive :max="50">
              <component
                :is="Component"
                v-if="pageRoute.meta.keepAlive"
                :key="getTabCacheKey(pageRoute)"
              />
            </keep-alive>
            <component :is="Component" v-if="!pageRoute.meta.keepAlive" :key="pageRoute.fullPath" />
          </router-view>
        </div>
      </Content>
    </Layout>

    <!-- 全局音频播放器 -->
    <GlobalAudioPlayer />

    <!-- 截图模式组件 -->
    <ScreenshotMode />

    <!--
      资产锁指示器 + 逃生口。挂在全局而不是助手页里：被挡住的是某条对话，
      而该看到这件事的是人，人此刻很可能正在别的页面上。
    -->
    <AssetLockIndicator />

    <!-- 后台导入进度挂件：任何页面都看得到 -->
    <ImportProgressWidget
      :tasks="runningImportTasks"
      @navigate="handleImportTaskNavigate"
      @cancel="handleImportTaskCancel"
      @inspect="handleImportTaskInspect"
      @dismiss="handleImportTaskDismiss"
    />

    <!--
      敏感操作确认框。

      这里原来挂在 `Assistant/components/ChatLog.vue` 里，注释写着「全局单例」，
      实际是助手页的子组件 —— 而助手页没有 keepAlive，切走就卸载。
      于是从别的页面（比如库详情页点「放进当前工程」）发起的操作，
      审批框根本不会出现，用户只会在 `APPROVAL_TIMEOUT_MS`（5 分钟）之后
      收到一句「失败」，还不知道自己曾被问过。

      挂在这里和 AssetLockIndicator 是同一个理由：该看到这件事的是人，
      而人此刻很可能正在别的页面上。
    -->
    <SensitiveActionConfirm />

    <!-- 订阅到期覆盖层 -->
  </Layout>
</template>

<style scoped lang="less">
.main-layout {
  /* 侧边栏的感应条要避开这条标签栏，两边共用同一个高度 */
  --app-tabs-height: 36px;

  flex: 1;
  display: flex;
  gap: 0;
  background: transparent;
  /* 侧边栏是绝对定位的浮层（收起时整块推到窗口外），这里当它的定位参照 */
  position: relative;
  overflow: hidden;

  :deep(.ant-layout) {
    background: transparent;
  }

  :deep(.ant-layout-content) {
    background: transparent;
  }
}

.layout-container {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.tabs-header-wrapper {
  flex-shrink: 0;
  height: var(--app-tabs-height);
  background: var(--color-bg-surface-hover) !important;
  overflow: hidden;
  /* 顶部区域上移后可以作为窗口拖拽区域 */
  -webkit-app-region: drag;
}

/* 红绿灯专用的那一条：和标签栏同高，只负责让位和拖拽，不放任何内容 */
.mac-titlebar-inset {
  flex-shrink: 0;
  height: var(--app-tabs-height);
  -webkit-app-region: drag;
}

.route-content {
  height: 100%;
}

.content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  margin-top: 0;
  background: transparent;
  position: relative;

  /* 自定义滚动条 */
  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-track {
    background: var(--color-bg-surface-hover);
    border-radius: 3px;
  }

  &::-webkit-scrollbar-thumb {
    background: var(--color-bg-surface-hover);
    border-radius: 3px;

    &:hover {
      background: var(--color-bg-surface-hover);
    }
  }
}

.no-menu {
  margin-left: 0 !important;
}

/* 没有侧边栏、或侧边栏已收起时关闭左缘遮罩：那条渐隐是给贴着内容的侧边栏做过渡的，
   侧边栏不在了它就只是窗口左缘的一道黑边 */
.layout-container.no-menu .content::before,
.layout-container.sidebar-hidden .content::before {
  display: none;
}

.full-content {
  padding: 0;
  height: 100vh;
  margin: 0;
  border-radius: 0;
  border: none;
  box-shadow: none;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
</style>
.content.glass { --glass-bg: var(--color-bg-surface-hover); background:
var(--color-bg-surface-hover) !important; } :deep(.ant-layout-content.content.glass) { background:
var(--color-bg-surface-hover) !important; }
