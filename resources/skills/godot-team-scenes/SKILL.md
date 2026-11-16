---
name: godot-team-scenes
description: Keeps Godot scene and project files safe to share - editing a .tscn the user has open without losing their unsaved work (editor_save_all first), splitting scenes so teammates do not edit the same file, what belongs in git (.import and .uid yes, .godot no), and resolving .tscn and project.godot merge conflicts by reading both sides node by node and checking for dangling ExtResource references. Use when the user mentions 队友、多人协作、合并冲突、git merge 后场景打不开、.tscn 冲突、project.godot 被合并了、拆场景、哪些文件要提交, or before editing a scene that is open in their editor. Do not use for writing gameplay code, for generating assets, or for pushing, opening pull requests or any other action on the remote repository.
---

# 场景文件的协作与合并

`.tscn` 和 `project.godot` 是文本，git 能合并 —— 但它按行合并，不懂节点树。于是两种坏事：
**冲突块看不懂**（git 把两段不相干的节点对齐在一起），和**没冲突却坏了**（引用在冲突区外面，
或者 `project.godot` 被悄悄拼在一起，没人看过）。这条 skill 管三件事：改的时候别踩到人，
文件结构让冲突少发生，冲突发生时按节点而不是按行去解。

## Quick Start

- 改用户可能开着的场景 → 先 `editor_scene_tree` 看打开了哪些，开着就 `editor_save_all`，再改。
- 合并冲突 → 读三份（共同祖先、我方、对方），按节点路径对齐，解完查悬空引用，`godot_check` 每个冲突过的场景。
- 每次合并后（哪怕没冲突）→ 把 `project.godot` 的变化列给用户看。

## Workflow

### 1. 改场景之前

- `editor_scene_tree` 会列出编辑器里打开的场景。要改的在里面，先 `editor_save_all`：
  用户没存的改动先落盘，你的修改基于最新的文件。写完后编辑器会从磁盘重新加载这个场景。
- 用 `edit_local_file` 改需要改的几行，**不要整文件重写**：重写会打乱 `ext_resource` 顺序、
  丢掉你没注意到的属性，在 git 里是一大片无意义的 diff。
- 新加的 `ext_resource` / `sub_resource` 用一个文件里没用过的 id（如 `5_coin`），
  已有的 id 和 `uid://` 一个都不改。
- 改了 `project.godot`（输入映射、自动加载、显示设置）要单独告诉用户：它是全队共用的，
  而且编辑器开着时要「项目 → 重新加载当前项目」，否则编辑器会把旧版写回去。

### 2. 让冲突少发生

在用户要求或项目开始时建议，不要擅自重构别人的场景：

- **按负责人拆子场景**。关卡布局、刷怪点、关卡逻辑分成三个 `.tscn`，主关卡把它们实例化进来。
  策划改刷怪点只动 `room_01_spawns.tscn`，和程序改的文件不重叠。
- 刷怪点、触发区这类策划会调的东西，用 Marker2D / Area2D 节点 + `metadata/` 属性标类型，
  比写在脚本常量里更好改、更好合并。
- 哪些进 git：
  - `.gitignore` 里只放 `.godot/`（以及导出目录）。
  - `.import` 和 `.uid` 文件**要提交**：它们存着导入设置和 uid，丢了队友那边引用会断，
    像素过滤、循环这类设置也会丢。
  - 不是游戏资源的目录（`docs/`、美术源文件）里放一个空的 `.gdignore`，Godot 就不去导入它们。

### 3. 解 `.tscn` 冲突

1. 读三份，不要只看带冲突标记的那一份：
   `git show :1:<路径>`（共同祖先）、`:2:`（我方）、`:3:`（对方）。
   再看 `git log --oneline -5 -- <路径>` 两边各做了什么 —— 一边把节点拆到了别的场景、
   另一边还在旧位置上改，冲突块就会长得像乱码。
2. **按节点对齐，不按行**。每个 `[node name="…" parent="…"]` 是一个单位：
   列出两边各自新增、删除、修改了哪些节点，写成一张表给用户。两边都改了同一个节点的同一个属性，
   才是真冲突，要用户拍板；其余的两边都保留。
3. `ext_resource` / `sub_resource` 取**并集**。两边用了同一个 id 指向不同的资源时，
   给其中一边换个新 id，并把它在这边节点里的 `ExtResource("…")` 引用一起改掉。
4. 对方是在旧结构上改的（节点已被拆走）：取我方的结构，把对方的**意图**搬到新位置
   （例如把对方改的坐标搬进新的子场景），并在汇报里说清楚搬了什么。
5. **查悬空引用**（冲突区外面的引用 git 不会提醒）：解完后在文件里列出所有
   `ExtResource("…")` 和 `SubResource("…")` 用到的 id，逐个确认上面有声明；声明了却没人用的，
   确认是不是解冲突时删掉了引用它的节点。
6. `grep_local_files` 确认文件里不再有 `<<<<<<<`、`=======`、`>>>>>>>`。
7. `godot_check` 用 `scene` 逐个跑冲突过的场景，再跑一次主场景；能截图的 `godot_screenshot`
   拍一张给用户对比。

### 4. `project.godot`：没冲突也要看

git 常常把两边对 `project.godot` 的改动自动拼在一起，不报冲突，也没人审。每次合并后：

- `git diff <合并前的我方提交> -- project.godot`，把新增和改动的键列给用户：
  谁加了输入映射、谁改了窗口尺寸或过滤方式、谁加了 autoload。
- 同一段里出现重复的键（两边各加了一行同名设置），留一行，问用户留哪个值。

## Constraints

- 只在本地做：合并、解冲突、提交都可以在用户要求时做；`git push`、开 PR、改远程分支前先问用户。
- 解冲突用 `edit_local_file` 精确替换冲突块，不要用脚本批量改 —— 一个正则写错就能把整段节点吞掉。
- 不碰 `.godot/`，不编 uid。冲突两边的 uid 不一样时，以 `.uid` / `.import` 文件里记录的为准。

## Failure Handling

| 现象 | 处理 |
| --- | --- |
| 合并后打开场景报找不到资源 | 悬空引用，按第 3 步第 5 条查 |
| 用编辑器打开再保存后出现一大片 diff | 编辑器重排了 `ext_resource`，内容没变。告诉用户这是格式规范化，可以单独提交一次 |
| 冲突块里两边是完全不相干的节点 | git 错位对齐了。别在冲突块里拼，按节点表重建这一段 |
| 解完 `godot_check` 报重复的 id | 两边的 `ext_resource` 用了同一个 id，按第 3 步第 3 条改名 |

## Escalation

- 冲突涉及两边都改过的玩法数值或关卡布局：列出两边的值，让用户（或对应的负责人）决定，
  不要按「新的覆盖旧的」自己定。
- 场景是二进制的 `.scn`：没法按文本合并。请用户在编辑器里手动取舍，并建议改存为 `.tscn`。
