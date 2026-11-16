import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

/**
 * 智能推荐芯片 Composable
 * 根据用户输入的关键词推荐下一步操作
 */
export function useContextChips() {
  const { t } = useI18n()
  const contextChips = ref<string[]>([])

  /**
   * 基于最近一次用户意图更新上下文建议芯片
   * @param lastUserText 最近用户输入文本
   */
  function updateContextChips(lastUserText: string): void {
    const lowerText = lastUserText.toLowerCase()
    const hit = (keys: string[]): boolean => keys.some((k) => lowerText.includes(k))

    if (hit(['budget', '预算'])) {
      contextChips.value = [
        t('assistant.contextChips.budget.0'),
        t('assistant.contextChips.budget.1'),
        t('assistant.contextChips.budget.2')
      ]
    } else if (hit(['analytics', '分析', 'dashboard', '仪表盘'])) {
      contextChips.value = [
        t('assistant.contextChips.analytics.0'),
        t('assistant.contextChips.analytics.1'),
        t('assistant.contextChips.analytics.2')
      ]
    } else if (hit(['script', '脚本', 'gdscript', '.gd'])) {
      contextChips.value = [
        t('assistant.contextChips.script.0'),
        t('assistant.contextChips.script.1'),
        t('assistant.contextChips.script.2')
      ]
    } else if (hit(['shader', '着色器', 'gdshader'])) {
      contextChips.value = [
        t('assistant.contextChips.shader.0'),
        t('assistant.contextChips.shader.1'),
        t('assistant.contextChips.shader.2')
      ]
    } else if (hit(['particle', '粒子'])) {
      contextChips.value = [
        t('assistant.contextChips.particles.0'),
        t('assistant.contextChips.particles.1'),
        t('assistant.contextChips.particles.2')
      ]
    } else if (hit(['physics', '物理', '碰撞'])) {
      contextChips.value = [
        t('assistant.contextChips.physics.0'),
        t('assistant.contextChips.physics.1'),
        t('assistant.contextChips.physics.2')
      ]
    } else if (hit(['animation', '动画'])) {
      contextChips.value = [
        t('assistant.contextChips.animation.0'),
        t('assistant.contextChips.animation.1'),
        t('assistant.contextChips.animation.2')
      ]
    } else if (hit(['export', '导出', '打包', 'build', '构建', '部署'])) {
      contextChips.value = [
        t('assistant.contextChips.package.0'),
        t('assistant.contextChips.package.1'),
        t('assistant.contextChips.package.2')
      ]
    } else if (hit(['performance', '性能', '优化'])) {
      contextChips.value = [
        t('assistant.contextChips.performance.0'),
        t('assistant.contextChips.performance.1'),
        t('assistant.contextChips.performance.2')
      ]
    } else if (hit(['ai', '状态机', 'pathfinding', '寻路'])) {
      contextChips.value = [
        t('assistant.contextChips.ai.0'),
        t('assistant.contextChips.ai.1'),
        t('assistant.contextChips.ai.2')
      ]
    } else if (hit(['input', '输入', '按键'])) {
      contextChips.value = [
        t('assistant.contextChips.input.0'),
        t('assistant.contextChips.input.1'),
        t('assistant.contextChips.input.2')
      ]
    } else {
      contextChips.value = [
        t('assistant.contextChips.default.0'),
        t('assistant.contextChips.default.1'),
        t('assistant.contextChips.default.2')
      ]
    }
  }

  return {
    contextChips,
    updateContextChips
  }
}
