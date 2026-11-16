---
name: godot-verify-changes
description: Proves that a change to a Godot project actually works before it is reported done - the edit, godot_check for script and scene errors, godot_run with scripted inputs and watched values for behaviour, godot_screenshot for anything visible, and handing the parts a model cannot judge (feel, sound) to the user with editor_play. Use when any .gd, .tscn, .tres or project.godot was just written or edited, when the user asks "跑一下看看"、"验证一下"、"真的能跳吗"、"为什么没反应"、"报错了", or when a fix must be confirmed. Do not use for generating art or audio, for git merges of scene files (godot-team-scenes), or for performance profiling on the user's target device.
---

# 改完怎么证明它真的成了

工具说「写入成功」只说明文件落盘了。游戏能不能跑、角色会不会跳、画面对不对，
要在 Godot 里真跑一遍才知道。这条 skill 是改完之后的固定动作。

## Quick Start

```
改文件
  ↓  godot_check        无头导入 + 跑 120 帧：脚本错误、场景加载错误
  ↓  godot_run          按时间表按键、点鼠标，记录数值随时间的变化：行为对不对
  ↓  godot_screenshot   离屏渲染一帧给你看：画面对不对
  ↓  editor_play        在用户的编辑器里跑起来：手感、声音交给用户
```

前三步不需要编辑器开着，也不会抢用户的画面。按成本从低到高走，前一步不过不进下一步。

## Workflow

### 0. 改之前

- **不碰 `.godot/`。** 那是编辑器的导入缓存，改了会被覆盖或把缓存弄坏。
- **`uid://` 原样保留。** 新加的 `[ext_resource]` 不知道 uid 就只写 `path=`，不编 uid。
- 用户正开着要改的 `.tscn` 时，先 `editor_save_all`，把他没存的改动落盘，再改。
- 改的是**被多处使用**的东西（玩家场景、共用脚本、autoload、`project.godot`）时，先查谁在用：
  `grep_local_files` 在 `**/*.tscn` 和 `**/*.gd` 里搜它的 `res://` 路径或类名，记下名单，
  第 1 步要把名单里的场景都查一遍。

### 1. `godot_check` —— 每次改完都跑

- 有错误就修，**一条不剩**再往下。别带着「这个报错应该无关」去汇报。
- 默认只跑主场景。改的是别的场景，或者第 0 步记下了一串受影响的场景，用 `scene` 逐个查。
- 报「异常退出」时再跑一次确认，两次都异常才当崩溃处理。
- 它告诉你的只是「这 120 帧里没报错」。没走到的分支（按键之后、碰到敌人之后）它查不到 ——
  那是第 2 步的事。
- 退出时引擎自己报的资源泄漏提示已经被滤掉了，不用为它改代码。

### 2. `godot_run` —— 行为靠数字验证

先写下**预期的数**，再跑，再对表。没有预期就看不出对错。

```
godot_run(
  seconds: 3,
  inputs: [{ action: "move_right", at: 0.5, hold: 1.5 },
           { action: "jump", at: 1.0, hold: 0.2 }],
  watch: ["Player:velocity", "Player:position:y"],
  sample_interval: 0.05
)
```

- `inputs` 每条是下面四种之一：
  - `{ action: "jump", at, hold }`：InputMap 动作。动作不存在时结果里有一行 unknown input action，
    先去 `project.godot` 的 `[input]` 段补上。
  - `{ key: "Space", at, hold }`：直接按键，用于没配动作的按键（`Escape`、`Enter`、字母）。
  - `{ click: "UI/StartButton", at }` 或 `{ click: [320, 180], at, button: "right" }`：
    鼠标点节点在屏幕上的位置（Control 点中心），或点工程分辨率下的坐标。
  - `{ drag: { from: "Hand/Card1", to: [500, 200] }, at, hold: 0.4 }`：按住拖过去，`hold` 是拖动时长。
- 点按钮、拖卡牌、点地图这类鼠标操作，**照样要真点一遍**，再看点完之后的数值或截图。
- `watch` 填「节点路径:属性」，路径相对于被运行场景的根节点；`:y` 这样的后缀取分量。
  也可以调不带参数的 `get_/is_/has_` 方法，如 `"Player:is_on_floor()"`。
- 一群节点用聚合，选择器有 `@组名`、`%类名`（该类所有节点）、`路径/*`（直接子节点）：
  - `count(@enemies)`：数量；
  - `min/max/mean/sum(@balls:global_position:y)`：向量取长度；
  - `changed(Terrain/*:position)`：和上一次采样比，值变了的节点占多少（0–1）。
- 每次运行都会自动报两类坏值：坐标或速度成了 NaN/inf，物体飞到几百万像素外。看到就是 bug。
- 截图和前几秒的数值对，不代表后面也对。把「整局都该成立」的事写成 watch 并跑够时长：
  - 速度场、粒子、物理：`max(@…:velocity)` 不能越来越大；
  - 物体不穿地：`max(@balls:global_position:y)` 一直小于底板的 y；
  - 该动的在动：`changed(@slope:position)` 接近 1，而不是只有一小部分在动；
  - 速度对不对：单位每秒走的距离等于设定速度，不是只看「在动」。
- 拿到的表只列有变化的行。对照预期逐项核：
  - 移动：按住期间 `velocity.x` 等于设定速度，松开后归零；
  - 跳跃：起跳那一刻 `velocity.y` 等于起跳速度（向上为负），最高点的高度差约等于
    v² ÷ (2 × 重力)，落地后 `position.y` 回到原值；
  - 计时类（冷却、无敌帧）：看数值在预期的时间点翻转。
- 跑的是固定 60 帧每秒，结果可重复。不对就改代码再跑，**同样的参数**再跑一次比对。
- 要验证的情形需要一个特定场景时，用 `scene` 跑工程里已有的那个场景。
  **不往工程里写临时测试场景**：它们会留在用户的工程和仓库里。

### 3. 看画面 —— 改了看得见的东西就要看

- `godot_screenshot` 默认拍第 30 帧。有入场动画、淡入、镜头跟随的场景把 `frames` 加大，
  否则拍到的是过渡中的画面。
- 要看按键之后的画面（跳到半空、开门之后），在 `godot_run` 里加 `screenshots: [1.2]`，
  同一次运行里拿到那一刻的图。
- 看图时对着要求逐条说：位置、大小、层级、遮挡、颜色。看不清就说看不清，不要脑补。
- 像素风画面糊了，多半是工程没开最近邻过滤（`project.godot` 里
  `textures/canvas_textures/default_texture_filter=0`）。

### 4. 模型自证不了的，交给用户

手感好不好、声音对不对、多人联机、目标设备上的帧率，这几样你判断不了。
`editor_play` 在用户的编辑器里把游戏跑起来，然后**具体地**告诉他要试什么：
「按住 D 跑到第二个平台，连按两次空格，看二段跳的高度是否合适」，
而不是「你试试看」。没有用户的确认，不要把这几项写成「已完成」。

## Constraints

- 不从 shell 里自己启动 Godot 来测：三个工具已经知道 Godot 在哪、会串行跑，避免两个进程
  同时导入同一个工程把 `.godot/` 缓存踩坏。
- 汇报时说清验证到了哪一层：「check 无报错；run 里跳跃最高 64px，符合预期；
  手感待你试」。不要把第 1 步的结果说成「功能正常」。
- 找不到 Godot 时工具会报错并说明去哪设置 —— 照原话转告用户，不要换路子绕。

## Failure Handling

| 现象 | 先查什么 |
| --- | --- |
| run 报「Could not start」/ 场景加载不了 | `project.godot` 有没有设主场景；或者用 `scene` 指定 |
| watch 那一列是 `<no node>` | 路径错了。路径从被运行场景的根节点算，打开 `.tscn` 看节点名和层级 |
| 按键没反应、数值不动 | 动作名和 `[input]` 里的是否一字不差；脚本是不是挂在那个节点上 |
| click target not found | 节点路径错了，或那一刻节点还没生成 / 已经被删 |
| 点了按钮没反应 | 按钮被别的 Control 挡住（`mouse_filter`）；或点击时间早于界面出现 |
| 截图是空的或只有 UI | 刚放进工程的图还没导入完 —— 工具会先导入，仍为空就看报错里的资源路径 |
| 同一个错改了三次还在 | 停下来。重新读完整报错和相关文件，怀疑前提（改错了文件？节点不是那个类型？），再动手 |

## Escalation

- 问题只在用户机器的编辑器里出现、无头运行复现不了 → 请用户 `editor_play` 复现，
  把输出面板的报错原文贴给你。
- 验证需要多指触屏手势、手柄摇杆 → 说明 `godot_run` 做不到，请用户手动试。
