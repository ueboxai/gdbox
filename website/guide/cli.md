# 命令行 gdbox

从终端或脚本调用 GDBox 的 Godot 能力，供自动化流程和外部 Agent 使用。

`gdbox` 自己不起 Godot、不连编辑器。它把命令交给正在运行的 GDBox，由 GDBox 起一个无头 Godot，或者转给装了 GDBox Link 的编辑器。

前提：

- GDBox 正在运行，并且 设置 → MCP 里的「开放给外部客户端」开着（默认开）。
- 检查、试玩、截图要求 GDBox 找得到 Godot 4（设置 → 项目 → Godot 编辑器）。
- `editor_*` 工具要求目标项目在 Godot 编辑器里打开，并启用了 GDBox Link。列工具、看帮助、无头检查和截图都不需要编辑器。

常用命令七条：`ask`、`doctor`、`projects list`、`tools list`、`tools show`、`tools call`、`screenshot`。另有一组 `team` 命令给外部团队用，见[外部团队](#外部团队)。

## 安装

随 Windows 和 macOS 安装包分发，不需要单独安装，也不需要配置。它每次运行时读取 GDBox 自己的配置文件，不复制令牌，GDBox 里重置令牌后无需改动。

**设置 → 命令行** 显示程序位置，可以复制路径或在文件夹中显示。旁边有「**加入 PATH**」，开启后新开的终端可以直接敲 `gdbox`。这一项只影响当前用户，随时可以关掉。

Linux 包不带命令行工具。

## 先跑一条

```bash
gdbox doctor
```

逐层检查：连接 → 接口契约 → 工具范围 → 工程，并指出卡在哪一层，每条失败附带下一步。没有编辑器连着不算失败，只给一条提示。加 `--project <path>` 可同时确认指定项目是否可作为目标。

`doctor` 是一次体检，不用在每条命令前运行。

## 两种用法

| 用法                      | 适合                                   |
| ------------------------- | -------------------------------------- |
| `gdbox ask "<要做的事>"`  | 一句话交给 GDBox 的 Agent，由它决定步骤 |
| `gdbox tools call <工具>` | 你知道要调哪个工具，自己控制每一步     |

## ask：交给 GDBox 的 Agent

```bash
gdbox ask "检查主场景里的脚本有没有报错"
gdbox ask "给主角加二段跳并验证" --allow-write
```

| 规则        | 说明                                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------ |
| 默认只读    | 子任务的工具清单里没有写工具。加 `--allow-write` 才放开改动                                                  |
| 范围固定    | 只碰 Godot 工具、项目文件（读写，不含 shell）、素材库和项目库。shell、浏览器、第三方 MCP 不提供，加了 `--allow-write` 也不提供 |
| 带上项目    | 定下目标项目时，子任务拿到它的路径；那个项目的编辑器连着时还会绑到它                                         |
| 模型与费用  | 默认用 GDBox 里配置的模型；配了多个模型时，可用 `--model <id>` 指定，费用记在实际用的模型上                  |
| 进度与结论  | 进度输出到 stderr；结论在 `data.answer`                                                                      |
| `--timeout` | 按**多久没有任何进度**计算，不是总时长。持续汇报进度的长任务不会超时                                         |
| 无历史对话  | 每次 `ask` 从零开始，不记得上一次的内容                                                                      |

`tools call task` 会被拒绝，派子任务请用 `ask`。

## tools：调用单个工具

```bash
gdbox projects list                    # 「我的项目」里的 Godot 项目和编辑器连接
gdbox tools list                       # 可调用的工具
gdbox tools list --search editor       # 按名字或描述筛
gdbox tools list --allow-write         # 连写工具一起列
gdbox tools show godot_check           # 某个工具的完整描述和参数定义
gdbox tools call editor_scene_tree     # 编辑器里当前打开的场景树
gdbox tools call godot_check --args-file check.json
```

判定规则：**GDBox 里的 AI 助手可用的工具，在 CLI 中加 `--allow-write` 均可调用。** 素材库搜索、生成精灵和音效、项目库整理都在内。两类除外：要求逐次人工审批的工具（例如 `browser_interact`、`connect_mcp_server`），以及派子任务的 `task`（请用 `ask`）。

常用的几个：

| 工具                          | 要编辑器 | 作用                                       |
| ----------------------------- | -------- | ------------------------------------------ |
| `godot_check`                 | 否       | 无头导入并运行若干帧，报脚本和引擎错误     |
| `godot_run`                   | 否       | 按脚本输入试玩几秒，报属性随时间的变化     |
| `godot_screenshot`            | 否       | 屏幕外跑若干帧，取最后一帧                 |
| `editor_scene_tree`           | 是       | 读编辑器里当前打开的场景树                 |
| `editor_play` / `editor_stop` | 是       | 在编辑器里运行 / 停止游戏（写操作）        |
| `editor_save_all`             | 是       | 保存编辑器里所有打开的场景（写操作）       |

无头工具的参数里有 `project_path`：没填时 CLI 用 `--project` 或当前目录所在的项目补上。

工具名也可以用 `--name <tool>` 传入，位置参数不方便传时使用。

`--args` 中直接写 JSON 需要按所在 shell 转义，未转义的引号会被 shell 去掉：

```bash
# PowerShell
gdbox tools call editor_scene_tree --args '{\"max_depth\":3}'
```

```bash
# cmd
gdbox tools call editor_scene_tree --args "{""max_depth"":3}"
```

也可以使用 `--args-file <文件>`，或 `--args-file -` 从标准输入读取。

## 截图

```bash
gdbox screenshot --output shot.png --overwrite
gdbox screenshot --scene res://levels/level_1.tscn --frames 90 --output level1.png
```

背后是 `godot_screenshot`：起一个屏幕外的 Godot 跑若干帧，取最后一帧。不需要编辑器开着，也不打扰你正在用的编辑器。

| 选项                  | 说明                                          |
| --------------------- | --------------------------------------------- |
| `--output <path>`     | **必填**，只接受 `.png`，相对路径按当前目录算 |
| `--scene <res://...>` | 拍哪个场景，默认主场景                        |
| `--frames <n>`        | 截图前跑多少帧（60 fps），默认 30             |
| `--overwrite`         | 允许覆盖已存在的文件                          |

交付的是原图，只有压缩预览时命令失败（退出码 8）。先写临时文件再改名，失败时原有文件不动。

## 改东西

写操作都要加 `--allow-write`。

命令行没有审批弹窗，`--allow-write` 相当于那一下确认。

另外，设置 → MCP 里「外部客户端的权限」默认是可写。如果被改成只读，写工具不会出现在工具清单里，`gdbox doctor` 会指出这一点。

核实以工具自己的返回值为准。改完脚本或场景之后跑一遍 `godot_check`，有报错就别当作做完。

::: warning 超时不要直接重发
请求可能已经生效。先用只读工具（`editor_scene_tree`、`godot_check`、`project_list`）查清楚，再决定要不要重发。
:::

## 目标项目怎么定

按这个顺序：

1. `--project` 指定的（`project.godot` 文件或它所在目录）
2. 从当前目录逐层往上找到的最近的 `project.godot`
3. 前两步都没有时，**恰好只有一个 Godot 编辑器连着**才用它的项目

`editor_*` 工具：前两步定出来的项目如果编辑器没连着，命令直接失败（退出码 5），**不会改发给别的编辑器**。无头工具不看编辑器，项目目录直接作为参数交过去。

同时开着多个编辑器时，每条命令都带 `--project`。`ask` 在定不下项目时也能运行，只是只能用素材库和项目库。

## 公共选项

| 选项                  | 说明                                                               |
| --------------------- | ------------------------------------------------------------------ |
| `--json`              | stdout 只输出一个 JSON 对象，诊断走 stderr                         |
| `--project <path>`    | 目标项目，`project.godot` 文件或其所在目录                         |
| `--allow-write`       | 允许这条命令改动项目                                               |
| `--model <id>`        | `ask` 用哪个模型，GDBox 里配了多个模型时才能选                     |
| `--timeout <秒>`      | 整条命令的期限，默认 **120**；`ask` 算的是多久没有进度             |
| `--lang zh-CN\|en-US` | 帮助与提示的语言                                                   |
| `--config <path>`     | GDBox 装在非常规位置时，指定它的配置文件；也可设 `GDBOX_HOST_CONFIG` |
| `-h, --help`          | 完整帮助                                                           |
| `-v, --version`       | 版本号                                                             |

公共选项写在子命令前面或后面都行。

## 退出码

脚本靠它决定下一步：

| 码    | 含义                                                   |
| ----- | ------------------------------------------------------ |
| `0`   | 成功。查询结果为空也算成功                             |
| `2`   | 命令、参数或输出位置要改                               |
| `3`   | 配置或认证                                             |
| `4`   | GDBox 不可达，或版本不支持                             |
| `5`   | 定不下唯一的目标项目，或它的编辑器没连着               |
| `6`   | 工具超出范围，或是写工具但没加 `--allow-write`         |
| `7`   | 超时。请求可能已经发出，结果不明，**先核实再重发**     |
| `8`   | 工具执行失败，或文件没交付                             |
| `130` | 用户中断。**不代表已经发出的操作被撤销**               |

不会返回 `1`。收到 `1`，说明进程在 CLI 接手之前就崩了。

## `--json` 输出

`--json` 时 stdout 只有一个 JSON 对象，成功和失败都一样：

```json
{
  "schemaVersion": 1,
  "ok": true,
  "project": { "name": "Demo", "path": "D:/Games/Demo" },
  "data": {},
  "artifacts": [],
  "warnings": []
}
```

`data` 和 `error` 互斥，`artifacts` 和 `warnings` 始终是数组。进度和诊断走 stderr。

## 外部团队

让 Claude Code 这类外部客户端当制作人跑团队模式时用，GDBox 只管名册、任务板、文件锁、编辑器排队、项目快照和验收记录，不调用模型。

```bash
gdbox team list --json              # 外部团队：id、目标、验收结论
gdbox team status <id> --json       # 某个团队的交付闸现状，data.passed 为 true 才算过了验收
gdbox team use <id>                 # 把当前目录绑到这个团队（写 .gdbox/team.json）
gdbox team gate --hook              # Claude Code 的 Stop hook：没过验收就拦
gdbox team round --hook             # UserPromptSubmit hook：新一轮清零
```

- `--hook` 时按 Claude Code hook 的约定输出，任何意外都放行、退出码 0。
- 这组命令里的 `--project <目录>` 指「哪个目录的 `.gdbox/team.json`」，默认当前目录。
- 验收通过之后项目又被改过，`passed` 会变回 false，要重新验。

## 自动化环境

在 CI 等无法读取 GDBox 配置文件的环境，用环境变量直接指定地址和令牌：

```bash
GDBOX_URL=http://127.0.0.1:17871/ GDBOX_TOKEN=... gdbox projects list --json
```

两个变量必须成对给出，只接受本机回环地址，只在进程内使用，不落盘。端口默认 17871，可在 设置 → MCP 里改。

## 已知限制

- 要求逐次人工审批的工具不能调用。
- 依赖 GDBox 和本命令在同一台机器上（截图要从本地磁盘读回原图）。
- Windows 是首个正式验收平台。

## 相关

- [MCP](/guide/mcp) —— 另一条对外通道，给 Claude Code、Cursor 这类客户端用
