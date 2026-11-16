---
name: video-sprite-animation
description: Makes smooth 2D sprite animations for a Godot 4 project from AI video - a green-screen character turnaround still approved by the user, one gen_sprite_video call per action (the video model animates the still on a solid green or black background, then the tool extracts frames, keys out the background, finds the loop point, removes drift and packs every action into one SpriteFrames .tres), re-processing without paying again, and proof in the running game. Use when the user asks for 序列帧、帧动画、做一套角色动作、攻击动画、跑步循环、技能特效序列帧、用视频生成动画、绿幕抠图做精灵、spritesheet with many smooth frames, or says the gen_sprite frames are too few or too stiff. Do not use for simple 4-8 frame pixel-art sprites (gen_sprite in godot-2d-character is cheaper), for promo or concept videos (generate_video), for 3D characters, or for wiring movement code (godot-2d-character).
---

# 视频序列帧动画（Godot 4）

视频模型拿一张角色定稿图当首帧，在纯绿底上演一段动作；`gen_sprite_video` 再抽帧、抠底、
找循环点、拉回漂移，拼成 `res://assets/gen/sprites/<name>.png` + `<name>.tres`。
同一角色的每段动作拼进同一个 `.tres`，格子统一、按脚底对齐，切动画时角色不跳。

## Quick Start

```
art_style(action: "show")                          画风先定
generate_image(...)                                绿底全身定稿图 → ask_user 让用户定
ask_user                                           动作清单 + 每段秒数（花钱，一次确认）
gen_sprite_video(name, action, description, reference_image)   每个动作一次
gen_sprite_video(name, action, fps / start / end)  不满意先免费重加工
AnimatedSprite2D 接上 → godot_check → godot_run → godot_screenshot
```

## Workflow

### 1. 选对路线

| 用户要的 | 用 |
| --- | --- |
| 像素风、4–8 帧、能动就行 | `gen_sprite`（`godot-2d-character`），便宜得多 |
| 流畅的十几二十帧、复杂动作（连招、翻滚）、手绘/高清风 | 这个 skill，`mode: character` |
| 火焰、爆炸、魔法光效这类半透明特效 | 这个 skill，`mode: vfx`（黑底，按亮度抠） |

`gen_sprite_video` 需要用户装了 ffmpeg；工具报找不到时把它给的安装命令转告用户，等装好再继续。

### 2. 定稿图（角色一致性的根）

同一角色的**每段动作都用同一张定稿图当首帧**，循环动作工具还会把它当尾帧。没有这张图，
几段动作里的角色会长得不一样，而且后面没法补救。

```
generate_image(
  prompt: "Full body side view of <角色外观>, facing right, standing in a neutral pose,
           centered with empty space around, solid flat pure green #00FF00 background,
           no ground, no shadow, even lighting, no green on the character",
  reference_images: [<工程风格参考图>], aspect_ratio: "1:1")
```

- 朝向、视角就是之后所有动作的朝向、视角，先和用户说清楚。
- 角色身上不能有绿色（绿色会被抠掉）；角色必须是绿的就改用品红底，告诉用户原因。
- 看图，用 `ask_user` 让用户定稿。定稿前不要生成任何视频。

### 3. 动作清单和费用

列出要做的动作、每段秒数（默认 4 秒，循环动作 2–4 秒够了，一次性动作按实际长度）、
分辨率（默认 720p），用一次 `ask_user` 让用户确认。每段都是一次按秒计费的视频生成。

每个动作的 `description` 写法见 [references/action-prompts.md](references/action-prompts.md)：
只写动作怎么做，绿底、固定机位、原地、首尾回到同一姿势这些约束由工具自动加。

### 4. 逐个动作生成

```
gen_sprite_video(
  project_path: "D:/Games/MyGame",
  name: "hero", action: "run",
  description: "runs in place with a strong arm swing, knees high",
  reference_image: "C:/Users/me/.../hero_ref.png")
```

- 一次性动作（attack、hurt、die）给 `loop: false`。
- 一次只做一个动作，看完回执再做下一个。
- 第一段的 `frame_height`（角色身高像素）决定整套比例；之后不传，自动沿用。

### 5. 看回执，先免费修

回执带一张这段动作的联系表。逐帧看：角色是不是同一个、有没有被裁、边上有没有绿边、
首尾能不能接上。回执第一行是「注意」时，按下表先用**不花钱**的办法修：

| 回执说 / 看到的 | 先试（不花钱） | 还不行再问用户要不要重新生成 |
| --- | --- | --- |
| 没找到干净的循环点 | `start` / `end` 截掉起势和收势 | description 强调 "returns to the starting pose" |
| 帧太多、播起来太慢 | 降 `fps` 或 `max_frames` | — |
| 碰到画面边缘 | 无法修：被裁掉的部分视频里就没有 | description 加 "small in frame"，或换更宽的动作描述 |
| 背景色残留 | 看角色身上是不是本来有绿色 | 定稿图换掉绿色衣物 |
| 面积突变（闪烁） | `start` / `end` 避开那几帧 | 重新生成 |

重新加工：不传 `description`，只改 `fps` / `start` / `end` / `max_frames` 再调一次，工具拿上次的视频重做。
任何重新生成都先 `ask_user`。

### 6. 接进游戏并验证

`.tres` 里每个 `action` 就是一个动画名。AnimatedSprite2D 的 `position.y`（或 `offset.y`）设为
**负的半个格子高**（回执里的格子尺寸），脚就落在节点原点。角色场景的其余部分
（碰撞、输入、移动脚本）照 `godot-2d-character` 的第 2–4 步。

验证（照 `godot-verify-changes`）：

```
godot_check()
godot_run(seconds: 3, inputs: [...触发各个动作的输入...], watch: ["Player/Sprite:animation", "Player/Sprite:frame"])
godot_screenshot()
```

- `animation` 按输入切到了对应动作名，`frame` 在循环动作里周而复始、一次性动作停在最后一帧；
- 截图里角色脚踩在地面上、大小和关卡相称、边缘没有绿边；
- 动作切换时角色有没有原地跳一下、节奏顺不顺，只能用户看：`editor_play` 让他试，说清楚看哪几个切换。

## Constraints

- 生成必须有定稿图，同一角色的所有动作用同一张。
- 同一个 `name` 下各段动作的身高、像素风设置必须一致；要换就换个 `name` 从头做。
- 不手改生成的 `.png` / `.tres`：下次加动作会按 `.gdbox/sprite-video/` 里的记录整张重拼，手改会被覆盖。
- 回执里的「注意」原样转告用户，不自己判断「问题不大」。
- 每次生成都花用户的钱：不满意先重加工，重新生成之前 `ask_user`。

## Failure Handling

- **视频生成失败或超时**：钱多半已经扣了。把原因告诉用户，不要直接重试。
- **下载失败 / 用户中途按了停止**：回执或停止说明里有任务号，用 `resume_job_id` 取回，不重新生成。
- **抠完全是空的**：视频背景不是纯色。用 `analyze_video` 看一眼视频，再问用户要不要换提示词重来。
- **找不到 ffmpeg**：转告工具给的安装命令。

## Escalation

- 用户已有现成的绿幕/黑底视频：`source_video` 直接加工，跳过第 2–4 步，不花钱。
- 用户要 Kling、Veo 等目前没接的视频模型：如实说明现在只接了用户在 设置 → 模型 里配好的视频服务。
- 特效要叠加发光：`mode: vfx` 出的是带半透明的 PNG，叠加混合需要用户在材质里设 `blend_mode = add`，先问用户要不要。
