---
name: godot-game-audio
description: Gives a Godot game its sound - retro sound effects synthesised locally with gen_sfx, looping background music with gen_music, character voice lines with gen_voice, every file measured with inspect_audio because the model cannot hear, then wired in with AudioStreamPlayer nodes and Music/SFX/Voice buses so volumes can be balanced. Use when the user asks for 加音效、跳跃/金币/受击的声音、背景音乐、BGM 不循环、配音、台词、对白、声音太吵/太小、音乐盖住了配音. Do not use for the task-video soundtrack (task-to-video), for analysing a recording the user made, or for a sound the user already has as a file (just put it in the project).
---

# 游戏音频（Godot 4）

**你听不见。** 这条 skill 的所有做法都从这句话出发：能量化的用 `inspect_audio` 量，
量不了的（好不好听、像不像、情绪对不对）交给用户听，并且一次给他几个候选去挑，
而不是你替他判断「这个不错」。

## Quick Start

| 要什么 | 用 | 花钱吗 | 落到哪 |
| --- | --- | --- | --- |
| 跳跃、金币、受击、爆炸、射击、升级、菜单选择 | `gen_sfx` | 默认免费本地合成；description 云端路线按变体收费 | `res://assets/gen/sfx/<name>_<n>.wav` |
| 背景音乐 | `gen_music` | 花，一到几分钟 | `res://assets/gen/music/<name>.wav`（无缝循环） |
| 对白、旁白 | `gen_voice` | 花，没改的台词跳过不收费 | `res://assets/gen/voice/<id>.wav` |
| 检查任何一个音频 | `inspect_audio` | 不花，只读 | — |

三个生成工具的 `project_path` 都要给工程根目录的**绝对路径**。

## Workflow

### 1. 音效

```
gen_sfx(project_path: "D:/Games/MyGame", name: "jump", kind: "jump", count: 3)
```

- `kind` 只有七种预设：jump、coin、hit、explosion、shoot、powerup、select。用户要的声音
  不在里面（脚步、开门、环境声）时可传 description 按描述生成：要先绑「音效生成」，
  「音乐」绑的 ElevenLabs 不算。云端每个变体收费，默认明确传 count: 1；未绑定时
  工具仍会按 kind 本地合成，必须把回执说明的降级告诉用户，不能把复古合成说成写实音效。
  素材库音效或环境循环用 sound-effects 技能与 generate_sound_effect，再导入工程。
- 默认出 3 个候选。对每个跑一遍 `inspect_audio`，把**测得的事实**列给用户：
  时长、开头静音、响度、音高走向。开头静音超过 80ms 的按下去会觉得「慢半拍」，
  这种直接排除并说明原因。
- 请用户在资产抽屉里试听，选定一个。选定后把那个改名为 `jump.wav`（或在代码里引用它），
  其余的经用户同意再删 —— 引用没改完就删会让场景报找不到资源。

### 2. 背景音乐

```
gen_music(project_path: "D:/Games/MyGame", name: "level1_bgm",
          description: "cheerful chiptune, bouncy bass, 120 bpm, adventurous", seconds: 60)
```

- 描述写情绪、曲风、乐器、速度，只做纯音乐。
- 要等一到几分钟。中途断了**用完全相同的参数**再调一次，是续查同一个任务，不会重复扣费；
  改了任何参数就是新任务、新的一笔钱。
- 返回里给出循环点和接缝相似度。再用 `inspect_audio` 量一遍：`seam jump` 低于 0.05
  听不出接缝。高于这个值，或者工具说「没找到干净的循环点、按原样存成 mp3」时，
  把情况告诉用户，用 `ask_user` 让他选：重出 / 将就用 / 换描述 —— 不自己决定重出。
- 循环的 WAV 导入后自动循环，不用改设置。**存成 mp3 的不会自动循环**：在它旁边的
  `.import` 里把 `loop=false` 改成 `loop=true`，或者在播放代码里兜底
  `(stream as AudioStreamMP3).loop = true`。两样都不做，音乐放完一遍就停了 ——
  这个 bug 测试抓不到，往往到发布才被发现。

### 3. 配音

```
gen_voice(project_path: "D:/Games/MyGame", lines: [
  { id: "intro_01", text: "有人吗？", voice: "<站长的音色>" },
  { id: "intro_02", text: "这么晚了还有车吗……", voice: "<少年的音色>" }
])
```

- **台词 id 是文件名，也是代码里引用它的键**，定下来就别改：`intro_01` → `res://assets/gen/voice/intro_01.wav`。
- 不同角色给不同 `voice`。音色 id 取决于用户绑定的语音服务，你猜不出来 —— 问用户，
  或先用设置里的默认音色出一句给他听。角色和音色的对应记进工程（例如 `docs/voices.md`），
  下次加台词照着用。
- 改了一句台词只重新传那一句，或整批重传都行：文字和音色都没变的会跳过、不收费。
- 中途失败时工具会停下并说明是哪一句、为什么（多半是配置或额度），后面的没合成。
  照原话转告用户，不要换个参数接着烧。
- 时长和首尾静音用 `inspect_audio` 量；要确认念的字对不对，`analyze_video` 能把音频转写成文字
  （会把音频发给用户配置的模型，先说一声）。

台词多了要用表管理时，放 `data/lines.csv`（列：id、speaker、text）。**`res://` 下的 `.csv`
默认会被 Godot 当成翻译表导入**，原文件在导出后就没了。在它旁边写一个
`lines.csv.import`，内容是 `[remap]` 段下一行 `importer="keep"`，让它保持原样。

### 4. 接进游戏

总线先建好，音量才有地方调。工程根目录的 `default_bus_layout.tres`（没有就新建，有就追加）：

```
[gd_resource type="AudioBusLayout" format=3]

[resource]
bus/1/name = &"Music"
bus/1/solo = false
bus/1/mute = false
bus/1/bypass_fx = false
bus/1/volume_db = -6.0
bus/1/send = &"Master"
bus/2/name = &"SFX"
bus/2/solo = false
bus/2/mute = false
bus/2/bypass_fx = false
bus/2/volume_db = 0.0
bus/2/send = &"Master"
bus/3/name = &"Voice"
bus/3/solo = false
bus/3/mute = false
bus/3/bypass_fx = false
bus/3/volume_db = 0.0
bus/3/send = &"Master"
```

节点怎么挂：

- 背景音乐：关卡里一个 AudioStreamPlayer，`stream` 指向音乐，`bus = &"Music"`，`autoplay = true`。
  跨关卡不断的音乐放进 autoload 场景里。
- 角色音效：挂在角色场景下的 AudioStreamPlayer，`bus = &"SFX"`，脚本里在起跳那一行调它的 `play()`。
  有方位感的（敌人、爆炸）用 AudioStreamPlayer2D。
- 同一个音效会快速连发（射击、金币连吃）时，把播放器的 `max_polyphony` 设成 3–4，
  不然后一声会把前一声掐断。
- 配音播放时压低音乐：说话期间把 Music 总线降 8–10 dB，结束后恢复（用 Tween 渐变，别硬切）。

### 5. 验证

- `godot_check` 无报错（资源路径写错会在这里报）。
- `godot_run` 跑一遍触发声音的操作，确认没有报错。它证明的只是「代码调到了播放」，
  **证明不了声音对**。
- 用 `editor_play` 让用户在编辑器里玩，告诉他听什么：「跳三次听跳跃声，等 BGM 播完一轮听接缝，
  走到 NPC 旁听配音时音乐有没有让开」。没有用户的确认，音频不算验收完。

## Constraints

- 不用脚本自己去处理生成出来的音频（裁剪、找循环点、改格式）：生成工具已经处理好了，
  再加工只会把循环点弄丢。
- 不自己决定重新生成要花钱的音乐、配音和云端音效；只有本地 sfxr 合成免费。
  云端音效同参数复用 .gdbox/sfx-cache 下的 WAV；结果未确认时保留回执，不自行删回执或换描述重试。
- 不碰 `.godot/`。改 `.import` 只改那一行参数，其余原样保留（尤其是 `uid=`）。
- 改共用的总线布局前先读现有的 `default_bus_layout.tres`，追加而不是覆盖，
  别人调好的音量和效果器不能被你冲掉。

## Failure Handling

| 现象 | 多半是 |
| --- | --- |
| 生成音乐/配音报「未配置」 | 用户没绑定对应模型，照原话告诉他去偏好设置的哪里配 |
| 音乐放完一遍就停 | 存成了 mp3 而没打开循环，见第 2 步 |
| 按键后声音晚半拍 | 开头静音太长（`inspect_audio` 看得出），换一个候选 |
| 音效被掐断 | 同一个播放器连发，调大 `max_polyphony` |
| 声音太小 / 被盖住 | `inspect_audio` 看峰值；低于 -12 dBFS 的在混音里会被吞掉，先调总线再调单个播放器 |

## Escalation

- 写实音效需要绑定 ElevenLabs；无绑定时说明本地合成的限制。带人声的歌曲不由这些工具生成，
  请用户提供文件，放进工程目录使用。
- 用户要多语言配音：每种语言一套 id 前缀（`en_intro_01`），先确认他的语音服务支持那种语言。
