---
name: godot-art-style
description: Fixes a Godot project's art style once with art_style - style words, pixel art or not, character frame height, tile size, a palette taken from an image the user likes, reference images - so every later gen_sprite and gen_tileset matches, plus the project settings pixel art needs, cross-project style presets, and the rules for when restyling means paying to regenerate. Use when starting art for a new project, when the user says 定个画风、统一一下风格、这几张图风格不一致、像素密度不一样、画面糊、用上个项目的风格, or before the first gen_sprite or gen_tileset in a project that has no style yet. Do not use for one-off concept art or posters (image-generation), for 3D model style (ai-3d-asset-production), or for UI theme and fonts.
---

# 定画风（Godot 工程的美术风格包）

靠每次生成时「记得带上风格前缀」是守不住的：几轮之后就会有一张没带，画风就跑了；
几张图各自的像素密度也会悄悄不一样。所以风格写进工程（`.gdbox/style.json`），
`gen_sprite` 和 `gen_tileset` **每次自动套用**。这条 skill 负责把它定对，并且定一次。

## Quick Start

```
art_style(project_path: "D:/Games/MyGame", action: "show")
```

- 已经有风格 → 照它来，**不要擅自改**。用户想换，走下面「改风格」。
- 没有风格 → 走 Workflow，先定再生成。

## Workflow

### 1. 问清三件事，给出默认

不要开放式地问「你想要什么风格」。给一个推荐方案，让用户点头或改一两项：

| 项 | 推荐默认 | 说明 |
| --- | --- | --- |
| 像素风 | 是 | 小团队最容易做统一；不是像素风就给 false |
| 瓦片尺寸 | 16 | 像素风常用 16 或 32 |
| 角色帧高 | 瓦片的 2 倍（32） | 角色约两格高，跳跃、平台间距都按格算，好设计 |
| 风格词 | 用户的说法翻成几个英文短语 | 只写画风，不写具体角色：`cozy fantasy, warm palette, soft shading` |

风格词里不要放主体（「骑士」「森林」），否则每张图都会被塞进一个骑士。

### 2. 写进工程

```
art_style(project_path: "D:/Games/MyGame", action: "set",
          prompt: "cozy fantasy, warm palette, soft shading",
          pixel_art: true, tile_size: 16, frame_height: 32)
```

`set` 只改给出的字段，其余不动。

### 3. 出一张样张，再锁调色板

风格词定不死颜色。先出第一个真正要用的资产（通常是主角，见 `godot-2d-character`），
用户看了满意，再用它锁色：

```
art_style(project_path: "D:/Games/MyGame", action: "set",
          palette_from: "res://assets/gen/sprites/hero.png",
          references: ["res://assets/gen/sprites/hero.png"])
```

- `palette_from` 从这张图里取最多 16 色，之后生成的图都映射到这套颜色上。
- `references` 让后面的生成「照着这张的画法」画。参考图只放用户认可的，一两张就够 ——
  放一张他不喜欢的，以后每张都会像它。

### 4. 工程设置（像素风必做）

读 `project.godot`，在对应段落里补上（已有的键改值，不要重复写一行）：

```
[display]

window/size/viewport_width=320
window/size/viewport_height=180
window/stretch/mode="viewport"
window/stretch/scale_mode="integer"

[rendering]

textures/canvas_textures/default_texture_filter=0
```

- `default_texture_filter=0` 是最近邻过滤：不设，放大后的像素图是糊的。
- 视口取小分辨率（320×180、640×360），整数倍放大到窗口，像素才大小一致、不闪。
  视口宽度换算成瓦片数（320 ÷ 16 = 20 格）告诉用户，关卡设计要用。
- 编辑器开着时，改完让用户「项目 → 重新加载当前项目」，否则编辑器可能把旧设置写回去。

### 5. 验证

在**同一个画面里**看角色和瓦片：`godot_screenshot` 拍一个两者都在的关卡。对着看：

- 像素大小一致：角色的一个像素和瓦片的一个像素一样大（不一致是帧高和瓦片尺寸给错了倍数，
  或者有一张不是用工程风格出的）；
- 颜色属于同一套；
- 画面不糊。

看不出的就说看不出，不要替用户下「风格统一」的结论。

## 跨工程：预设

用户满意的一套风格，存成预设，下个工程一步套用：

```
art_style(project_path: "D:/Games/MyGame", action: "save_preset", preset: "cozy-pixel")
art_style(project_path: "D:/Games/NextGame", action: "load_preset", preset: "cozy-pixel")
art_style(project_path: "D:/Games/NextGame", action: "list_presets")
```

`load_preset` 会把参考图拷到新工程的 `res://assets/style/`。用户说「用上次那个风格」，
先 `list_presets` 看名字，别猜。

## 改风格：先算清代价

改风格**不会**改已经生成的图 —— 它们保持旧样子，新旧混在一起就是不统一。所以：

1. 列出受影响的资产：`list_local_dir` 看 `res://assets/gen/sprites/` 下有哪些。
2. 告诉用户：改了之后要统一，就得重出这 N 个，每个都是一次生图费用；也可以只让新资产用新风格。
3. 用户选了再动。重出用和当初同样的名字，旧文件自动备份到 `.gdbox/history/`，场景里的引用不用改。

`art_style` 本身不花钱；花钱的是之后的重新生成，那个决定归用户。

## Constraints

- 一个工程一套风格。不要为某一张图临时改风格再改回来 —— 中间要是中断，工程就停在错的风格上。
  单张要特殊处理，在那次 `gen_sprite` 的描述里写。
- 参考图和 `palette_from` 只收工程里的 `res://` 路径；用户给的外部图先复制进工程（如 `res://assets/style/`）。
- 不碰 `.godot/`。`.gdbox/style.json` 只通过 `art_style` 改，不手写。

## Failure Handling

| 现象 | 处理 |
| --- | --- |
| 生成工具报「参考图读不到」 | 参考图被移走或改名了。`show` 看当前设置，改 `references` 指到正确位置 |
| 颜色太脏、太灰 | 调色板取自一张颜色少的图。换一张颜色更全的满意图重新 `palette_from`，或用 `palette` 直接给色值 |
| 出图越来越像参考图里的那个角色 | 参考图放的是角色图，模型把主体也学走了。换成场景或多个物件的图，或去掉参考图只留调色板 |
| 预设名报错 | 预设名只能用字母、数字、下划线、连字符和空格 |
