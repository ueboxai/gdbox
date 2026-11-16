/**
 * 当前打开着的 AppModal，按打开先后排，最后一个在最上面。
 *
 * 只给 AppModal 判断「焦点丢到 body 时由谁接 Esc」用：叠着两个弹窗时只关上面那个。
 */
export const openModalStack: number[] = []

let nextId = 0
export function nextModalId(): number {
  nextId += 1
  return nextId
}
