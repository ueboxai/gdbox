---
name: ai-3d-asset-production
description: Routes a request for a new 3D asset for a Godot game across the box's AI capabilities instead of hand-modelling it - image generation for concept sheets and turnaround views, image-to-3D generation for the base mesh as glb, placing the glb in the Godot project with a wrapper scene that fixes scale, facing, origin and collision, Blender for reshaping when it is connected - and checks each stage against the reference before the next one starts. Use when the user wants a 3D model made from an idea or a reference picture, or says things like 照着这张图做个模型、做个道具、生成一个底模、先出四视图、用 AI 做这个 3D 资产、模型放进游戏太大了/朝向不对、这模型做得不像怎么办. Do not use for 2D sprites or tiles (godot-2d-character, godot-tilemap-level), for editing an existing model only, for animating characters, or for concept art that will never become a model.
---

# AI 主导的 3D 资产生产（Godot）

这条流程的前提是**AI 贯穿始终**：凡是已经接进盒子的 AI 能力，优先用它，手工只在
AI 这一环确实做不到时才补位 —— 不是反过来。

这里给的是**默认路线和判断依据，不是强制流程**。用户点名要某个模型、某条路、
某种做法，就照用户的来；下面的默认只在没人点名时生效。

## Quick Start

```
想法 / 参考图
  ↓  generate_image            设定图 → 四视图
  ↓  generate_3d_model         底模（glb，静态网格，没有骨骼）
  ↓  复制进工程                 res://models/<name>.glb，Godot 自动导入
  ↓  包一层场景                 <name>.tscn：缩放、朝向、原点、碰撞都在这一层定
  ↓  放进关卡 → 截图验收         godot_check + godot_screenshot
  ↓  复杂修形 → Blender         造型、拓扑、减贴图（用户接了 Blender 时）
```

动手前先做两件事，顺序不能换：

1. **看参考图，写验收清单。** 照 [assets/asset-plan.example.json](assets/asset-plan.example.json)
   写一份，把决定「这是什么东西」的特征标 `critical: true`。奶牛的斑纹和角是 critical，
   奶瓶上的字不是。清单先写死，后面每一段都对着它验。`godot` 一栏写进游戏后的真实
   尺寸（米）、原点、朝向、要不要碰撞，拿不准就问用户。
2. **确认这一段该谁做。** 见下面的路由表。选错工具比做得糙代价大得多 ——
   用错工具通常要整段重来。

## 路由表

| 要做的东西 | 默认用 | 为什么是它 |
| --- | --- | --- |
| 设定图、概念图、风格探索 | `generate_image` | 迭代最快，改一版几十秒 |
| 四视图 / 转身图 | `generate_image` + `reference_images` + 明确保留项 | 图生 3D 的原生输入形态，逐张核对一致性 |
| 底模、blockout | `generate_3d_model` | 比脚本堆基本体强一个量级 |
| 尺寸、朝向、原点、碰撞 | 包装场景（`.tscn` 文本） | 不动 glb 本身，重新生成后包装照样生效 |
| 远近细节（LOD） | Godot 导入时自动生成 | 默认就开着，不用手做 |
| 改造型、改拓扑、减贴图、加结构细节 | Blender | Godot 里没有对应能力 |
| 从零做**简单**模型（箱体、管件、旋转体、规则构件） | Blender，或 Godot 里的 CSG / 基本网格 | 参数化几步就到位，比生成更可控 |
| 从零手搓**复杂有机**造型 | 默认不做 | 见下面「已知会失败的做法」 |

拿不准「简单还是复杂」时的判据：**能不能用轮廓挤出、旋转、阵列、倒角、镜像
这几步说清楚**。能，就是简单模型；说不清，就是复杂造型，走生成 + 精修。

## Workflow

1. **读参考图，写 `asset-plan.json`。** 分开记录三件事：看得见的观察、用户明确的要求、
   推断出来的隐藏结构。标清哪些特征是 critical。参考图存进工作目录并记下路径。
2. **补齐视图。** 只有一张参考图时，先用 `generate_image` 补出四视图再去生成。
   一致性怎么保证见 [references/four-view-consistency.md](references/four-view-consistency.md)。
   出图时就按输入图标准写提示词（纯色背景、均匀光、无阴影、物体完整入画）——
   标准见 [references/prompt-and-params.md](references/prompt-and-params.md)。
   用户只给了一张、也不想多花这一步的，直接单图生成也行，但要告诉用户背面是模型猜的。
3. **生成底模。** `generate_3d_model`，`format` 用默认的 glb。提示词怎么写、`quality`
   怎么按用途选、多视图和种子怎么用，见 [references/prompt-and-params.md](references/prompt-and-params.md) ——
   **生成结果差八成是输入差**，不要一律选 high 了事。各家厂商真正支持哪些参数见
   [references/capability-map.md](references/capability-map.md) —— 那份表里的限制是**实测过的**，
   选错组合会直接报错或者被静默忽略。
4. **验收第一次。** 拿厂商附的预览图对着清单逐条打勾。**只许说「第 3 条缺」，
   不许说「挺接近的」。** 底模阶段只验形和比例，不验拓扑和细节。
5. **放进工程。** 返回的 `model_path` 用 `run_shell_command` 复制到
   `res://models/<name>.glb`。再写一个包装场景 `res://models/<name>.tscn`：
   根节点 Node3D，下面实例化这个 glb，缩放、旋转、位移都写在这个实例上；
   要挡人就再加 StaticBody3D + CollisionShape3D（BoxShape3D 按计划尺寸）。
   关卡里用的是包装场景，不直接用 glb。写法见
   [references/capability-map.md](references/capability-map.md) 的「Godot 侧」一节。
6. **验收第二次：在关卡里看。** 把包装场景实例化进它真正要去的关卡，`godot_check` 无报错后
   `godot_screenshot` 拍关卡。只对面数不算验收，生成件最常错的是这几处：
   - **尺寸**：生成器出的多是归一化大小（最长边约 1 米、原点在中心）。拿画面里的
     玩家角色当尺子，对着计划的 `size_m` 算出倍数写进实例的 `scale`。
   - **朝向**：**不要假设**模型正面朝哪。不同厂商、不同次生成都可能不一样
     （实测见过正面朝 +X 的）。在截图里看清正面朝向后再转，转完再拍一张确认。
   - **原点**：落地道具要贴地。原点在中心时把实例往上抬半个高度，别让每个摆放点去补偏移。
   - **基础色里烘死的光影**：`shaded` 一定是烘的，`pbr` 也可能把投影、AO 画进基础色 ——
     换个方向打光它们不动。截图里看到「背光面也亮着高光」就是烘了，回第 2 步换均匀光的输入图。
   - **贴图开销**：每个模型常带几张 2048 贴图，低模小道具用不着。这件 Godot 里改不了，
     告诉用户，要压就走 Blender。

## Constraints

- **图生 3D 出的一律是静态网格，没有骨骼。** 再好看也不能直接做动画。
  别拿 T-pose 选项冒充带绑定。唯一的例外是 Tripo 生成的角色或动物：可以把返回的
  `job_id` 交给 `rig_3d_model` 自动绑骨（另扣一笔，只出骨架不带动画，`format` 选 glb）。
  别家生成的要在 DCC 里手动绑，说清这条流程给不了。
- **生成器出的拓扑不是成品拓扑。** 背景件够用，主角要重拓扑。把底模当 blockout 看待。
- **一张预览渲染图不能代替在游戏里看。** 尺寸、朝向、穿模、落地，图上一样都看不出来。
- **多参考图的顺序就是朝向：`正面 → 左 → 背 → 右`。** 三家都真的吃整组图，
  但顺序错了不报错 —— 出来的是一个左右颠倒的模型。只给两张时它们被当成
  「正面 + 左」，所以手上只有正面和背面时要么补齐四张、要么只传正面那一张。
- **整批资产要比例一致时生成时就要定**：`bounding_box`（Rodin）或 `auto_size`（Tripo）。
  进工程之后再一个个调，是把同一件事做 N 遍。
- **不手改 glb 旁边的 `.import` 里的 uid**，也不碰 `.godot/`。改尺寸朝向就改包装场景。
- 生成会把参考图传到用户配置的外部厂商。这是把内容发出去，动手前让用户知道。

## 已知会失败的做法

**不要用脚本摆一堆基本体去拼有机造型**（不论是 Blender Python 还是 Godot 的 CSG）。
这是实测过的失败模式：球和方块拼出来的东西各部件互不相连，轮廓、体积和衔接都对不上，
越调越偏，最后交出去的是个「像是那个东西」的替身。

**不要跟自己的上一版比。** 每一轮都要对着**原始参考图**逐条验。
「比上一版好」和「符合要求」是两件事，把前者说成后者就是虚报。

## Failure Handling

- **同一个缺陷连续三次没修好，停下来换方法。** 不要试第四次。这时候要怀疑的是
  表示方法选错了，或者输入不够（缺视图、缺尺寸、缺材质说明）。如实报告差距，不许悄悄降低要求。
- **验收不过就不要往下一段送。** 底模形不对，放进关卡和进 Blender 精修都救不回来。
  修最早出问题的那一段。
- **厂商任务超时不等于失败。** 状态未知时先查任务，不要盲目重交 —— 重交是再付一次全款。
- **工具报了 success 不等于事情成了。** 在关卡截图里看到了才算。
- **先便宜后贵。** 一个生成任务验过再批量；`quality` 按用途选；能在包装场景里修的不进 Blender。
- **波及面**：这条流程只新建资产。要**替换**关卡里已摆好的旧模型时，先用
  `grep_local_files` 在 `**/*.tscn` 里搜旧文件的 `res://` 路径，找出所有用到它的场景，
  换完每个场景都 `godot_check` 一遍。

## Escalation

以下情况超出这条流程，要换路或者问用户：

- 要可动画的角色、毛发、布料 —— 这条流程只做静态网格（Tripo 生成的可以用 `rig_3d_model` 补一副骨架）。
  骨架有了，动画还要用户在 Godot 的高级导入里做重定向，或另找动画资源。
- 用户一个 3D 生成服务都没配 —— 告诉用户到 偏好设置 → 模型来源 加一个，
  然后问是先配还是改走 Blender 手做。
- 参考图本身信息不足（只有正面、看不出厚度、关键结构被遮住）—— 说清哪一处推断不了，
  让用户补图或者接受推断结果，不要闷头猜完当成事实。
