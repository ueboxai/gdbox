# UEBox 通用改进移植（2026-10-22）

> English TL;DR: Five reviewed changes were adapted into an isolated GDBox branch. Godot behavior,
> product identity, local-only defaults, existing team features and the pi 1.2.0 patch are preserved.
> This is a local contribution, not a release. Validation results and outstanding baseline failures
> are recorded below; a code port is not an assertion that the full gate passed.

## 固定范围

- 来源快照：`9e2eb578e9a4dc376d5acd296e9e6b660128964b`（只读 `H:/UnrealAgent/uebox-pub` 的已提交历史）。
- GDBox 基点：`1cd6611481accbc7b7a4aeb9e5b860c1a2ee69a6`。
- 代码提交：`79d5a266cad8a69a9783203f04fe8f9cc59945c2`。
- 交付分支：`feat/port-uebox-20261022-h`。
- 工作区：`H:/UnrealAgent/gdbox-port-20261022`。未搬入主检出的未提交修改，未推送或创建 PR。

## 本批迁入

| 来源                                       | 用户可见结果                                                   | GDBox 适配                                                                                            |
| ------------------------------------------ | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `63cd971ebdb178fd2bee00de528367913f471df4` | 对话任务板的交付日志可在右侧独立页签看全文，多份切换、分别关闭 | 保留冠军恢复；独立外部团队页没有对话侧栏，继续就地展开，不让点击失效                                  |
| `d23ac59c4e450d7f9892ae1fd66f2c6e02597fed` | 生成中点击“＋”仍可选文件和技能，隐藏不能在当前轮执行的命令     | 保留草稿与插话通路，按钮尺寸使用主题变量                                                              |
| `5f502ae50740a73f170dbfe74918871f27892d7e` | Claude Code 可装独立 MCP 插件连接 GDBox                        | `GDBOX_URL`、`GDBOX_TOKEN`、默认本机端口 `17871`；保留原有 `gdbox-team` 插件                          |
| `b5dbb2503b4a34b1be4dfd423fdd13cd782ef515` | 用量页显示“失败数（失败率）”                                   | 不改统计口径                                                                                          |
| `9e2eb578e9a4dc376d5acd296e9e6b660128964b` | 更新现有依赖的修复版本                                         | MCP SDK `1.32.1`、markdown-it `15.0.3`、follow-redirects `1.16.1`；保留 pi `1.2.0` 与既有流式解析补丁 |

锁文件在 GDBox 上解析，保留独立依赖树，并排除解析器顺带调整的无关依赖引用。没有复制上游
pi 1.0.0，没有新增跨仓库构建或运行依赖、官方服务、账户要求或 UE 工具。

## 旧台账核对

以下为核对已有实现并补记来源，本批不重复搬运代码：

| 上游来源   | 已有 GDBox 提交                    | 内容                               |
| ---------- | ---------------------------------- | ---------------------------------- |
| `c1098c2d` | `0a5e6e93`                         | 团队实际用量账和任务板明细         |
| `5de6a3d3` | `875ecea7`、`ab610c86`、`d88945c2` | 逐轮记忆串行保存、中断后续作及提示 |
| `426d70f7` | `f3f7631e`                         | goal/team 互斥和逐次验收事件       |
| `53ecc253` | `1033efca`                         | 后台摘要增量续写与撞线补压缩       |
| `89ee2419` | `cf1eb9ba`                         | 团队随用户最新要求推进与验收       |
| `e146ce06` | `53f3c35d`                         | 辞退队员的证据、档案与任务交接     |

`f7d77abe` 继续记为 **partial**，但纠正剩余范围：外部团队、CLI team 命令和独立团队页已在
`8d87fdb2` 落地，上下文溢出恢复已在 `159dba4a` 落地；尚未迁入的是该混合提交中的大量进度格
折行/收窄及对应测试。不能仍将整个外部团队功能称为“未迁入”，也不能将整条提交标成完成。

`9dfb5c3e` 原有 partial 不变：压缩工厂返回类型已迁入，其余跨模块格式整理未纳入本批。

## 明确保留的待办与排除

- 外部团队 `team_seat` 通行证（`8fd68532`）留下一批：需要一并适配身份权限、重连、验收与写入记录。
- 团队工程及其服务端/凭据/编辑器联动仍为独立待办。
- 插件首次安装询问、共享技能与 UEBox 账户发布、资产版本语义与分面统计、工具说明术语检查不在本批。
- UE UMG 控件、蓝图局部变量、UEBox 版本发布和纯格式提交不搬入。
- 三个合并提交经 remerge-diff 检查未发现独有冲突解决，分别跟随子提交处理，不重复挑取。

## 验收入口

1. 在本工作区启动 GDBox，打开已有团队对话，在任务板日志点击一份交付：右侧新增交付页签；
   打开另一份、切换、关闭，查看全文；返回独立外部团队页，日志仍就地展开。
2. Agent 生成中点击“＋”，选择技能并附上文字插话：草稿保留，技能随插话发送，菜单不列内置命令。
3. 设置 → 用量，查看工具失败数与括号内的失败率。
4. 设置 → MCP 启用共享服务并设置环境变量后，运行
   `claude --plugin-dir H:/UnrealAgent/gdbox-port-20261022/packages/cli/claude-plugin-mcp`。
   配置和包体已检查；真实 Claude Code 连接仍需使用者自己的令牌与客户端验收。

## 验证记录

- `VERIFY_BASE=1cd6611481accbc7b7a4aeb9e5b860c1a2ee69a6 pnpm verify:changed`：10 步通过，141 个相关测试文件、1332 项测试通过。
- `pnpm typecheck`：主进程、渲染器、CLI 三侧通过。
- `pnpm verify:cli-package`：通过，发布包 34 个文件、1 个运行时依赖，包含独立 MCP 插件。
- `pnpm audit:prod`：通过高危阈值检查；仍有 5 个 low、11 个 moderate，没有 high/critical。
- `pnpm verify --with-build`：第 6 步全量 lint 棘轮失败。`src/main/userDataPath.ts` 和
  `tests/unit/gdbox-css.test.ts` 各有 1 个既存 Prettier warning 超出基线，分别来自此前
  `38ee142d`、`ab135105`；本批相对基点没有改动这两个文件，也没有调整基线。

最初在 C 盘托管工作区执行全量单测时，Vite 将内置 `http` 解析到用户目录下无关的 npm 包，
导致多套测试初始化失败。没有改动用户目录；最终工作区移到同属 GDBox 的 H 盘独立检出并重新安装依赖。
原诊断用的 `partialUpdate.test.ts` 在 H 盘全部 8 项通过。C 盘失败不作为本批代码正确性的证据，
完整单测与打包在最终 H 盘工作区另行执行。

- 最终 H 盘 `pnpm test:run`：867 个测试文件通过、1 个失败；9769 项通过、1 项失败、2 项既存跳过。
  唯一失败为 `src/main/agent-v3/core/createAgent.test.ts:422`：仍期待已经从 GDBox 工具池删除的
  UE `material_describe`。该断言来自此前 `5d3cc27f`，在本批基点已存在；本批没有改测试或相关逻辑，
  也没有新增跳过。单独运行该用例同样复现。
- 最终 H 盘 `pnpm build:unpack`：通过。包体检查无本机私有目录，发行许可保留；
  依赖闭包检查扫描 55 个产物文件、遍历 212 个包，asar 内 665 个包。
- 最终 H 盘 `pnpm verify:offline-boot`：通过。临时数据目录冷启动，首页 `#/` 正常渲染，
  页面巡检记录服务端请求 0 个。此项只覆盖脚本监测的渲染层请求，主进程由官方端点静态检查补充。

**结论：本批相关检查、打包和离线启动通过，但全量门禁未全绿。** 尚有两处历史 lint 基线缺口和
一项历史 UE 工具测试断言需要另行处理。没有为本批绕过门禁、扩大忽略范围或放宽基线。
UI 交互已有组件回归测试，未将自动化测试等同于人工完整体验验收；Claude Code 真实客户端连接仍待验收。
