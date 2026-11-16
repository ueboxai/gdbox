/**
 * Ctrl+点击加选。
 *
 * 红灯用例：选中 A 后 Ctrl+点 C，只剩 C。框选在 mousedown 就启动，`start` 里只有 Shift
 * 会保留原选择，于是 Ctrl+mousedown 先把 A 清掉，随后的 click 再把 C 切换进来。
 */
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { useFileSelection } from './useFileSelection'

function setup(): {
  selection: ReturnType<typeof useFileSelection>
  container: HTMLElement
  card: (id: string) => HTMLElement
  unmount: () => void
} {
  const ids = ['A', 'B', 'C']
  let selection!: ReturnType<typeof useFileSelection>
  const container = document.createElement('div')
  container.getBoundingClientRect = () =>
    ({ top: 0, bottom: 600, width: 800, height: 600 }) as DOMRect
  document.body.append(container)
  const cards = new Map<string, HTMLElement>()
  ids.forEach((id, index) => {
    const el = document.createElement('div')
    el.className = 'file-item asset-item'
    el.dataset.fileId = id
    const left = 20 + index * 100
    el.getBoundingClientRect = () =>
      ({ left, right: left + 60, top: 20, bottom: 80, width: 60, height: 60 }) as DOMRect
    container.append(el)
    cards.set(id, el)
  })
  const wrapper = mount(
    defineComponent({
      setup() {
        selection = useFileSelection({
          getItems: () => ids.map((id) => ({ id, type: 'file' as const }))
        })
        selection.containerRef.value = container
        return () => h('div')
      }
    })
  )
  return {
    selection,
    container,
    card: (id) => cards.get(id)!,
    unmount: () => {
      wrapper.unmount()
      container.remove()
    }
  }
}

/** 按真实顺序在卡片上点一下：mousedown → mouseup → click */
function clickCard(
  selection: ReturnType<typeof useFileSelection>,
  card: HTMLElement,
  init: MouseEventInit = {}
): void {
  card.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, ...init }))
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, ...init }))
  selection.handleItemClick(card.dataset.fileId!, new MouseEvent('click', init))
}

describe('Ctrl+点击加选', () => {
  it('选中 A 后 Ctrl+点 C，A 和 C 都在', async () => {
    const { selection, container, card, unmount } = setup()
    await selection.initDragSelect(container)
    clickCard(selection, card('A'))
    clickCard(selection, card('C'), { ctrlKey: true })
    expect(selection.getSelectedIds()).toEqual(['A', 'C'])
    unmount()
  })

  it('Ctrl+点已选中的项只取消这一项', async () => {
    const { selection, container, card, unmount } = setup()
    await selection.initDragSelect(container)
    clickCard(selection, card('A'))
    clickCard(selection, card('C'), { ctrlKey: true })
    clickCard(selection, card('A'), { ctrlKey: true })
    expect(selection.getSelectedIds()).toEqual(['C'])
    unmount()
  })

  it('Cmd+点同样加选', async () => {
    const { selection, container, card, unmount } = setup()
    await selection.initDragSelect(container)
    clickCard(selection, card('A'))
    clickCard(selection, card('B'), { metaKey: true })
    expect(selection.getSelectedIds()).toEqual(['A', 'B'])
    unmount()
  })

  it('普通点击未选中的卡片仍是单选', async () => {
    const { selection, container, card, unmount } = setup()
    await selection.initDragSelect(container)
    clickCard(selection, card('A'))
    clickCard(selection, card('B'))
    expect(selection.getSelectedIds()).toEqual(['B'])
    unmount()
  })

  it('按住 Ctrl 从空白处框选，结果累加到原选择上', async () => {
    const { selection, container, card, unmount } = setup()
    await selection.initDragSelect(container)
    clickCard(selection, card('C'))
    container.dispatchEvent(
      new MouseEvent('mousedown', { button: 0, clientX: 0, clientY: 0, ctrlKey: true })
    )
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 90, clientY: 100 }))
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: 90, clientY: 100 }))
    expect(selection.getSelectedIds()).toEqual(['C', 'A'])
    unmount()
  })
})
