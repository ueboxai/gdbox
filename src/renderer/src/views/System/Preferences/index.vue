<script setup lang="ts">
/**
 * 偏好设置主入口
 * 原型风格：玻璃面板 + 顶部Header + 内容区
 */
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import PreferencesSidebar from './components/PreferencesSidebar.vue'
import ProfileGeneral from './panels/ProfileGeneral.vue'
import ProfileShortcuts from './panels/ProfileShortcuts.vue'
import ProfileAppearance from './panels/ProfileAppearance.vue'
import ProfileAI from './panels/ProfileAI.vue'
import ProfilePersonalization from './panels/ProfilePersonalization.vue'
import ProfileSkills from './panels/ProfileSkills.vue'
import ProfileExperience from './panels/ProfileExperience.vue'
import ProfileTools from './panels/ProfileTools.vue'
import ProfileUsage from './panels/Usage/ProfileUsage.vue'
import ProfileTeam from './panels/ProfileTeam.vue'
import AIProviderSettings from './panels/AIProviders/AIProviderSettings.vue'
import AgentV3DebugPanel from './panels/AgentV3Debug/AgentV3DebugPanel.vue'
import McpSettings from './panels/Mcp/McpSettings.vue'
import ProfileProject from './panels/ProfileProject.vue'
import ProfileCli from './panels/ProfileCli.vue'
import ProfileObjectStorage from './panels/ProfileObjectStorage.vue'
import ProfileAsset from './panels/ProfileAsset.vue'
import ProfileNotebook from './panels/ProfileNotebook.vue'
import ProfileAbout from './panels/ProfileAbout.vue'
import ProfileVoice from './panels/ProfileVoice.vue'
import ScreenRecorderLibrary from '../../ScreenRecorder/ScreenRecorderLibrary.vue'

const { t } = useI18n()

// 当前激活的菜单 key
const activeKey = ref<string>('general')
const route = useRoute()
const router = useRouter()

/**
 * 页面标题配置。标题下不放说明段：页名已经说清楚这一页是什么。
 */
const pageHeaders: Record<string, { titleKey: string }> = {
  general: {
    titleKey: 'profile.general.title'
  },
  appearance: {
    titleKey: 'profile.appearance.title'
  },
  shortcuts: {
    titleKey: 'profile.shortcuts.title'
  },
  ai: {
    titleKey: 'profile.ai.title'
  },
  personalization: {
    titleKey: 'profile.personalization.title'
  },
  skills: {
    titleKey: 'profile.skills.title'
  },
  experience: {
    titleKey: 'profile.experience.title'
  },
  tools: {
    titleKey: 'profile.tools.title'
  },
  usage: {
    titleKey: 'profile.usage.title'
  },
  models: {
    titleKey: 'profile.models.title'
  },
  team: {
    titleKey: 'profile.team.title'
  },
  // 面板里每一节都有自己的小标题，页面标题与左栏一致即可
  mcp: {
    titleKey: 'profile.menu.mcp'
  },
  agentV3Debug: {
    titleKey: 'profile.menu.agentV3Debug'
  },
  project: {
    titleKey: 'profile.menu.project'
  },
  cli: {
    titleKey: 'profile.cli.title'
  },
  objectStorage: {
    titleKey: 'profile.objectStorage.title'
  },
  asset: {
    titleKey: 'profile.menu.asset'
  },
  notebook: {
    titleKey: 'profile.notebook.title'
  },
  screenRecorder: {
    titleKey: 'profile.screenRecorder.title'
  },
  voice: {
    titleKey: 'profile.voice.title'
  },
  about: {
    titleKey: 'profile.about.title'
  }
}

/**
 * 当前页面标题
 */
const currentTitle = computed(() => {
  const header = pageHeaders[activeKey.value]
  return header ? t(header.titleKey) : ''
})

// 监听路由参数，支持从外部跳转到特定设置项
watch(
  () => route.query.tab,
  (requestedTab) => {
    if (typeof requestedTab === 'string' && requestedTab in pageHeaders) {
      activeKey.value = requestedTab
    }
  },
  { immediate: true }
)

/**
 * 处理菜单切换
 * @param key 菜单项 Key
 */
function handleMenuChange(key: string): void {
  activeKey.value = key
  // 地址跟着当前页走：外部入口（「去配置模型」）再跳一次同一页时，query 才会变化、watch 才会触发
  if (route.path === '/preferences' && route.query.tab !== key) {
    void router.replace({ query: { ...route.query, tab: key } })
  }
}
</script>

<template>
  <div class="preferences-page">
    <div class="preferences-layout">
      <!-- 左侧菜单 -->
      <PreferencesSidebar :active-key="activeKey" @change="handleMenuChange" />

      <!-- 右侧主内容区 -->
      <main class="preferences-main glass-panel">
        <!-- 顶部 Header -->
        <header class="preferences-header">
          <h2 class="header-title">{{ currentTitle }}</h2>
        </header>

        <!-- 内容滚动区 -->
        <div class="preferences-scroll" :class="{ 'is-full-view': activeKey === 'screenRecorder' }">
          <div
            class="preferences-content"
            :class="{ 'full-width': activeKey === 'screenRecorder' }"
          >
            <!-- 常规设置 -->
            <ProfileGeneral v-if="activeKey === 'general'" />

            <!-- 外观设置 -->
            <ProfileAppearance v-else-if="activeKey === 'appearance'" />

            <!-- 快捷设置 -->
            <ProfileShortcuts v-else-if="activeKey === 'shortcuts'" />

            <!-- 录屏管理 -->
            <div v-else-if="activeKey === 'screenRecorder'" class="screen-recorder-wrapper">
              <ScreenRecorderLibrary />
            </div>

            <!-- MiniChat 设置 -->

            <!-- 语音助手 -->
            <ProfileVoice v-else-if="activeKey === 'voice'" />

            <!-- AI 助手 -->
            <ProfileAI v-else-if="activeKey === 'ai'" />

            <!-- 个性化：我写给它的那段常驻说明。技能在「技能」页 -->
            <ProfilePersonalization v-else-if="activeKey === 'personalization'" />

            <!-- 技能：它会做哪些事。搜索、按来源筛、自己的那些就地删 -->
            <ProfileSkills v-else-if="activeKey === 'skills'" />

            <!-- 经验库：做事时踩过又绕过去的坑，两层（通用 / 各工程），自动淘汰 -->
            <ProfileExperience v-else-if="activeKey === 'experience'" />

            <!-- 工具：它手上有哪些工具，按大类折叠开关；工具搜索开关也在这儿 -->
            <ProfileTools v-else-if="activeKey === 'tools'" />

            <!-- 用量：从已有的对话记录里算，不上报、不落第二份账 -->
            <ProfileUsage v-else-if="activeKey === 'usage'" />

            <!-- 模型：服务商与默认模型，内容多，单独一页 -->
            <AIProviderSettings v-else-if="activeKey === 'models'" />

            <!-- 团队：各模型在团队模式里的检测结论和履历，和制作人招人时看的是同一份账 -->
            <ProfileTeam v-else-if="activeKey === 'team'" />
            <McpSettings v-else-if="activeKey === 'mcp'" />
            <ProfileCli v-else-if="activeKey === 'cli'" />
            <AgentV3DebugPanel v-else-if="activeKey === 'agentV3Debug'" />

            <!-- 项目设置 -->
            <ProfileProject v-else-if="activeKey === 'project'" />

            <!-- 插件设置 -->

            <!-- 资产设置 -->
            <ProfileAsset v-else-if="activeKey === 'asset'" />

            <!-- 对象存储：对话里的音视频传上去换链接，模型直接看 -->
            <ProfileObjectStorage v-else-if="activeKey === 'objectStorage'" />

            <!-- 知识库设置 -->
            <ProfileNotebook v-else-if="activeKey === 'notebook'" />

            <!-- 命名规则设置 -->

            <!-- 关于 -->
            <ProfileAbout v-else-if="activeKey === 'about'" />

            <!-- 底部留白 -->
            <div class="bottom-spacer"></div>
          </div>
        </div>
      </main>
    </div>
  </div>
</template>

<style scoped lang="less">
.preferences-page {
  height: 100%;
  overflow: hidden;
}

.preferences-layout {
  display: flex;
  height: 100%;
  max-width: 1240px;
  margin: 0 auto;
  width: 100%;
  gap: var(--space-8);
  padding: var(--space-6);
}

/* 配置主面板 */
.preferences-main {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  position: relative;
}

/* 顶部 Header */
.preferences-header {
  padding: var(--space-6) var(--space-8);
  border-bottom: 1px solid var(--color-border-subtle);
  background: var(--color-bg-surface-hover);
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
}

.header-title {
  margin: 0;
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
  letter-spacing: 0.02em;
}

/* 内容滚动区 */
.preferences-scroll {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-8) var(--space-10);

  /* 自定义滚动条 */
  &::-webkit-scrollbar {
    width: 4px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: var(--color-bg-surface-hover);
    border-radius: 2px;
  }

  &.is-full-view {
    overflow: hidden;
    padding: 0;
  }
}

.preferences-content {
  width: 100%;
  max-width: 768px;
  margin: 0 auto;
  min-height: 500px;

  &.full-width {
    max-width: 100%;
    height: 100%;
    margin: 0;
  }
}

.screen-recorder-wrapper {
  height: 100%;
  padding: 0;
  /* 确保内部组件能撑开 */
  display: flex;
  flex-direction: column;
}

.bottom-spacer {
  height: var(--space-10);
}
</style>
