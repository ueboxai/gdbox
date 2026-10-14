---
name: godot-tilemap-level
description: Builds or extends a 2D tile-based level in a Godot 4 project - tiles generated with gen_tileset into a TileSet with collision, a TileMapLayer node written into the level .tscn, cells painted as real scene data from an ASCII layout so the user can keep editing them in the editor, and the result checked with a screenshot and a walk-through. Use when the user asks for 做一关、搭个关卡、铺地形、加平台、换一套瓦片、角色掉出地图/穿过地面, or wants a level layout changed. Do not use for the player character itself (godot-2d-character), for 3D levels, for procedural generation at runtime, or for a background painting (image-generation).
---

# 2D 瓦片关卡（Godot 4.3+ TileMapLayer）

关卡要做到两件事才算成：**玩家站得住**（碰撞对），**用户还能接着改**（瓦片是场景数据，
在编辑器里打开就能继续画）。后一条最容易丢：在 `_ready()` 里用代码 `set_cell()` 铺出来的关卡
跑起来没问题，但编辑器里是空的，用户一笔都改不了。

## Quick Start

```
art_style(action: "show")                  瓦片尺寸、像素风跟着工程风格走
gen_tileset(...)                           → res://assets/gen/sprites/<name>.tres + 每块瓦片的图集坐标
写 ASCII 布局 → scripts/ascii_to_tile_map_data.pl → tile_map_data 一行
关卡 .tscn 里加 TileMapLayer                tile_set + tile_map_data
godot_check → godot_screenshot → 让角色走一遍（godot_run）
```

## Workflow

### 1. 先确认版本和现状

- 读 `project.godot` 的 `config/features`，确认是 Godot 4.3 或更新。更老的版本没有 TileMapLayer，
  见文末 Escalation。
- 关卡已经存在时先读它的 `.tscn`：已有的 TileMapLayer、TileSet、玩家出生点在哪。
  **改已有关卡时只追加或替换你负责的那一层**，别的层原样留着。
- 用户在编辑器里开着这个关卡时，先 `editor_save_all`。

### 2. 出瓦片

```
gen_tileset(
  project_path: "D:/Games/MyGame",
  name: "forest_tiles",
  style: "grassy forest platformer, warm colors",
  tiles: ["grass top", "dirt", "stone", "wooden plank platform", "small flower"],
  passable: [4]
)
```

- 瓦片尺寸和像素风默认取工程风格（`art_style`），不要在这里另给一个和角色对不上的尺寸。
- `passable` 填**不需要碰撞**的瓦片序号（花草、装饰）。其余瓦片整格碰撞，在物理第 1 层。
- 返回里每块瓦片都有图集坐标，**照抄下来**，第 3 步要用：`0. grass top → atlas (0, 0)`。
- 看预览图：瓦片之间能否无缝拼接、有没有自带的黑描边。返回里说「找到的块数和要求的不一致」时，
  坐标对应可能错位 —— 用 `ask_user` 说明问题、给出选项（重出 / 将就用 / 换描述），
  重出要花用户的钱，不自己决定。
- 已有瓦片集够用时跳过这一步，直接读那个 TileSet 的 `.tres` 找坐标（`列:行/0 = 0` 那几行就是）。

### 3. 画布局，转成场景数据

先用字符画出关卡，一个字符一格，第一行是最上面一行，`.` 是空：

```
..............................
..............................
.........PPPP.................
..............................
....PPP..........PPPP.........
..........f.............f.....
GGGGGGGGGGGGGG....GGGGGGGGGGGG
DDDDDDDDDDDDDD....DDDDDDDDDDDD
```

布局存成一个文本文件（放在工程外的临时目录，用户要留底就放 `docs/levels/`），然后用
[scripts/ascii_to_tile_map_data.pl](scripts/ascii_to_tile_map_data.pl) 把它转成 TileMapLayer 的数据行：

- **什么时候跑**：每次布局改了都重新跑一遍，整行替换。
- **怎么跑**：用 `read_skill_resource` 读出脚本内容，`write_local_file` 存到工程外的临时目录，
  再 `run_shell_command`：
  `perl <脚本路径> <布局文件> G=0:0:0 D=0:1:0 P=0:3:0 f=0:0:1`
  图例是「字符=source:图集x:图集y」，`gen_tileset` 出的 source 都是 0。
- **输出**：标准输出是一行 `tile_map_data = PackedByteArray(...)`，标准错误是格数和尺寸。
  图例里没有的字符会报出行列号，照着改布局或图例。
- 有 shell 的机器都带 perl（Git for Windows 自带），不需要另装。

关卡里的写法（`ext_resource` 只写 path，不写 uid）：

```
[ext_resource type="TileSet" path="res://assets/gen/sprites/forest_tiles.tres" id="1_tiles"]

[node name="Ground" type="TileMapLayer" parent="."]
tile_set = ExtResource("1_tiles")
tile_map_data = PackedByteArray(0, 0, ...)
```

布局设计的几条：

- 跳跃够得着：平台间的高差不超过角色跳跃高度（见 `godot-2d-character` 里的算法），
  水平间隔不超过「跑速 × 滞空时间」。先算再画，别画完靠试。
- 地面两端封住或留出明确的出口，免得角色走出地图掉下去。
- 一张关卡别超过 300×100 格，更大的拆成几个场景。

### 4. 验证

照 `godot-verify-changes`：

1. `godot_check` 跑这个关卡（不是主场景就给 `scene`）。数据行写坏了会在这里报错。
2. `godot_screenshot` 拍关卡，**对着 ASCII 布局逐行核**：地面、平台的位置和长度对不对，
   瓦片有没有用错（草和土颠倒是图集坐标抄错了）。
3. 有玩家时 `godot_run` 让他走一段、跳一次，`watch` 看 `Player:position`：
   站在地面上 y 不变、走到坑上方会往下掉、跳上平台后 y 停在平台高度。
   **截图对、走不上去**，就是碰撞的问题（见 Failure Handling）。

最后告诉用户：在编辑器里打开这个场景、选中 Ground 节点，就能用底部的 TileMap 面板接着画。

## Constraints

- 用 TileMapLayer，不用已废弃的 TileMap 节点（新工程里它会报弃用警告）。
- 不在 `_ready()` 里铺关卡，理由见开头。
- 不手写 TileSet 的 `.tres` 去「补」碰撞或改图集，重出用 `gen_tileset`；
  要细调（单向平台、斜坡）交给用户在 TileSet 编辑器里点，或说明这一步要怎么改再动手。
- 不碰 `.godot/`，不编 uid。

## Failure Handling

| 现象 | 多半是 |
| --- | --- |
| 截图里瓦片位置对、角色却穿过去 | 角色的碰撞遮罩不含第 1 层；或那块瓦片在 `passable` 里 |
| 截图里一片空 | `tile_set` 没指对文件；或数据行没粘进 TileMapLayer 节点下 |
| 瓦片错位一格 / 用错图 | 图例里的图集坐标抄错，回第 2 步的返回值核对 |
| 瓦片之间有缝或描边 | 生成的瓦片不够无缝，`ask_user` 决定是否重出 |
| 角色卡在两块地面的接缝上 | 用 RectangleShape2D 时偶发；把角色碰撞盒底边改成圆角（CapsuleShape2D） |

## Escalation

- 工程是 Godot 4.2 或更早：没有 TileMapLayer。告诉用户，问是升级工程还是改用 TileMap 节点
  （数据格式不同，不能用这里的脚本）。
- 没有 `run_shell_command`：跑不了脚本。退一步把布局写在关卡脚本里、运行时 `set_cell()` 铺，
  并**明确告诉用户编辑器里看不到这些瓦片**；或者请用户在编辑器里照着 ASCII 图自己画。
- 要自动拼接的地形（Terrain 自动边角）：需要在 TileSet 里设地形集，`gen_tileset` 不出这个，
  交给用户在 TileSet 编辑器里配。
