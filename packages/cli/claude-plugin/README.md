# gdbox-team —— 在 Claude Code 里跑 GDBox 的团队模式

Claude Code 当大脑，GDBox 当工作室。主会话是制作人，`gdbox-member` 子 Agent 是队员，
`gdbox-acceptor` 子 Agent 是独立验收员；GDBox 只管名册、任务板、留言、文件锁、编辑器排队、
工程快照和验收记录，**自己不调任何模型**。所有思考花的都是你 Claude Code 的额度。

设计稿：仓库里的 `docs/外部大脑跑团队设计-2026-10-17.md`。

GDBox 里自带的团队模式（对话里敲 `/team`）不受影响，两者互不相干。

## 准备

1. GDBox 开着，对外 MCP 服务开着（设置 → MCP → 共享引擎能力），并且**没有**收窄成只读。
2. `gdbox` 命令行在 PATH 上（`gdbox --version` 能跑）。
3. 设两个环境变量，队员子 Agent 用它们自己连 GDBox：
   - `GDBOX_TOKEN`：GDBox 对外服务的令牌（同一个设置页里能复制）。
   - `GDBOX_URL`：端口不是默认 17871 时才要，例如 `http://127.0.0.1:18000/`。
4. Claude Code 主会话里已经连着 GDBox 的 MCP（可安装同目录下的 `claude-plugin-mcp`，或按 GDBox 设置页给的命令添加）。

## 装上

只在这一次会话里用：

```bash
claude --plugin-dir <这个目录的路径>
```

插件包含：

| 部分                       | 作用                                                                                                                 |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `skills/gdbox-team`        | 制作人的打法：开团队、招人、派活、验收                                                                               |
| `agents/gdbox-member.md`   | 队员。自己开一条到 GDBox 的连接，进门报名字                                                                          |
| `agents/gdbox-acceptor.md` | 验收员。只读连接，记下 PASS / FAIL / BLOCKED                                                                         |
| `hooks/hooks.json`         | 收尾时跑 `gdbox team gate --hook`：没过验收就让制作人接着干，一轮最多两次；新消息时跑 `gdbox team round --hook` 清零 |

## 用

在 Claude Code 里直接说「用 GDBox 的团队做一个塔防」。制作人会：

1. `team_open` 开团队，在工作目录里跑 `gdbox team use <团队 id>`；
2. `team_hire` 招人，起 `gdbox-member` 子 Agent 派活；
3. 工程建好后 `team_open` 补上工程路径；
4. 起 `gdbox-acceptor` 验收，PASS 之后交付。

进度在 GDBox 里也看得到：任务板、留言、快照都在盒子那边记着。换一天接着做：
让制作人 `team_list` 找到团队，再 `team_open` 带上 `team_id`。

## 已知限制

- **待真机验证**：子 Agent 定义里内联的 MCP server 是否确实各开一条连接、`${GDBOX_TOKEN}` 在
  子 Agent 的 frontmatter 里是否会被展开。不成立的话队员会连不上（报认证失败），或者两个队员
  共用一个身份。
- 制作人如果用 Claude Code 自己的文件工具直接改工程，GDBox 拦不住，这些改动不进锁、不进快照。
  技能里写明了不要这样做。
- GDBox 看不到 Claude 的用量，任务板上的用量栏对外部团队没有意义。
- `gen_*` 这类生成工具调的是 GDBox 里配好的生成服务，照常计费。
