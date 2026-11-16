import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { errorsInLog, isGameRunning, playGame } from './playGame'

describe('运行游戏', () => {
  it('从日志里挑出报错，连同下一行的位置', () => {
    const log = [
      'Godot Engine v4.7.1.stable',
      'SCRIPT ERROR: Invalid access to property or key "speed" on a base object of type "Nil".',
      '          at: _process (res://scripts/player.gd:12)',
      'some output',
      'ERROR: Failed loading resource: res://assets/bomb.png.',
      'done'
    ].join('\n')
    expect(errorsInLog(log)).toEqual([
      'SCRIPT ERROR: Invalid access to property or key "speed" on a base object of type "Nil". (at: _process (res://scripts/player.gd:12))',
      'ERROR: Failed loading resource: res://assets/bomb.png.'
    ])
  })

  it('不是 Godot 工程就不启动', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gdbox-play-'))
    try {
      await expect(playGame('godot', dir)).rejects.toThrow('project.godot')
      expect(isGameRunning(dir)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
