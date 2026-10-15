---
name: godot-2d-character
description: Builds a playable 2D character in a Godot 4 project end to end - animated sprite frames generated with gen_sprite, a CharacterBody2D scene with CollisionShape2D and AnimatedSprite2D written as .tscn text, InputMap actions in project.godot, a typed GDScript movement and jump script using move_and_slide, and proof with godot_run that it really moves and jumps. Use when the user asks for 做个能跑能跳的主角、加个玩家角色、平台跳跃角色、俯视角角色移动、角色动不了/跳不起来/穿地板, or wants an existing character's movement fixed or its feel tuned. Do not use for 3D characters, for level tiles (godot-tilemap-level), for enemy AI design, or for only generating a picture of a character (image-generation).
---

# 2D 可玩角色（Godot 4）

一个能玩的角色是四样东西拼起来的：**画面**（SpriteFrames）、**身体**（CharacterBody2D +
碰撞形状）、**输入**（InputMap 动作）、**逻辑**（脚本）。任何一样缺了或对不上，
表现都是「角色不动」，而且不报错。所以按下面的顺序一样一样落，最后用数字验证。

## Quick Start

```
art_style(action: "show")            看工程有没有定画风；没有先走 godot-art-style
gen_sprite(...)                      → res://assets/gen/sprites/hero.tres + 预览图
project.godot                        补 [input] 动作；像素风补最近邻过滤
res://player/player.gd               移动 + 跳跃
res://player/player.tscn             CharacterBody2D / AnimatedSprite2D / CollisionShape2D
放进关卡 → godot_check → godot_run → godot_screenshot
```

## Workflow

### 1. 出精灵

先 `art_style` 的 `show` 看一眼。没定画风就直接出，后面的道具、瓦片和它对不上 ——
先去 `godot-art-style` 定好再回来。

```
gen_sprite(
  project_path: "D:/Games/MyGame",
  name: "hero",
  description: "small knight in blue armor, round helmet, red plume",
  animations: [{ name: "idle", frames: 4, fps: 6 },
               { name: "run",  frames: 6, fps: 12 },
               { name: "jump", frames: 2, fps: 8, loop: false }]
)
```

- `project_path` 是工程根目录的**绝对路径**（含 `project.godot` 那层）。
- 动画名就是脚本里要播的名字，先定好，脚本里一字不差地用。
- **看返回的预览图**：每一帧是不是同一个角色、朝向一致、动作连贯。返回里带「注意」时
  （帧数对不上、切歪了）把问题和选项用 `ask_user` 交给用户 —— 每次生成都花用户的钱，
  不自己决定重出。
- 记下返回的**帧尺寸**（如 32x32），第 3 步要用。
- 用户要流畅的多帧动作（十几二十帧、复杂动作、手绘/高清风）时，这一步换成
  `video-sprite-animation`（`gen_sprite_video` 从 AI 视频抽帧），出完回到第 2 步。

### 2. 输入和工程设置

读一遍 `project.godot`，在 `[input]` 段**追加**缺的动作，已有的不动。一个动作的写法：

```
[input]

move_left={
"deadzone": 0.5,
"events": [Object(InputEventKey,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"pressed":false,"keycode":0,"physical_keycode":65,"key_label":0,"unicode":0,"location":0,"echo":false,"script":null)
]
}
```

一个动作可以挂多个按键，`events` 里逗号分隔多个 `Object(...)`。常用 `physical_keycode`：
A=65、D=68、W=87、S=83、空格=32、←=4194319、↑=4194320、→=4194321、↓=4194322。
默认方案：move_left（A、←）、move_right（D、→）、jump（空格、W、↑）；
俯视角再加 move_up、move_down。

像素风工程（`gen_sprite` 的返回里会提示）在 `[rendering]` 段加
`textures/canvas_textures/default_texture_filter=0`，否则放大后是糊的。

编辑器开着时改了 `project.godot`，告诉用户在 Godot 里「项目 → 重新加载当前项目」——
否则他下次改项目设置时，编辑器会把内存里的旧版本写回去，你加的动作就没了。

### 3. 脚本

平台跳跃的默认写法见 [references/platformer-script.md](references/platformer-script.md)：
带类型标注、`move_and_slide()`、`is_on_floor()`，以及让手感不「吞键」的两样 ——
土狼时间和跳跃缓冲、松开跳跃键截短跳跃。俯视角的写法在同一个文件后半。

**先定手感再写数**：跳多高（几格瓦片）、多久落地，再用公式反算起跳速度。
数是推出来的，验证时才有东西可对。

### 4. 场景

写 `res://player/player.tscn`（脚本和场景放在同一个文件夹），根节点就是 CharacterBody2D，原点放在**脚底**：

```
[gd_scene format=3]

[ext_resource type="Script" path="res://player/player.gd" id="1_script"]
[ext_resource type="SpriteFrames" path="res://assets/gen/sprites/hero.tres" id="2_frames"]

[sub_resource type="RectangleShape2D" id="body"]
size = Vector2(14, 28)

[node name="Player" type="CharacterBody2D"]
script = ExtResource("1_script")

[node name="Sprite" type="AnimatedSprite2D" parent="."]
position = Vector2(0, -16)
sprite_frames = ExtResource("2_frames")
animation = &"idle"
autoplay = "idle"

[node name="Shape" type="CollisionShape2D" parent="."]
position = Vector2(0, -14)
shape = SubResource("body")
```

- `gen_sprite` 出的帧按脚底对齐，所以 Sprite 往上挪**半个帧高**（32 高的帧就是 -16），
  脚就落在节点原点上。
- 碰撞盒比画面窄一些（约帧宽的一半）、略矮于帧高，同样往上挪半个盒高。盒子比画面宽，
  角色会「悬」在平台边缘外面。
- `ext_resource` 只写 `path`，不写 uid。
- 把它实例化进关卡：关卡 `.tscn` 里加一条 PackedScene 的 `ext_resource`，再加
  `[node name="Player" parent="." instance=ExtResource("…")]` 和 `position`。
  关卡里得有能站的地面（TileMapLayer 或 StaticBody2D），否则角色一直往下掉。
- 碰撞层：CharacterBody2D 默认在第 1 层、检测第 1 层；`gen_tileset` 出的瓦片也在第 1 层，
  默认就能站住。改过任一边的层/遮罩，两边要对得上。

### 5. 验证

照 `godot-verify-changes` 走，这里给出这个角色该对的数：

```
godot_check()
godot_run(seconds: 3,
  inputs: [{ action: "move_right", at: 0.5, hold: 1.0 }, { action: "jump", at: 2.0, hold: 0.3 }],
  watch: ["Player:velocity", "Player:position"], sample_interval: 0.05)
godot_screenshot()
```

- 开局几帧内 `velocity.y` 归零、`position.y` 稳定 → 站在地上了（一直增大就是掉出了世界）；
- 0.5–1.5 秒 `velocity.x` 等于 SPEED，之后归零；
- 2.0 秒 `velocity.y` 等于 JUMP_VELOCITY，最高点比起跳点高出预期的像素数，之后回到原高度；
- 截图里角色站在地面上、脚不陷进地里、不悬空、大小和关卡相称。

手感（加速度、跳跃高度合不合适）只能用户说了算：`editor_play` 让他试，告诉他试什么。

## Constraints

- Godot 4 写法：CharacterBody2D（不是 3.x 的 KinematicBody2D），`velocity` 是节点自带属性，
  `move_and_slide()` 不带参数。网上 3.x 的答案照抄会报错。
- 脚本里取节点用 `@onready var sprite: AnimatedSprite2D = $Sprite`，节点名改了这里要跟着改。
- 不在 `_ready()` 里用代码搭整个角色或关卡：用户在编辑器里看不到、改不了。场景写成 `.tscn`。
- 不手改 `.godot/`，不编 uid。

## Failure Handling

| 现象 | 多半是 |
| --- | --- |
| 角色一直往下掉 | 地面没有碰撞；或碰撞层/遮罩对不上；或角色起始位置在地面以下 |
| 按键没反应 | 动作名和 `[input]` 里的不一致；脚本没挂到根节点上 |
| 跳不起来 | 起跳判断用了 `is_on_floor()` 但地面不是 StaticBody/TileMapLayer；或 JUMP_VELOCITY 写成了正数 |
| 动画不切换 | 播的动画名和 SpriteFrames 里的不一致（区分大小写） |
| 画面糊 | 没设最近邻过滤 |
| 贴着墙往上「爬」 | 碰撞盒带圆角或比画面宽；换成 RectangleShape2D 并收窄 |

## Escalation

- 用户要的是成套的角色动作（攻击、受伤、死亡、爬梯）：每样动作都是一次 `gen_sprite`
  的动画，先列出清单和次数让用户确认再生成 —— 都花钱。嫌帧少、动作僵，换
  `video-sprite-animation`（贵得多，先说清价钱）。
- 用户要换成已有的美术资源：跳过第 1 步，用 `list_local_dir` 看清精灵表的帧布局，
  SpriteFrames 交给用户在编辑器里切，或在 `.tres` 里用 AtlasTexture 按格写。
