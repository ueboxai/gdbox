# Trigger examples

## Should trigger

- 给角色做 4 个木地板脚步声
- 做一个按钮点击音效，放进工程
- 来个爆炸声，2 秒左右
- 为素材库制作一个拾取金币的声音，复古一点
- 做一段能循环的风声当环境音
- I need a laser shot sound for my weapon

## Should not trigger

- 在 Godot 工程里直接生成复古跳跃或拾取音效 → `godot-game-audio` / `gen_sfx`

- 给这个视频配一段背景音乐 → `generate_task_music`
- 把这句台词念出来 / 做个旁白 → `generate_speech`
- 用 AudioStreamRandomizer 把这几个脚步声随机播放 → engine-side editing, not generation
- 帮我分析这个视频里的音效节奏 → `analyze_video`

## Ambiguous

- 给这段过场加点声音 → ask whether they want music, effects, or both.
- 做个真实的玻璃碎裂声 (only local route available) → explain local synthesis cannot sound
  recorded; offer binding ElevenLabs before making a synthetic version.

## Failure handling

- `generate_sound_effect` returns `ffmpeg: null` → give the two options, stop.
- Cloud call fails with "上次音效提交结果未确认" → relay it; do not delete the receipt or retry.
- FFmpeg prints `No such filter` → the build is too old or minimal; tell the user the version
  from `ffmpeg -version` and suggest installing a full build.
