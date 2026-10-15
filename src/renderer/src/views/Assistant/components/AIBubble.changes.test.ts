import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

import type { ResponseMetadataChange } from '@renderer/store/modules/chatMessages'

vi.mock('@renderer/api/agentV3', () => ({
  agentV3API: {
    reviewChanges: vi.fn(),
    openAsset: vi.fn()
  }
}))

import AIBubble from './AIBubble.vue'

/**
 * 「本轮改动」上的差异信息。
 *
 * 一行只写「写入文件」「打开场景」四个字，用户一样都看不到动的是谁。
 * **行数变少不是目标，行上说得清才是**：清单存在的全部意义
 * 是「让我知道刚才我的工程被改了什么」，一个说不出改了什么的清单等于没有。
 */

function mountBubble(changes: ResponseMetadataChange[]): ReturnType<typeof mount> {
  return mount(AIBubble, {
    props: {
      id: 'msg-1',
      content: '改好了',
      status: 'done' as const,
      responseMetadata: { changes }
    },
    global: {
      stubs: {
        MarkdownRenderer: true,
        AgentProcessLog: true,
        ThinkingProcess: true,
        ChatModelViewer: true,
        AssetList: true,
        MessageSources: true,
        NavigationButton: true,
        'a-button': true,
        'a-dropdown': true,
        'a-menu': true,
        'a-menu-item': true,
        'a-menu-divider': true,
        'a-tooltip': { template: '<div><slot name="title" /><slot /></div>' }
      }
    }
  })
}

function change(over: Partial<ResponseMetadataChange>): ResponseMetadataChange {
  return {
    toolName: 'gen_sprite',
    risk: 'mutating',
    target: 'res://assets/gen/sprites/hero.png',
    reversible: true,
    failed: false,
    ...over
  }
}

async function expandChanges(wrapper: ReturnType<typeof mount>): Promise<void> {
  await wrapper.find('.response-changes-header').trigger('click')
}

describe('AIBubble 本轮改动的差异信息', () => {
  it('默认只展示摘要，用户点击后才展示改动明细', async () => {
    const wrapper = mountBubble([change({})])

    expect(wrapper.find('.response-changes-header').text()).toContain('本轮改动（1）')
    expect(wrapper.find('.response-changes-item').exists()).toBe(false)
    expect(wrapper.find('.response-changes-caret').classes()).toContain('collapsed')

    await expandChanges(wrapper)

    expect(wrapper.find('.response-changes-item').exists()).toBe(true)
    expect(wrapper.find('.response-changes-caret').classes()).not.toContain('collapsed')
  })

  it('生成的资源一行一个，带着类型和「新建」', async () => {
    const wrapper = mountBubble([change({})])
    await expandChanges(wrapper)

    const row = wrapper.find('.response-changes-item')
    expect(row.text()).toContain('图片')
    expect(row.text()).toContain('hero.png')
    expect(row.text()).toContain('新建')
  })

  it('res:// 资源给「在编辑器中打开」，素材库资产不给 —— 编辑器里没有它', async () => {
    const wrapper = mountBubble([
      change({}),
      change({ toolName: 'annotate_asset', target: 'hero_concept' })
    ])
    await expandChanges(wrapper)

    const rows = wrapper.findAll('.response-changes-item')
    expect(rows).toHaveLength(2)
    expect(rows[0].find('.response-changes-open').exists()).toBe(true)
    expect(rows[1].find('.response-changes-open').exists()).toBe(false)
  })

  it('一行只做了一件事才把差异摆到行上', async () => {
    const wrapper = mountBubble([
      change({ toolName: 'art_style', target: '', detail: 'pixel_16' }),
      change({ toolName: 'art_style', target: '', detail: 'pixel_16' })
    ])
    await expandChanges(wrapper)

    expect(wrapper.findAll('.response-changes-item')).toHaveLength(1)
    expect(wrapper.find('.response-changes-item').find('.response-changes-cmd').exists()).toBe(
      false
    )
  })

  it('套用的风格预设摆在行上', async () => {
    const wrapper = mountBubble([change({ toolName: 'art_style', target: '', detail: 'pixel_16' })])
    await expandChanges(wrapper)

    expect(wrapper.find('.response-changes-item').find('.response-changes-cmd').text()).toBe(
      'pixel_16'
    )
  })

  /**
   * 本地命令行不上面板（见 `changeSummary.ts` 的 `PANEL_HIDDEN_TOOLS`）。
   *
   * 真机上一轮五条 `where ffmpeg` / `ls -l` 探路命令，就是五行顶着「不可回滚」
   * 红标的黑盒 —— 用户什么都没改，面板却像出了大事。命令仍在台账里（「用量」页
   * 照常统计），也仍在过程日志和每一次的审批弹窗里。
   */
  it('只跑了本地命令行的那一轮，整个面板不出现', () => {
    const wrapper = mountBubble([
      change({ toolName: 'run_shell_command', risk: 'destructive', target: '', reversible: false })
    ])

    expect(wrapper.find('.response-changes').exists()).toBe(false)
  })

  it('本地命令行不占行，同一轮里真的改了的东西照常显示', async () => {
    const wrapper = mountBubble([
      change({ toolName: 'run_shell_command', risk: 'destructive', target: '', reversible: false }),
      change({})
    ])

    expect(wrapper.find('.response-changes-header').text()).toContain('本轮改动（1）')

    await expandChanges(wrapper)

    const rows = wrapper.findAll('.response-changes-item')
    expect(rows).toHaveLength(1)
    expect(rows[0].text()).toContain('hero.png')
  })

  it('编辑器里的操作单独成区：做了什么、对哪个场景，都在行上', async () => {
    const wrapper = mountBubble([
      change({}),
      change({ toolName: 'editor_open_scene', target: '', detail: 'res://main.tscn' })
    ])
    await expandChanges(wrapper)

    const rows = wrapper.findAll('.response-changes-item')
    expect(rows).toHaveLength(2)
    expect(rows[1].find('.response-changes-name').text()).toBe('打开场景')
    expect(rows[1].find('.response-changes-cmd').text()).toBe('res://main.tscn')
  })

  it('全是磁盘文件时标题说「N 个文件已更改」', () => {
    const wrapper = mountBubble([
      change({ toolName: 'edit_local_file', target: 'D:/game/player.gd' })
    ])

    expect(wrapper.find('.response-changes-header').text()).toContain('1 个文件已更改')
  })
})
