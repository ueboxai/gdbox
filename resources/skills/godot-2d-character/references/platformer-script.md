# 角色移动脚本（Godot 4 GDScript）

## 目录

- 先定手感，再算数
- 平台跳跃：res://player/player.gd
- 俯视角：res://player/player_topdown.gd
- 常见改法

## 先定手感，再算数

起跳速度不要拍脑袋。先定「跳多高」「速度多快」，用公式反算：

- 跳跃高度 h（像素）= 起跳速度² ÷ (2 × 重力)，所以 起跳速度 = −√(2 × 重力 × h)
- 工程默认重力是 980 像素/秒²（`physics/2d/default_gravity`）
- 例：瓦片 16px，想跳 4 格高 → h = 64 → 起跳速度 ≈ −354

Godot 的 2D 坐标 y 轴向下，所以**向上的速度是负数**。

验证时对的就是这些数：`godot_run` 里起跳那一刻 `velocity.y` 应等于起跳速度，
最高点比起跳点高出约 h 像素。

## 平台跳跃：res://player/player.gd

```gdscript
extends CharacterBody2D

## 水平移动速度（像素/秒）
@export var speed: float = 140.0
## 起跳速度，负数向上。由跳跃高度反算，见文件头
@export var jump_velocity: float = -354.0
## 离开平台边缘后仍可起跳的时间（秒）
@export var coyote_time: float = 0.1
## 落地前提前按跳，落地瞬间仍会起跳（秒）
@export var jump_buffer_time: float = 0.12

var gravity: float = ProjectSettings.get_setting("physics/2d/default_gravity")
var _coyote_left: float = 0.0
var _buffer_left: float = 0.0

@onready var sprite: AnimatedSprite2D = $Sprite


func _physics_process(delta: float) -> void:
	if is_on_floor():
		_coyote_left = coyote_time
	else:
		velocity.y += gravity * delta
		_coyote_left -= delta

	if Input.is_action_just_pressed("jump"):
		_buffer_left = jump_buffer_time
	else:
		_buffer_left -= delta

	if _buffer_left > 0.0 and _coyote_left > 0.0:
		velocity.y = jump_velocity
		_buffer_left = 0.0
		_coyote_left = 0.0

	# 松开跳跃键时截短上升：轻点小跳，按住大跳
	if Input.is_action_just_released("jump") and velocity.y < 0.0:
		velocity.y *= 0.5

	var direction: float = Input.get_axis("move_left", "move_right")
	velocity.x = direction * speed

	move_and_slide()
	_update_animation(direction)


func _update_animation(direction: float) -> void:
	if direction != 0.0:
		sprite.flip_h = direction < 0.0
	if not is_on_floor():
		sprite.play("jump")
	elif direction != 0.0:
		sprite.play("run")
	else:
		sprite.play("idle")
```

要点：

- 动画名（idle / run / jump）必须和 `gen_sprite` 时给的一致。
- `gen_sprite` 默认角色朝右（`facing: right`），所以向左走时 `flip_h = true`。
- `play()` 对正在播的同名动画不会重头播，每帧调用没问题。
- 节点名是 `Sprite`，和 SKILL.md 里的场景模板对应；改名两边一起改。

## 俯视角：res://player/player_topdown.gd

```gdscript
extends CharacterBody2D

@export var speed: float = 120.0

@onready var sprite: AnimatedSprite2D = $Sprite


func _ready() -> void:
	# 没有地面和重力，碰到墙时沿墙滑动
	motion_mode = CharacterBody2D.MOTION_MODE_FLOATING


func _physics_process(_delta: float) -> void:
	var input: Vector2 = Input.get_vector("move_left", "move_right", "move_up", "move_down")
	velocity = input * speed
	move_and_slide()
	if input.x != 0.0:
		sprite.flip_h = input.x < 0.0
	sprite.play("run" if input != Vector2.ZERO else "idle")
```

俯视角还要做一件事：角色和场景物件的父节点开 `y_sort_enabled = true`，否则走到树后面
也会画在树前面。

验证：斜着走时 `velocity` 的长度应等于 speed（对角线不更快），松开归零。

## 常见改法

| 用户说 | 改哪里 |
| --- | --- |
| 跳太高 / 太低 | 改目标高度 h，重算 jump_velocity |
| 落得太飘 | 下落时加大重力：`velocity.y += gravity * (1.6 if velocity.y > 0.0 else 1.0) * delta` |
| 起步太硬、像滑冰 | 用 `move_toward()` 让 velocity.x 逐渐逼近目标，加速度和减速度分开设 |
| 边缘老是掉下去跳不起来 | 加大 coyote_time（0.1 → 0.15） |
| 落地前按跳没反应 | 加大 jump_buffer_time |

每改一处，用同一组 `godot_run` 参数再跑一次，对比前后的数。
