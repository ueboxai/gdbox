import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '', getPath: () => '' } }))

import { runInputSchema } from '../../core/regression/inputSchema'
import { summarizeWatch } from './runtime'

describe('godot_run 的输入和取值表', () => {
  it('每条输入只能是动作、按键、点击、拖拽中的一种', () => {
    const ok = (v: unknown): boolean => runInputSchema.safeParse(v).success
    expect(ok({ action: 'jump', at: 0 })).toBe(true)
    expect(ok({ key: 'Space', at: 0 })).toBe(true)
    expect(ok({ click: [100, 200], at: 0.5, button: 'right' })).toBe(true)
    expect(ok({ click: 'UI/StartButton', at: 0.5 })).toBe(true)
    expect(ok({ drag: { from: 'Card', to: [300, 40] }, at: 1, hold: 0.5 })).toBe(true)
    expect(ok({ at: 0 })).toBe(false)
    expect(ok({ action: 'jump', key: 'Space', at: 0 })).toBe(false)
    expect(ok({ click: [1, 2, 3], at: 0 })).toBe(false)
  })

  it('第一次采样没有的列（changed）也进表，缺的格子写 -', () => {
    const w = (t: number, v: Record<string, string>): string =>
      `GDBOX_WATCH ${JSON.stringify({ t, v })}`
    expect(
      summarizeWatch([w(0, { n: '3' }), w(0.1, { n: '3', 'changed(@a:position)': '0.5' })])
    ).toBe('time | n | changed(@a:position)\n0.00s | 3 | -\n0.10s | 3 | 0.5')
  })
})
