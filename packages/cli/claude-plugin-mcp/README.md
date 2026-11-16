# gdbox —— 让 Claude Code 连上 GDBox

装上这个插件，Claude Code 就能用 GDBox 对外共享的引擎能力，不用再手动 `claude mcp add`。

## 准备

1. GDBox 开着，对外 MCP 服务开着（设置 → MCP → 共享引擎能力）。
2. 设环境变量：
   - `GDBOX_TOKEN`：同一个设置页里复制的令牌。
   - `GDBOX_URL`：端口不是默认 17871 时才要，例如 `http://127.0.0.1:18000/`。

令牌只放环境变量，别写进 `.mcp.json` 或提交进仓库。

## 装上

```bash
claude --plugin-dir <这个目录的路径>
```

进去后敲 `/mcp`，能看到 `gdbox` 已连上。

要跑团队模式，再装同目录下的 `claude-plugin`（gdbox-team），两个插件互不依赖。
