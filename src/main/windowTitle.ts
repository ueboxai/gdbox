import type { BrowserWindow } from 'electron'

export const MAIN_WINDOW_TITLE = 'GODOT BOX'

export function keepWindowTitleFixed(window: Pick<BrowserWindow, 'on'>): void {
  window.on('page-title-updated', (event) => event.preventDefault())
}
