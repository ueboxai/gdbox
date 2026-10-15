# 动作描述模板

`gen_sprite_video` 的 `description` 只写**动作本身**：哪个部位怎么动、幅度、节奏、开始和结束的姿势。
绿底、固定机位、原地、居中、首尾同姿势这些约束工具会自动拼进提示词，这里不用重复。

写法要点：

- 用英文写，具体到肢体：「挥剑」不如 "swings the sword from upper right down to lower left"。
- 移动类动作一律写 "in place"（原地跑、原地走），否则角色会跑出画面。
- 一次性动作写清收尾姿势："then returns to the idle stance"。
- 秒数：循环动作 2–4 秒（一个或两个周期），一次性动作按动作实际长度，不要为了「保险」加长。

| 动作 | loop | 建议秒数 | description 示例 |
| --- | --- | --- | --- |
| idle | true | 3 | breathes slowly, shoulders rise and fall slightly, small sway |
| walk | true | 2 | walks in place at a relaxed pace, natural arm swing |
| run | true | 2 | runs in place with a strong arm swing, knees high, leaning slightly forward |
| jump | false | 2 | crouches, jumps straight up, tucks legs at the top, lands back in the same spot |
| attack | false | 2 | swings the sword from upper right down to lower left in one fast slash, then returns to the idle stance |
| hurt | false | 1–2 | flinches backward from a hit, then recovers to the idle stance |
| die | false | 3 | staggers, falls to the ground and stays lying still |
| cast | false | 3 | raises the staff, gathers glowing energy, thrusts it forward, then returns to the idle stance |

特效（`mode: vfx`，黑底，不需要角色定稿图里的角色，但仍要给 reference_image 定颜色和形状）：

| 特效 | loop | description 示例 |
| --- | --- | --- |
| 火焰 | true | a campfire-sized flame flickering steadily, orange core and yellow tips |
| 爆炸 | false | a round explosion bursts outward from the center, then fades to nothing |
| 魔法光环 | true | a ring of blue magic runes rotating slowly, soft glow |
| 命中火花 | false | a burst of white and yellow sparks flies outward from the center and fades |
