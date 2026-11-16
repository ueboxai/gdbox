import { describe, expect, it } from 'vitest'
import { checkScene } from './sceneDoctor'
import { describeChanges, diffScenes, parseScene, splitConflict } from './tscn'

const ROOM = `[gd_scene load_steps=3 format=3 uid="uid://abc"]

[ext_resource type="Script" path="res://room.gd" id="1_room"]
[ext_resource type="Texture2D" path="res://wall.png" id="2_wall"]

[sub_resource type="RectangleShape2D" id="Rect_1"]
size = Vector2(16, 16)

[node name="Room" type="Node2D"]
script = ExtResource("1_room")

[node name="Wall" type="Sprite2D" parent="."]
texture = ExtResource("2_wall")
metadata/notes = {
"a": [1, 2],
"b": "x"
}

[node name="Body" type="StaticBody2D" parent="Wall"]

[node name="Shape" type="CollisionShape2D" parent="Wall/Body"]
shape = SubResource("Rect_1")

[connection signal="ready" from="Wall" to="." method="_on_wall_ready"]
`

const exists = (): boolean => true

describe('parseScene', () => {
  it('解析出资源、节点路径、跨行属性、连接', () => {
    const s = parseScene(ROOM)
    expect([...s.extResources.keys()]).toEqual(['1_room', '2_wall'])
    expect([...s.nodes.keys()]).toEqual(['.', 'Wall', 'Wall/Body', 'Wall/Body/Shape'])
    expect(s.nodes.get('Wall')!.props['metadata/notes']).toContain('"b": "x"')
    expect(s.connections).toHaveLength(1)
  })
})

describe('checkScene', () => {
  it('健康的场景没有问题', () => {
    expect(checkScene('res://room.tscn', ROOM, exists)).toEqual([])
  })

  it('合并后悬空的 ExtResource、缺失的父节点、缺失的文件都能查出来', () => {
    const broken = ROOM.replace(
      '[ext_resource type="Texture2D" path="res://wall.png" id="2_wall"]\n',
      ''
    ).replace(
      '[node name="Body" type="StaticBody2D" parent="Wall"]',
      '[node name="Body" type="StaticBody2D" parent="Walls"]'
    )
    const issues = checkScene('res://room.tscn', broken, (p) => p !== 'res://room.gd')
    const text = issues.map((i) => i.message).join('\n')
    expect(text).toContain('ExtResource("2_wall") is used but never declared')
    expect(text).toContain('parent "Walls", which does not exist')
    expect(text).toContain('res://room.gd, which does not exist')
  })

  it('残留冲突标记直接报错', () => {
    const conflicted = ROOM.replace(
      'size = Vector2(16, 16)',
      '<<<<<<< HEAD\nsize = Vector2(16, 16)\n=======\nsize = Vector2(32, 16)\n>>>>>>> laok'
    )
    expect(checkScene('res://room.tscn', conflicted, exists)[0].message).toContain('merge conflict')
  })
})

describe('splitConflict + diffScenes', () => {
  it('把冲突拆成两版，按节点说清楚两边各改了什么', () => {
    const conflicted = ROOM.replace(
      '[node name="Body" type="StaticBody2D" parent="Wall"]',
      '<<<<<<< HEAD\n[node name="Body" type="StaticBody2D" parent="Wall"]\nposition = Vector2(0, 8)\n=======\n[node name="Body" type="StaticBody2D" parent="Wall"]\ncollision_layer = 2\n>>>>>>> feature/laok'
    )
    const sides = splitConflict(conflicted)
    expect(sides.count).toBe(1)
    expect(sides.theirsLabel).toBe('feature/laok')
    const base = parseScene(ROOM)
    expect(describeChanges(diffScenes(base, parseScene(sides.ours)))).toEqual([
      'changed node Wall/Body: position'
    ])
    expect(describeChanges(diffScenes(base, parseScene(sides.theirs)))).toEqual([
      'changed node Wall/Body: collision_layer'
    ])
  })
})
