import { describe, expect, it } from 'vitest'

import { errorFingerprint, isEnvironmentalError, normalizeError } from './errorSignature'

// 样本照真实报错的形状写，路径和名字换成了虚构的
describe('isEnvironmentalError', () => {
  it.each([
    'godot_editor_get_tree 失败：请求超时: scene.tree (2c2de2a1-43fb-4a8e-a267-c0791bba6039)',
    'Godot 编辑器未连接：现在没有编辑器连到盒子。',
    '没有找到 Godot 4。请用户在「偏好设置 → 通用」里指定 Godot 编辑器的位置，然后再试。',
    '不知道要操作哪个工程：这条对话还没有归属工程，参数里也没给 project_path。',
    'H:/G 下没有 project.godot，不是 Godot 工程。',
    'The run did not exit in time and was stopped (possible infinite loop or blocking dialog).',
    'Godot exited abnormally during run (exit code 3221225477). This can be a crash; run godot_check again to confirm before concluding.',
    'Operation aborted',
    'Validation failed for tool "godot_check": - frames: must be integer',
    'Tool godot_check not found',
    'net::ERR_CONNECTION_CLOSED',
    '生图接口报错 HTTP 403：user quota is not enough'
  ])('环境噪声不学：%s', (text) => {
    expect(isEnvironmentalError(text)).toBe(true)
  })

  it.each([
    'SCRIPT ERROR: Parse Error: Could not find type "KinematicBody2D" in the current scope.',
    // Timer 的信号就叫 timeout：连错它是脚本的事，不是超时
    'SCRIPT ERROR: Invalid argument for "connect()" function: signal "timeout" is not connected',
    "godot_editor_set_property 失败：节点 'Player/Sprite' 上没有属性 'flip_hh'"
  ])('真知识要学：%s', (text) => {
    expect(isEnvironmentalError(text)).toBe(false)
  })
})

describe('normalizeError', () => {
  it('多条报错只留脚本报错那条；位置行、连带的加载失败都不要', () => {
    const text =
      'ERROR: Failed to load script "res://player.gd" with error "Parse error".\n   at: load (modules/gdscript/gdscript.cpp:2936)\n\n' +
      'SCRIPT ERROR: Parse Error: Too many arguments for "move_and_slide()" call. Expected at most 0 but received 1.\n' +
      '          at: GDScript::reload (res://player.gd:23)'
    expect(normalizeError(text)).toBe(
      'parse error: too many arguments for "move_and_slide()" call. expected at most <n> but received <n>.'
    )
  })

  it('抹掉 GUID、工程内路径、磁盘路径和独立的数字；类名里的数字留着', () => {
    const a = normalizeError(
      'godot_editor_delete_node 失败：node 2CF6CAFA-4184-0E09-681C-48914BE09998 not found in res://levels/a.tscn'
    )
    const b = normalizeError(
      'godot_editor_delete_node 失败：node 11111111-2222-3333-4444-555555555555 not found in res://levels/b.tscn'
    )
    expect(a).toBe(b)
    expect(a).toBe('node <id> not found in <path>')
    expect(normalizeError('writing I:/Proj/export/x.cfg failed at line 42')).toBe(
      'writing <path> failed at line <n>'
    )
    expect(normalizeError("Invalid get index 'x' (on base: 'Vector3')")).toBe(
      "invalid get index 'x' (on base: 'vector3')"
    )
  })

  it('指纹只取开头一段，批量报错顺序变了也认得出是同一类', () => {
    const fp = errorFingerprint(
      `godot_editor_save 失败：File is read-only on disk ${'x'.repeat(300)}`
    )
    expect(fp.length).toBeLessThanOrEqual(120)
    expect(fp.startsWith('file is read-only on disk')).toBe(true)
  })
})
