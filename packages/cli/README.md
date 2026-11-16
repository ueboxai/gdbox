# gdbox — GDBox 命令行

从终端调用 GDBox 的 Godot 能力。给外部 Agent（Codex、Claude Code 等）、自动化脚本和 CI 用。

English TL;DR: `gdbox` is a standalone CLI that connects to a running GDBox over local
loopback. `gdbox tools call` runs one of GDBox's tools; `gdbox ask` hands a whole task to
GDBox's own agent; `gdbox screenshot` runs the game headless and saves a frame as a PNG.
Read-only unless you pass `--allow-write`. No setup step. Exit codes are meaningful;
`--json` prints exactly one JSON object on stdout. Full help: `gdbox --help --lang en-US`.

## 它是什么

```
你 / Agent  →  gdbox  →  GDBox  ─┬→  无头 Godot（检查、试玩、截图）
                                  └→  GDBox Link 插件  →  你开着的 Godot 编辑器
```

`gdbox` 自己不起 Godot、不连编辑器。它把命令交给正在运行的 GDBox，由 GDBox 起一个
无头 Godot，或者转给装了 GDBox Link 插件的编辑器。所以用它之前，GDBox 要开着。

两种用法：

- **`tools call`**：调 GDBox 的某一个工具，零件照原样递过去。你知道每一步该调什么时用。
- **`ask`**：把一句话交给 GDBox 自己的 Agent，它想步骤、做完、交回结论。给脚本和批处理用。

和 MCP 的分工：MCP 把工具交给自己有大脑的客户端；CLI 多一个 `ask`，而且不用把
上百个工具的说明常驻在调用方的上下文里。

**默认只读。** 要改东西，命令上必须显式加 `--allow-write`。命令行没有审批弹窗，命令一发出就执行，
这个开关代替了弹窗。

## 命令一览

常用的七条，外加外部团队的 `team` 一组（见下文「外部团队」）：

| 命令                    | 作用                                            |
| ----------------------- | ----------------------------------------------- |
| `gdbox ask "<任务>"`    | 把任务交给 GDBox 自己的 Agent，返回结论         |
| `gdbox doctor`          | 逐层体检：连接、接口契约、工具范围、工程        |
| `gdbox projects list`   | 列出「我的项目」里的 Godot 工程和编辑器连接     |
| `gdbox tools list`      | 列出可调用的工具（加 `--allow-write` 含写工具） |
| `gdbox tools show <名>` | 某个工具的完整说明和输入 schema                 |
| `gdbox tools call <名>` | 调用一个工具                                    |
| `gdbox screenshot`      | 无头运行游戏，把画面存成 PNG 文件               |

通用选项：`--json`、`--project <路径>`、`--allow-write`、`--timeout <秒>`（整条命令的期限，默认 120）、
`--config <路径>`、`--lang zh-CN|en-US`。完整说明：`gdbox --help`。

## 前提

1. GDBox 正在运行（对外服务默认开着，除非你在「设置 → MCP → 共享引擎能力」里关过）；
2. 检查、试玩、截图要在 GDBox 的偏好设置里指定过 Godot 4（找不到时工具会直说）；
3. `editor_*` 工具要用 Godot 编辑器打开目标工程，并在「项目设置 → 插件」里启用 GDBox Link。

列工具、看帮助、无头检查和截图都不需要编辑器开着。

## 上手

```bash
gdbox doctor
```

不用先配置。CLI 每次运行都去读 GDBox 自己那份配置文件（userData 下的 `mcp-server.json`）：
正式版在 `%APPDATA%\GDBox\`，开发版在 `%APPDATA%\gdbox\` —— Windows 和 macOS 的文件系统不分
大小写，这两处其实是同一个目录。它不复制令牌，GDBox 里重置令牌之后什么都不用改。

GDBox 装在非常规位置时，显式指定：

```bash
gdbox doctor --config "C:\Users\你\AppData\Roaming\GDBox\mcp-server.json"
```

或者设环境变量 `GDBOX_HOST_CONFIG`。

`doctor` 逐层检查连接、接口契约、工具范围、工程。卡在哪一层就报哪一层，每条失败
都带能照着做的下一步。没有编辑器连着不算失败（无头工具照样能用），只给一条提示。
它是一次完整体检，开销比 ping 大，不要放在每条命令前面跑。

## ask

```bash
gdbox ask "检查主场景里的脚本有没有报错"
gdbox ask "给主角加二段跳并验证" --allow-write --json
```

背后是 GDBox 的 `task` 工具，不带历史对话。五条规矩：

- **默认只读。** 不加 `--allow-write` 时，子任务的清单里根本没有写工具。
- **范围固定。** 只碰 Godot 工具（`godot*`）、工程文件（`local`：读写文件，不含 shell）、
  素材库、工程库。shell、浏览器、第三方 MCP、GDBox 自身的管理一律不给 —— 外部会话里
  子任务每一步都是自动批准的，没人盯着的时候这些出了错没有回头路。
- **工程目录会写进任务里。** 定下目标工程时，子任务拿到它的路径；那个工程的编辑器连着时
  还会绑到它，编辑器没连着只是用不了 `editor_*`。
- **进度打在 stderr。** 结论在 `data.answer`。
- **`--timeout` 算的是多久没有进度**，不是总时长。一直在汇报的长任务不会被判超时。

默认用 GDBox 里配置的模型。GDBox 里配了多个模型时，用 `--model <id>` 指定一个，id 写错了报错里会列出可选的；
只配了一个模型时 `--model` 直接报用法错误。费用记在实际用的模型上。

`gdbox tools call task` 会被拒绝：直接调不带上面的范围限制。

## tools

```bash
gdbox projects list --json
gdbox tools list --search editor --json
gdbox tools show godot_check --json
gdbox tools call editor_scene_tree --json
gdbox tools call godot_check --args-file ./check.json --json
gdbox tools call editor_save_all --allow-write --json
```

判据一句话：**GDBox 自己的 AI 助手能用的，这里加 `--allow-write` 都能调** —— 搜素材库
（`search_assets`）、生成精灵和音效（`gen_*`）、整理工程库（`project_organize`）都在里面。

常用的几个：

| 工具                          | 要编辑器 | 作用                                                   |
| ----------------------------- | -------- | ------------------------------------------------------ |
| `godot_check`                 | 否       | 无头导入并运行若干帧，报脚本和引擎错误                 |
| `godot_run`                   | 否       | 按脚本输入试玩几秒，报属性随时间的变化                 |
| `godot_screenshot`            | 否       | 屏幕外跑若干帧，取最后一帧（用 `screenshot` 命令落盘） |
| `editor_scene_tree`           | 是       | 读编辑器里当前打开的场景树                             |
| `editor_play` / `editor_stop` | 是       | 在编辑器里运行 / 停止游戏（写操作）                    |
| `editor_save_all`             | 是       | 保存编辑器里所有改动（写操作）                         |

无头工具的参数里有 `project_path`：没填时 CLI 用 `--project` 或当前目录所在的工程补上。

复杂参数写成 JSON 文件用 `--args-file`，可以躲开各家 shell 的引号差异；写 `-` 表示从
标准输入读。

要在 `--args` 里直接写 JSON，裸 JSON 在 Windows 的 PowerShell 和 cmd 里都会因为引号被吃掉而报
「不是合法 JSON」。可用的写法：

```powershell
gdbox tools call editor_scene_tree --args '{\"max_depth\":3}'
```

```bat
gdbox tools call editor_scene_tree --args "{""max_depth"":3}"
```

## 外部团队

让 Claude Code 当大脑跑 GDBox 的团队模式（盒子只当工作室，不调模型）时用。
打法和插件见 [claude-plugin/README.md](claude-plugin/README.md)。

```bash
gdbox team list --json              # 外部团队：id、目标、验收结论
gdbox team status ext-… --json      # 某个团队的交付闸现状
gdbox team use ext-…                # 把当前目录绑到这个团队（写 .gdbox/team.json）
gdbox team gate --hook              # Claude Code 的 Stop hook：没过验收就拦
gdbox team round --hook             # UserPromptSubmit hook：新一轮清零
```

- `--hook` 时不出信封，按 Claude Code hook 的约定输出；任何意外都放行、退出码 0。
- `--project <目录>` 在这组命令里指「哪个目录的 `.gdbox/team.json`」，默认当前目录。

### 没有插件的客户端（Kimi Code、Codex、Cursor……）

任何能连 MCP 的客户端都能跑外部团队，不需要插件。关键是**通行证**（`team_seat`）：

- 制作人调 `team_open`、队员和验收员调 `team_join`，返回的第一行就是自己的通行证。
- 之后每次调用盒子的工具都带上它：参数里加 `"team_seat": "…"`（每个工具的参数表里都有这一项），
  能发 `_meta` 的客户端也可以放在 `_meta.unrealBox.teamSeat`。
- 盒子按通行证认人，不按连接。所以子 Agent 和主会话共用一条 MCP 连接也分得清；连接断了、
  盒子重启了，带着同一张通行证接着干就行。
- 一条连接上进过两个角色之后，不带通行证的调用会被拒绝 —— 盒子不猜这次是谁。

制作人怎么起队员：用客户端自己的子 Agent（Kimi Code 的子任务、Codex / Cursor 的子 Agent 都行），
在子 Agent 的提示里写清三件事：

```text
team_id: ext-…
member: 程序            # 和 team_hire 登记的名字一字不差；验收员写 acceptor
assignment: 这件活要做什么，连同它需要的背景
先调 team_join（不带 team_seat），之后每次调用都带上它返回的 team_seat，干完调 team_report。
```

- 别把制作人自己的通行证给子 Agent。每个子 Agent 进门时自己领一张。
- 验收员要另起一个**没干过活**的子 Agent，`team_join` 时 `member` 写 `acceptor`，
  带上交付说明（`report`）和怎么玩（`how_to_play`）。干过队员的通行证当不了验收员。

没有 hook 时怎么守交付闸：制作人回复用户之前自己查一次。

```bash
gdbox team status ext-… --json     # data.passed 为 true 才算过了验收
```

或者直接调 `team_gate`（带 `team_id`）。验收 PASS 之后工程又被改过，`passed` 会变回 false，要重新验。

## 截图

```bash
gdbox screenshot --output ./artifacts/shot.png --overwrite --json
gdbox screenshot --scene res://levels/level_1.tscn --frames 90 --output ./level1.png
```

- 背后是 `godot_screenshot`：起一个屏幕外的 Godot 跑若干帧（默认 30，60 fps），取最后一帧。
  不需要编辑器开着，也不打扰你正在用的那个编辑器。
- `--output` 只接受 `.png`，路径相对当前目录；目标文件已存在时必须加 `--overwrite`。
  这一条在连 GDBox 之前就判，不会白跑一遍 Godot。
- 交付的是原图：读 GDBox 报的原图文件，或结果里未经压缩的 PNG。只有压缩预览时
  命令失败（退出码 8），不会拿预览冒充原图。
- 写到目标目录里的临时文件再改名，失败时原有文件不动。

## 写操作

核实看工具自己的返回值。改完脚本或场景之后跑一遍 `godot_check`，有报错就别说做完了。

超时不报成功也不报失败，退出码 7、结局不明。**不要直接重发** —— 先用只读工具查清楚
（`editor_scene_tree`、`godot_check`、`project_list`）。

## 目标工程怎么定

1. 显式 `--project`（`project.godot` 文件或它所在目录都行）
2. 从当前目录逐层往上找最近的 `project.godot`
3. 都没有时，**只有恰好一个** Godot 编辑器连着才自动采用它的工程

`editor_*` 工具：前两种方式定出来的工程如果编辑器没连着，命令会失败（退出码 5），
不会改发给另一个开着的编辑器。无头工具不看编辑器，工程目录直接作为参数交过去。

同时开多个编辑器时，每条命令都带 `--project`。`ask` 在定不下工程时照跑，只是只能用
素材库和工程库。

## 输出与退出码

`--json` 时 stdout 只有一个 JSON 对象加一个换行，成功失败都一样：

```json
{
  "schemaVersion": 1,
  "ok": true,
  "project": { "name": "Demo", "path": "D:/Games/Demo" },
  "data": { "...": "..." },
  "artifacts": [],
  "warnings": []
}
```

`data` 和 `error` 互斥；`artifacts`、`warnings` 永远是数组。进度和诊断走 stderr。

| 退出码 | 含义                                                                                                                              |
| ------ | --------------------------------------------------------------------------------------------------------------------------------- |
| 0      | 完成。查询结果为空也算成功                                                                                                        |
| 2      | 命令、参数或输出位置要改                                                                                                          |
| 3      | 配置或认证不对（`CONFIG_MISSING` 找不到 / `CONFIG_UNREADABLE` 读不了 / `CONFIG_INVALID` 内容坏或有两份 / `AUTH_FAILED` 令牌不对） |
| 4      | GDBox 不可达，或版本太旧不支持 CLI 契约                                                                                           |
| 5      | 定不下唯一的目标工程，或它的编辑器没连着                                                                                          |
| 6      | 写工具但没加 `--allow-write`，或工具超出范围                                                                                      |
| 7      | 超时 —— **先核实现场，不要直接重发**                                                                                              |
| 8      | 工具执行失败，或文件没交付                                                                                                        |
| 130    | 用户中断。**不代表已经发出的操作被撤销**                                                                                          |

不会返回 1。收到 1 说明进程在 CLI 接手之前就崩了。

## 自动化环境

```bash
GDBOX_URL=http://127.0.0.1:17871/ GDBOX_TOKEN=... gdbox projects list --json
```

两个必须成对给（只给一个是配置错误，不会去文件里补另一半），只接受本机回环地址，
只在进程内使用、不落盘。端口默认 17871，可在「设置 → MCP」里改。

## 给 Agent 用的 Skill

`skills/gdbox/` 下有一份可选安装的 Skill，教外部 Agent 使用流程：什么时候跑 `doctor`、
怎么定工程、什么时候用 `ask`、退出码怎么读、超时之后该干什么。它不是运行前提，CLI
可以独立使用。

**不要**把它装进 GDBox 自己的 Agent —— 那个 Agent 手上直接有这些工具，教它绕到命令行
是绕远路，还会占它的上下文。

## 已知限制

- 「设置 → MCP → 外部客户端的权限」设成只读时，写工具根本不在清单里 —— `gdbox doctor` 会说破。
- 要求逐次人工审批的工具不给调。
- 只有一问一答，没有连续对话：`ask` 每次都从零开始，不记得上一次说过什么。
- `projects list` 和第 3 级工程解析要 GDBox 给出结构化的 `project_list` 结果；
  版本不支持时 `projects list` 报不兼容，其余命令用 `--project` 照常可用。
- 依赖 GDBox 和本命令在**同一台机器**上（截图要从本地磁盘读回原图）。
- Windows 是首个正式验收平台。
