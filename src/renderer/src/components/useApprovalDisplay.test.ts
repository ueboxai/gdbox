/**
 * 审批卡要让人看懂自己在批什么。
 *
 * 红灯用例：模型要删一批资产，卡片上写的是
 *
 *     操作类型：其他操作
 *     即将执行不可撤销的操作：delete_assets
 *
 * 「操作类型」那一行恒为「其他操作」（非上网的全归 other），一个字的信息量都没有；
 * 而第二行里用户唯一需要判断的那部分（到底要删什么）恰好是他读不懂的那部分。
 * 于是每次弹框他只能盲批 —— 而这个框存在的全部意义就是让他不盲批。
 *
 * 工具名 → 人话那张表（`assistant.changes.tools.*`）「本轮改动」那一栏早就在用，
 * 审批卡没用上纯粹是漏了。
 */
import { setActivePinia, createPinia } from 'pinia'
import { describe, expect, it, beforeEach } from 'vitest'
import { createApp, h } from 'vue'
import { createI18n } from 'vue-i18n'

import zhCN from '@renderer/i18n/locales/zh-CN'
import { usePendingApprovalsStore } from '@renderer/store/modules/pendingApprovals'

import { useApprovalDisplay } from './useApprovalDisplay'

/**
 * `useApprovalDisplay` 里用的是 `useI18n()`（要组件上下文），这里直接拿真语言包
 * 装一个全局实例喂给它 —— 用假 t 的话，「文案到底配没配」这件事就测不出来了，
 * 而那正是这条用例要守的东西。
 */
const i18n = createI18n({ legacy: false, locale: 'zh-CN', messages: { 'zh-CN': zhCN } })

function enqueue(
  partial: Partial<Parameters<ReturnType<typeof usePendingApprovalsStore>['enqueue']>[0]>
): void {
  usePendingApprovalsStore().enqueue({
    sessionId: 's1',
    toolCallId: 'tc1',
    toolName: 'delete_assets',
    namespace: 'assets',
    risk: 'destructive',
    args: { assetKeys: ['old'] },
    allowAlways: true,
    ...partial
  })
}

/**
 * 在一个最小组件里调一次 composable。
 *
 * `useI18n()` 要求当前有 app 实例，所以绕不开挂载；但返回的 computed 挂在
 * store 上，卸载后照样能读 —— 队列本来就活在 Pinia 里（见 `pendingApprovals` 的文件头）。
 */
function display(): ReturnType<typeof useApprovalDisplay> {
  let result!: ReturnType<typeof useApprovalDisplay>
  const app = createApp({
    setup() {
      result = useApprovalDisplay()
      return () => h('div')
    }
  })
  app.use(i18n)
  app.mount(document.createElement('div'))
  app.unmount()
  return result
}

describe('useApprovalDisplay', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('工具名翻成人话 —— 用户批的是「删除素材库资产」，不是 delete_assets', () => {
    enqueue({})
    const { current } = display()

    expect(current.value?.description).toContain('删除素材库资产')
    expect(current.value?.description).not.toContain('delete_assets')
  })

  it('「操作类型」那一行说的是危险程度，不是恒定的「其他操作」', () => {
    enqueue({ risk: 'destructive' })
    expect(display().current.value?.typeLabel).toBe('不可撤销')
  })

  it('会改动但能撤销的，和不可撤销的要分得开', () => {
    enqueue({ toolName: 'move_assets', risk: 'mutating' })
    const current = display().current

    expect(current.value?.typeLabel).toBe('会改动工程')
    expect(current.value?.description).toContain('移动素材库资产')
  })

  /*
   * MCP 工具名是全仓最难读的一批（`mcp_godot_call_tool`），而表里永远不会有
   * 它们的 key —— server 名是用户自己配的。不归一的话，审批卡正文就是
   * 「即将执行写入操作：mcp_godot_call_tool」，正是这张卡片要消灭的句子。
   * 「本轮改动」那一栏早就这么干了（`AIBubble.changeLabel` 第一句）。
   */
  it('MCP 工具归一成「通过 MCP 工具操作」，不露原始工具名', () => {
    enqueue({ toolName: 'mcp_godot_call_tool', risk: 'mutating' })
    const description = display().current.value?.description ?? ''

    expect(description).toContain('通过 MCP 工具操作')
    expect(description).not.toContain('mcp_godot_call_tool')
  })

  it('没配文案的新工具退回工具名，而不是显示 undefined', () => {
    enqueue({ toolName: 'brand_new_thing', risk: 'mutating' })
    const description = display().current.value?.description ?? ''

    expect(description).toContain('brand_new_thing')
    expect(description).not.toContain('undefined')
  })

  it('上网那一类仍然走自己那套说法：参数本身就是风险', () => {
    enqueue({
      toolName: 'browser_interact',
      namespace: 'browser',
      risk: 'mutating',
      args: { action: 'click', label: '提交订单' },
      allowAlways: false
    })
    const current = display().current

    expect(current.value?.typeLabel).toBe('访问网页')
    expect(current.value?.description).toContain('提交订单')
    // 批准一次不能代表批准下一次
    expect(current.value?.allowAlways).toBe(false)
  })

  it('参数原样带出去 —— 看不到参数就是在盲批', () => {
    enqueue({ args: { paths: ['/Game/Old'] } })
    expect(display().current.value?.details).toEqual({ paths: ['/Game/Old'] })
  })
})
