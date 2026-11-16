/**
 * 新建文件夹快捷键：右键菜单上标的是 Ctrl+Shift+N，按下去就得真的新建。
 */
import { defineComponent, h, nextTick } from 'vue'

import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import { useFileSelection } from './useFileSelection'

function mountSelection(onNewFolder: () => void): { unmount: () => void } {
  return mount(
    defineComponent({
      setup() {
        const selection = useFileSelection()
        selection.setNewFolderCallback(onNewFolder)
        const container = document.createElement('div')
        container.getBoundingClientRect = (() =>
          ({
            width: 800,
            height: 600,
            top: 0,
            bottom: 600
          }) as DOMRect) as HTMLElement['getBoundingClientRect']
        selection.containerRef.value = container
        return () => h('div')
      }
    })
  )
}

function press(init: KeyboardEventInit): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))
}

describe('资产列表的新建文件夹快捷键', () => {
  it('Ctrl+Shift+N 触发新建文件夹', async () => {
    const onNewFolder = vi.fn()
    const wrapper = mountSelection(onNewFolder)
    await nextTick()

    press({ key: 'N', ctrlKey: true, shiftKey: true })

    expect(onNewFolder).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('只按 Ctrl+N 不触发', async () => {
    const onNewFolder = vi.fn()
    const wrapper = mountSelection(onNewFolder)
    await nextTick()

    press({ key: 'n', ctrlKey: true })

    expect(onNewFolder).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
