/**
 * 扫描器怎么给一个条目归类：目录是结构（往里走），文件是内容。
 */
import { describe, expect, it } from 'vitest'
import { classifyScanEntry } from './fsHandlers'

describe('classifyScanEntry', () => {
  it('普通文件就是文件', () => {
    expect(classifyScanEntry('rock_basecolor.png', false)).toEqual({ type: 'file' })
  })

  it('普通目录就是目录 —— 它是结构，扫描器要往里走', () => {
    expect(classifyScanEntry('Textures', true)).toEqual({ type: 'folder' })
  })

  // GDBox 没有 .ueblueprint / .uematerial 这类「包目录」：带这种扩展名的目录也只是普通目录
  it('曾经的包目录扩展名不再特殊对待，目录照样是结构', () => {
    expect(classifyScanEntry('跳跃逻辑.ueblueprint', true)).toEqual({ type: 'folder' })
    expect(classifyScanEntry('苔藓石头.UEMaterial', true)).toEqual({ type: 'folder' })
  })

  it('名字像包但其实是文件的，仍然是文件 —— 别被压缩包之类的骗了', () => {
    expect(classifyScanEntry('跳跃逻辑.ueblueprint', false)).toEqual({ type: 'file' })
  })

  it('只是名字里带扩展名、后面还有东西的不算包', () => {
    expect(classifyScanEntry('跳跃逻辑.ueblueprint.bak', true)).toEqual({ type: 'folder' })
  })
})
