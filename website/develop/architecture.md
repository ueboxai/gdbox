# 架构与验收门禁

本页是索引。规范的唯一真相源是仓库根目录的 [`AGENTS.md`](https://github.com/ueboxai/gdbox/blob/main/AGENTS.md)（中文版 `AGENTS.zh-CN.md`），有出入以那份为准。

## 门禁两档

干活过程中不跑门禁，最多跑你正在写的那个测试文件：`pnpm exec vitest run <文件>`。

功能做完、每次提交时：

```bash
pnpm verify:changed
```

约 30 秒，只检查改动部分：跳过全量 lint 棘轮，类型检查只查改动涉及的一侧，单测只跑相关的。
比较基准依次取 `$VERIFY_BASE`、`origin/main`、`main`、`HEAD`；只想查眼前这一批时，用 `VERIFY_BASE=HEAD pnpm verify:changed`。

整批交付前（push、出包、移交）：

```bash
pnpm verify
```

约 3.5 分钟，完整门禁。这段时间基本是固定开销。门禁是全仓范围的，多个会话并行时，其他会话未完成的文件会导致门禁失败。

另有两个变体：`pnpm verify:fast`（完整门禁，单测跳过原生产物预检）和 `pnpm verify --with-build`（本地也跑打包与离线启动，改了主进程、构建配置或依赖时用）。

`verify:changed` 不能替代完整门禁。CI（`.github/workflows/quality.yml`）中只有 `pnpm verify --ci`，在 PR 和向 `main` 的 push 上运行。门禁只在 `scripts/verify.mjs` 一处定义，本地和 CI 跑的是同一份。CI 绿灯不代表在真 Godot 编辑器里验过。

跑门禁不需要关闭应用。

### 门禁步骤

| 步骤                        | 检查内容                                                         |
| --------------------------- | ---------------------------------------------------------------- |
| `security:secrets`          | 是否有密钥提交进仓库                                             |
| `verify:overrides`          | `package.json` 里 `pnpm.overrides` 与 `overrides` 两张表是否一致 |
| `verify:official-endpoints` | 棘轮：社区版核心不新增对官方服务端的调用                         |
| `verify:local-storage`      | 棘轮：`localStorage` 的 key 必须登记；用户内容和凭据不许新增     |
| `verify:colors`             | 引用的 `--color-*` 必须有定义；裸写颜色逐文件棘轮，只减不增      |
| `lint`                      | 棘轮：全仓 ESLint，逐文件不超过基线存量                          |
| `lint:changed`              | 对改动行跑全量规则，零容忍                                       |
| `docs:check`                | 成对的中英文档是否一起修改                                       |
| `verify:skills`             | 技能是否符合 `SKILL_STANDARD.md`                                 |
| `typecheck`                 | 主进程 + 渲染进程 + CLI                                          |
| `test:run`                  | Vitest 全仓单测                                                  |

CI 另外运行 `audit:prod`、`build:unpack`、`verify:offline-boot`（社区版必须零官方服务端请求）。

跳过测试、删测试、加 `.skip`、扩大 ESLint ignore、降低覆盖率阈值都不是让门禁通过的合法方式。认为某条门禁本身有问题时，在 PR 中提出。

## 代码分层

每个功能通常穿过七层：

| #   | 层         | 路径                                                |
| --- | ---------- | --------------------------------------------------- |
| 1   | 数据模型   | `src/main/sqliteDataBase/models/`                   |
| 2   | IPC 处理   | `src/main/sqliteDataBase/ipc/`                      |
| 3   | 预加载桥   | `src/preload/index.ts`                              |
| 4   | 预加载类型 | `src/preload/index.d.ts`（必须和 #3 一起改）        |
| 5   | 渲染层 API | `src/renderer/src/api/`                             |
| 6   | 状态       | `src/renderer/src/store/modules/`（仅在需要共享时） |
| 7   | 界面       | `src/renderer/src/views/`                           |

其他入口：主进程 IPC 在 `src/main/ipc/`，跨进程共享类型在 `src/shared/`，Godot 工程相关的主进程逻辑（定位 Godot、读写 `project.godot`、`.tscn`、无头运行、安装插件）在 `src/main/godot/`。

四处带额外义务：

| 区域              | 路径                                        | 义务                                                                                                                                 |
| ----------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Agent 工具        | `src/main/agent-v3/tools/`                  | 用 `defineTool` 定义，调编辑器的走 `tools/editorRpc.ts`，在 `registry.ts` 注册                                                       |
| 运行时技能        | `resources/skills/`、`packages/cli/skills/` | 符合 `SKILL_STANDARD.md`                                                                                                             |
| Godot 编辑器插件  | `resources/godot/addons/gdbox_link/`        | 消息格式和 `src/main/services/websocket` 一致；加命令要两边一起改，并在真编辑器里跑一遍                                              |
| `gdbox` 命令行    | `packages/cli/`                             | 走 `tsconfig.cli.json` 类型检查；发包前自己跑 `pnpm verify:cli-package`（构建 + 发布包体检，不在门禁里）                             |

### GDBox Link 与无头运行

GDBox 和 Godot 之间有两条路：

- **编辑器插件 GDBox Link**（`resources/godot/addons/gdbox_link/`）：打开工程时由 `src/main/godot/editorLinkAddon.ts` 拷进工程的 `addons/gdbox_link`，并在 `project.godot` 的 `[editor_plugins]` 里启用。插件主动连 GDBox 本机 17870 端口的 WebSocket，断了每 3 秒重连。它只回答 GDBox 的请求：报告选中的节点和文件、打开场景、运行和停止游戏、重新加载 GDBox 改过的场景，不会自己改工程。
- **无头运行**（`resources/godot/gdbox_run.gd`、`gdbox_load_check.gd`）：不需要打开编辑器，Agent 用它们做加载检查和按输入时间表试玩，结果以 `GDBOX_` 开头的行打印出来，由 GDBox 解析。没连编辑器时，Agent 照样能读写工程、检查和试玩。

### Agent 的五层

产品的主体是 Agent，它整个活在主进程的 `src/main/agent-v3/` 下，由下往上：

| 层  | 路径                    | 负责                                                                                                                                  |
| --- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| L4  | `host/`                 | IPC 注册、事件桥、对话管理、多窗口隔离、审批交互                                                                                      |
| L3  | `capabilities/`         | 技能注册表、MCP 客户端、插件宿主、工具注册与动态过滤                                                                                  |
| L2  | `tools/`                | `defineTool`，Godot 工具（`tools/godot/`、`tools/godot-asset/`）、AIGC 工具，以及内建的 `task` 等                                     |
| L1  | 内核                    | Agent 循环、插话、钩子，由 pi（`@earendil-works/pi-agent-core`、`pi-ai`）提供；压缩与本地文件 / Shell 工具在 `vendor/pi-harness/`     |
| L0  | `core/` + `src/main/ai` | 模型层：流式接入、模型目录、凭据存储、OAuth                                                                                           |

pi 只提供 Agent 循环。上下文压缩用到的估算、摘要和默认参数，以及读、写、编辑、命令四个本地工具和 Node 执行环境，放在 `src/main/agent-v3/vendor/pi-harness/`（MIT，附 LICENSE）。改这个目录之前先读 `index.ts` 的头注释：与上游分叉后只能自己维护。

pi 把系统提示词和工具清单放进 transcript 的 `system` 消息，这类消息只属于当前一轮，不落盘。恢复历史一律走 `restoreTranscript`；直接给 `state.messages` 赋值会冲掉 Agent 开头那条提示词，模型会静默丢失提示词。

`core/` 下还有几件不属于任何一层但影响全局的东西，改之前先读各自的文件头注释：熔断（`loopBreaker.ts`）、上下文压缩（`compaction.ts`）、出口请求预算（`requestBudget.ts`）、资产锁（`assetLock.ts`）、审批门（`approval.ts`）、目标模式（`goalLoop.ts`）。

::: warning 三条容易踩反的

1. **工具失败只能靠抛异常表达。** 在返回值里设 `isError` 会被静默忽略，后果是失败被当成功报给模型，它基于错误前提继续往下做。
2. **前端只展示，不推进。** 助手页没有 keepAlive，切页面就卸载；要在后台发起 agent 就走应用级的入口，别借页面的执行函数。
3. **工具一次性全量注册。** 按需懒加载被 A/B 实测否决过，不要重提；能力边界真变了（比如编辑器连上来）时重建一次是另一回事。

:::

## 硬规则摘录

完整清单在 `AGENTS.md` 第 5 节。

1. 不硬编码颜色和间距，使用 `theme.css` 中的 CSS 变量。应用有深色 / 浅色 / 高对比三套主题。
2. 界面组件先查 `docs/ui-components.md`。渲染进程有两套组件来源：会被点击、会弹浮层的用自建 `App*.vue`，表单输入类用 ant-design-vue。写错会被 ESLint 拦下。
3. 用户可见文案必须双语，`zh-CN.ts` 和 `en-US.ts` 同时添加。用词以仓库的 `CONTEXT.md` 为准，`src/renderer/src/i18n/terminologyGuard.test.ts` 会在两份语言包和主进程文案里拦禁用词（例如「会话」「聊天」「回合」），失败信息里有替换写法。
4. 渲染进程不直接调 `ipcRenderer`，走 `window.api.*` 并用 `unwrapResult()` 包装。
5. 新行为必须有测试。
6. 不新增依赖、网络请求、遥测，除非 Issue 中明确要求。
7. 不格式化未改动的文件。
8. 用户创作内容的唯一真相源是磁盘上的文件，数据库只是可重建的索引。
9. 不改工程 `.godot/` 下的任何东西，那是编辑器缓存。改场景、资源时保留 `uid://` 引用，不手写新 uid。
10. 用户交给模型的图片、视频、音频，先传到用户配置的对象存储，给模型一个链接；存储没配、模型不收这类链接或上传失败时才退回 base64 或本地路径。决策只在 `src/main/agent-v3/core/promptMedia.ts` 一处，不另开上传路径。
11. 写入类工具的回执只报引擎现在的样子：状态字段在所有改动完成后从引擎读出，有一件没办成时第一句不说成功。测试里要有「引擎回的值和入参不同」的用例。

## 多会话并行

仓库常有多个 AI 会话同时修改：

- 提交时按路径只提交自己改动的文件。`git add -A` / `git add .` / `git commit -a` 会把其他会话未提交的改动一并收入。
- 完整 `pnpm verify` 只在收工时运行，同一时间只有一个会话运行。
- `scripts/` 下的四个棘轮基线文件（lint / colors / local-storage / official-endpoints）全仓共享，并行修改会冲突。

## 从 UEBox 移植

GDBox 的代码从虚幻盒子（UEBox）分叉而来。两个仓库相互独立：UEBox 不是 GDBox 的构建或运行依赖，GDBox 这边也不修改 UEBox。UEBox 的通用改进由开发者按需单向搬过来，没有定时同步。

```bash
pnpm upstream                               # 查看上游有哪些新提交、怎么分类
pnpm upstream pick <提交SHA> --snapshot <上游完整SHA>
```

上游默认读 `../uebox-pub` 的已提交 `main`，可用环境变量 `GDBOX_UPSTREAM` 指向别的本地克隆。处理结果记在 `scripts/upstream-sync.json`。脚本对路径的分类只是初筛，混合改动要手工适配，Godot 相关的行为（`project.godot` 识别、GDBox Link、`.tscn` / `res://` / `uid://` 语义、Godot 工具和提示词等）必须保留。

动手前读仓库的 `docs/gdbox-differences.md`（必须保留的差异）和 `docs/upstream-sync.md`（操作流程）；交给 AI 做时用仓库技能 `gdbox-upstream-port`。

## 打包与发版

```bash
pnpm build:win      # Windows
pnpm build:mac      # macOS
pnpm build:linux    # Linux
```

GDBox Link 插件和无头运行脚本是文本文件，在 `resources/godot/` 下随应用一起打包，不需要单独构建。

上传是单独一步，更新源只有公开的 GitHub Releases：

```bash
pnpm release:app              # 演练：只打印要发什么，不发起网络请求
pnpm release:app --publish    # 实际发布
```

`package.json` 的 `updateGithubRepo` 现在填的是 `ueboxai/gdbox`。留空时构建出的是不带更新源的包，启动时不发起更新请求。
