import { describe, expect, it } from 'vitest'

import { godotProbeOrder } from './probeOrder'

describe('godotProbeOrder', () => {
  it('选中带 console 的 exe 时先试同目录的正常版', () => {
    expect(godotProbeOrder('D:/Godot/Godot_v4.5-stable_win64_console.exe', false, [])).toEqual([
      'D:/Godot/Godot_v4.5-stable_win64.exe',
      'D:/Godot/Godot_v4.5-stable_win64_console.exe'
    ])
  })

  it('选中正常版就只试它', () => {
    expect(godotProbeOrder('D:/Godot/Godot_v4.5-stable_win64.exe', false, [])).toEqual([
      'D:/Godot/Godot_v4.5-stable_win64.exe'
    ])
  })

  it('选中文件夹时正常版排在 console 版前面', () => {
    expect(
      godotProbeOrder('D:/Godot', true, [
        'D:/Godot/Godot_v4.5-stable_win64_console.exe',
        'D:/Godot/Godot_v4.5-stable_win64.exe'
      ])
    ).toEqual([
      'D:/Godot/Godot_v4.5-stable_win64.exe',
      'D:/Godot/Godot_v4.5-stable_win64_console.exe'
    ])
  })
})
