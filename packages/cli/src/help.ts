/**
 * 帮助文本，中英两份。
 *
 * 命令名、选项名、字段名和错误码**固定为英文**（§4）—— 它们是接口，翻译过去
 * 就成了两套接口。只有解释性的话有两个版本。
 *
 * `--help` / `--version` 不读凭据、不连服务：用户想知道怎么用的时候，
 * 不该被「先去配置一下」挡住。
 *
 * ## 写这份文本的四条约束（`helpText` 上的测试逐条钉住）
 *
 * 1. **不许出现 Markdown。** 终端不渲染 `**`，用户看见的就是两个星号。
 *    要强调就靠措辞和位置，不靠标记。
 * 2. **每行不超过 80 列（CJK 按 2 列算）。** 超了会在 80 列终端上回绕，
 *    把对齐好的两栏排版拧成一团 —— 那比不对齐更难读。
 * 3. **陈述行为，不论证行为。** 「为什么这么设计」属于源码注释；
 *    帮助里只说它会怎么做。
 * 4. **例子必须是能照抄的。** 尤其 `--args`：PowerShell 5.1 和 cmd 会吃掉
 *    裸 JSON 里的引号（实测：`'{"k":"v"}'` 到进程里变成 `{k:v}`），
 *    所以这里给的是两个 shell 各自验证过的转义形式。
 *
 * ## 只有一层
 *
 * 以前分 `--help` 和 `--help --all` 两层，因为包装命令各带一串专属选项，
 * 全摆出来一百多行。包装命令删掉之后选项只剩十来个，一屏放得下，
 * 分层反而让人多猜一次「是不是还有没看到的」。
 */

export type Lang = 'zh-CN' | 'en-US'

const ZH = `GDBox CLI —— 从终端调用 GDBox 的 Godot 能力

用法：
  gdbox <命令> [选项]

  GDBox 开着就能直接用；连不上就跑 gdbox doctor。

命令：
  ask "<要做的事>"          把一件事交给 GDBox 的 Agent 做完，拿回结论
  doctor                    逐层体检：连接、接口契约、工具范围、工程
  projects list             列出「我的项目」里的 Godot 工程和编辑器连接
  tools list                列出能调用的工具（加 --allow-write 连写工具一起列）
  tools show <name>         某个工具的完整描述和参数定义
  tools call <name>         调用一个工具
  screenshot                无头运行游戏，把画面存成 PNG 文件
  team list / team status [id]  列出外部团队 / 看某个团队的交付闸
  team use <id>             把当前目录绑到这个外部团队
  team gate / team round    收尾检查 / 新一轮清零；Claude Code hook 里加 --hook

示例：
  gdbox ask "检查主场景里的脚本有没有报错"
  gdbox ask "给主角加二段跳并验证" --allow-write
  gdbox doctor
  gdbox tools list --search editor
  gdbox tools call editor_scene_tree
  gdbox tools call godot_check --args-file check.json
  gdbox tools call search_assets --args-file args.json
  gdbox tools call editor_save_all --allow-write
  gdbox screenshot --output shot.png --overwrite

  --args 里直接写 JSON 要按所在 shell 转义，裸 JSON 两边都会被吃掉引号：
    PowerShell   --args '{\\"max_depth\\":3}'
    cmd          --args "{""max_depth"":3}"
  嫌绕就用 --args-file <文件>，或 --args-file - 从标准输入读。

选项（写在命令前面或后面都行）：
  --json                    stdout 只输出一个 JSON 对象；诊断走 stderr
  --project <path>          目标工程，project.godot 文件或其所在目录都行
  --allow-write             允许这条命令改动工程
  --model <id>              ask 用哪个模型，盒子里配了多个模型时才能选
  --search <text>           tools list 按名字或描述筛选
  --args <JSON>             tools call 的参数
  --args-file <path>        从文件读参数；写 - 表示从标准输入读
  --name <tool>             工具名，位置参数不好传时用
  --output <path>           截图存到哪，只接受 .png，相对路径按当前目录算
  --scene <res://...>       截图拍哪个场景，默认主场景
  --frames <n>              截图前跑多少帧（60 fps），默认 30
  --overwrite               截图允许覆盖已存在的文件
  --hook                    team gate/round、team guard 按 hook 约定读写
  --config <path>           GDBox 的配置文件，装在别处时用；
                            或设 GDBOX_HOST_CONFIG
  --timeout <seconds>       整条命令的期限，默认 120
  --lang zh-CN|en-US        帮助与提示用哪种语言
  -h, --help                看这段
  -v, --version             看版本号

ask：
  默认用 GDBox 里配置的模型，--model 可以换一个，费用记在实际用的模型上。
  子任务只碰 Godot 工具、工程文件、素材库和工程库；shell、浏览器、
  第三方 MCP 一律不给。
  不加 --allow-write 时它只能查，不能改。进度打在 stderr 上；
  --timeout 对它算的是多久没有任何进度，不是总时长。

写操作：
  不加 --allow-write 只调只读工具。加了之后，GDBox 自己的助手能用的工具
  这里都能调，要求逐次人工审批的除外。
  超时不要直接重发：请求可能已经生效，先用只读工具查清楚再决定。

目标工程按这个顺序定：--project，从当前目录往上最近的 project.godot，
恰好只有一个 Godot 编辑器连着时用它。editor_* 工具要那个工程的编辑器连着
（GDBox Link 插件）；godot_check、godot_run、screenshot 不需要编辑器。

退出码：
  0     成功
  2     参数或输出位置要改
  3     配置或认证
  4     GDBox 不可达，或版本不支持
  5     定不下唯一的目标工程，或它的编辑器没连着
  6     工具超出范围，或是写工具但没加 --allow-write
  7     超时。请求可能已经发出，结果不明，先核实再重发
  8     工具执行失败，或文件没交付
  130   用户中断。不代表已经发出的操作被撤销

  不会返回 1。真收到 1 说明进程在 CLI 接手之前就崩了。

需要 GDBox 正在运行（对外服务默认开着，除非你在设置里关过）。`

const EN = `GDBox CLI — drive GDBox's Godot tools from your terminal

Usage:
  gdbox <command> [options]

  Works while GDBox is running; run gdbox doctor when it can't connect.

Commands:
  ask "<task>"              Hand a task to GDBox's own agent, get the result
  doctor                    Layered check: connection, contract, scope, projects
  projects list             List Godot projects in My Projects and editor links
  tools list                List callable tools (--allow-write adds writers)
  tools show <name>         Full description and input schema for one tool
  tools call <name>         Call one tool
  screenshot                Run the game headless, save the frame as a PNG
  team list / team status [id]  External teams / one team's delivery gate
  team use <id>             Bind the current directory to an external team
  team gate / team round    Finish check / new round; add --hook in hooks

Examples:
  gdbox ask "check the main scene's scripts for errors"
  gdbox ask "add a double jump to the player and verify it" --allow-write
  gdbox doctor
  gdbox tools list --search editor
  gdbox tools call editor_scene_tree
  gdbox tools call godot_check --args-file check.json
  gdbox tools call search_assets --args-file args.json
  gdbox tools call editor_save_all --allow-write
  gdbox screenshot --output shot.png --overwrite

  Inline JSON in --args must be escaped for your shell; both eat bare quotes:
    PowerShell   --args '{\\"max_depth\\":3}'
    cmd          --args "{""max_depth"":3}"
  Or skip it: --args-file <file>, or --args-file - to read stdin.

Options (before or after the command):
  --json                    Emit one JSON object on stdout; diagnostics stderr
  --project <path>          Target project; project.godot or its directory
  --allow-write             Let this command change the project
  --model <id>              ask: which of the box's models to run on
  --search <text>           tools list: filter by name or description
  --args <JSON>             tools call: arguments
  --args-file <path>        Read arguments from a file; - means stdin
  --name <tool>             Tool name, when a positional is awkward to pass
  --output <path>           Screenshot file, .png only, relative to cwd
  --scene <res://...>       Scene to capture; default the main scene
  --frames <n>              Frames to run first (60 fps), default 30
  --overwrite               Let the screenshot replace an existing file
  --hook                    team gate/round, team guard: Claude Code hook format
  --config <path>           GDBox's config file if installed elsewhere;
                            or set GDBOX_HOST_CONFIG
  --timeout <seconds>       Deadline for the whole command, default 120
  --lang zh-CN|en-US        Language for help and CLI-generated messages
  -h, --help                Show this
  -v, --version             Show the version

ask:
  Runs on GDBox's default model unless --model picks another, billed to the
  model actually used. The subtask only touches Godot tools, project files and
  the asset and project libraries; shell, browser and third-party MCP are
  never given. Without --allow-write it can look but not change. Progress goes
  to stderr; for ask, --timeout means how long without any progress, not
  total time.

Writes:
  Without --allow-write only read-only tools are called. With it, anything
  GDBox's own assistant can use is callable, except tools needing per-call
  human approval.
  Never blind-retry after a timeout: it may have taken effect; check first.

The target project is: --project, else the nearest project.godot above the
current directory, else the one connected Godot editor if there is exactly
one. editor_* tools need that project's editor connected (GDBox Link addon);
godot_check, godot_run and screenshot do not need an editor.

Exit codes:
  0     ok
  2     fix the arguments or the output location
  3     config or auth
  4     GDBox unreachable, or incompatible version
  5     no single target project, or its editor is not connected
  6     tool out of scope, or --allow-write missing
  7     timeout. The request may have been sent; verify before retry
  8     tool failed, or the file was not delivered
  130   interrupted. Does not mean anything sent was rolled back

  1 is never returned. Seeing 1 means the process died before the CLI ran.

Requires GDBox running (its service is on by default unless you turned it
off).`

export function helpText(lang: Lang): string {
  return lang === 'en-US' ? EN : ZH
}
