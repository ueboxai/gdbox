/** @vitest-environment node */
import { describe, expect, it } from 'vitest'

import { PUBLIC_RESULT_TOOLS, toStructuredContent } from './publicResult'

/**
 * 这一层的价值全在「缺失」和「确认为空」分得开：没拿到报错清单补成空数组之后，
 * 调用方会把「这次没查成」当成「查过了、没问题」继续往下做。
 */
describe('toStructuredContent', () => {
  it('没有 serializer 的工具不返回结构化结果', () => {
    expect(toStructuredContent('run_shell_command', { anything: 1 })).toBeUndefined()
  })

  it('details 不是对象时不返回结构化结果', () => {
    expect(toStructuredContent('godot_check', undefined)).toBeUndefined()
    expect(toStructuredContent('godot_check', '一段文本')).toBeUndefined()
    expect(toStructuredContent('godot_check', [1, 2])).toBeUndefined()
  })

  /** 有 serializer 的工具是一份对外接口清单，加一个就是多一份要长期维持形状的承诺 */
  it('对外接口清单钉死', () => {
    expect([...PUBLIC_RESULT_TOOLS].sort()).toEqual([
      'editor_scene_tree',
      'godot_check',
      'godot_run',
      'godot_screenshot'
    ])
  })

  it('检查结果带报错清单和计数', () => {
    expect(
      toStructuredContent('godot_check', {
        errors: ['res://player.gd:3 - Parse Error'],
        warnings: [],
        timedOut: false
      })
    ).toEqual({
      errors: ['res://player.gd:3 - Parse Error'],
      errorCount: 1,
      warnings: [],
      warningCount: 0,
      timedOut: false
    })
  })

  it('没拿到报错清单时给 null，不补成空数组', () => {
    expect(toStructuredContent('godot_run', {})).toEqual({
      errors: null,
      errorCount: null,
      warnings: null,
      warningCount: null,
      timedOut: null
    })
  })

  it('截图给出存盘路径', () => {
    expect(toStructuredContent('godot_screenshot', { path: 'C:/shots/1.png' })).toEqual({
      path: 'C:/shots/1.png'
    })
  })

  it('场景树：没有打开场景时 tree 是 null', () => {
    expect(toStructuredContent('editor_scene_tree', { scene: '', tree: null })).toEqual({
      scene: '',
      tree: null
    })
  })
})
