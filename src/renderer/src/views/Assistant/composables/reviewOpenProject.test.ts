import { describe, expect, it } from 'vitest'

import { findSessionProjectFile, isSessionProjectConnected } from './reviewOpenProject'

const rows = [
  {
    projectName: 'Shooter',
    projectPath: 'D:/Godot/Shooter',
    originPath: 'D:/Godot/Shooter/project.godot'
  },
  { projectName: 'Racer', projectPath: null, originPath: 'E:\\Games\\Racer\\project.godot' },
  { projectName: 'NoFile', projectPath: 'F:/NoFile', originPath: null }
]

describe('findSessionProjectFile', () => {
  it('按目录找，大小写和斜杠方向不敏感', () => {
    expect(findSessionProjectFile({ projectName: 'X', projectPath: 'e:/games/racer/' }, rows)).toBe(
      'E:\\Games\\Racer\\project.godot'
    )
  })

  it('没有路径的老会话按名字找', () => {
    expect(findSessionProjectFile({ projectName: 'Shooter' }, rows)).toBe(
      'D:/Godot/Shooter/project.godot'
    )
  })

  it('没绑工程、或库里没有 project.godot 时不知道开哪个', () => {
    expect(findSessionProjectFile(null, rows)).toBeNull()
    expect(
      findSessionProjectFile({ projectName: 'NoFile', projectPath: 'F:/NoFile' }, rows)
    ).toBeNull()
  })
})

describe('isSessionProjectConnected', () => {
  const connected = [
    { projectName: 'Shooter', projectPath: 'D:\\Godot\\Shooter', isConnected: true }
  ]

  it('同一个工程目录算连着', () => {
    expect(
      isSessionProjectConnected(
        { projectName: 'Shooter', projectPath: 'D:/Godot/Shooter' },
        connected
      )
    ).toBe(true)
  })

  it('别的工程连着不算', () => {
    expect(
      isSessionProjectConnected({ projectName: 'Racer', projectPath: 'E:/Games/Racer' }, connected)
    ).toBe(false)
  })
})
