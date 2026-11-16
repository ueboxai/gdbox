# UEBox → GDBox 同步记录（2026-10-16）

- 只读来源：UEBox 已提交快照 `87b8e8421b1ba65d8e73d15f078b3cc69ee23cb4`。
- GDBox 起点：`6c71438ba434a6cc31278826e7e37ecc907a21bd`。
- 实现：`aed273c`；Godot 音效指引与安装资源收尾：`0ea40b9`。
- 本批评估并关闭 16 条待办；完整来源 SHA、适配说明、本地证据在 [同步台账](../scripts/upstream-sync.json)。未重新获取执行期间新增的上游提交。

## 本批结果

| 范围 | 已落地行为 |
| --- | --- |
| 网络资产库 | 大库对账分批落盘、分页进度、查询与 WAL 检查点移到 worker、索引与统计维护、列表变更去抖、空日志不重复全量对账 |
| 模型设置 | 对话/Agent 合为主模型并迁移原设置；Anthropic 中转的 adaptive thinking；Codex 快速模式 |
| 连接测试 | 使用带工具和思考的实际请求；失败时试协议、思考和工具组合，给出验证过的兼容性结论 |
| 对话 | 全部权限下反问卡到时选择推荐项；框外追问队列支持插话、撤回编辑、删除和展开 |
| 团队 | 空白或被截断的子任务结论不再算完成；成果筛选。快照标题首句逻辑本仓已具备，未重复覆盖 |
| 经验 | 移除每工具五条限制；保护未出场条目；记录退休原因；恢复旧容量规则误退记录；提升通用时保留匹配键 |
| Blender | 前置依赖安装及失败转交；官方源码锁版本随包；Python/pip 镜像回退。安装脚本位于 GDBox 独立资源目录 |
| 音效 | 独立音效角色与素材库生成；PCM/WAV、防重复收费回执。Godot gen_sfx 共用云端实现，兼容原 ElevenLabs 音乐来源和离线 sfxr |

未恢复 UE 工具、Epic/uproject 工程逻辑或 blender-ue-pipeline；UE Python 专用的 API 事实桶/复查机制有意排除。
Godot Link、工具池、工程和资源路径、文件锁、快照规则、品牌与本地数据边界保持 GDBox 版本。
未新增依赖版本、共享包、跨仓库 import、submodule 或启动同步；停止后续移植不会影响 GDBox 运行。

## 验证记录

- 三侧 TypeScript 类型检查通过；改动行 lint 通过；18 个运行时技能规范与双语文档检查通过。
- Blender Python 安装脚本 9 项测试通过（模拟安装命令，不安装真实软件）。
- 先执行了完整单测：837 个文件。隔离目录受用户上层 node_modules/http 影响，部分测试无法加载 Node 内置模块；原工作区同项测试正常。没有修改全局依赖或放宽测试配置。
- 在原 GDBox 工作区重跑所有失败项、迁入测试及 Godot/团队/经验回归：106 个文件，1531 项通过，仅 2 项既有 macOS 包路径断言失败。两项均在迁入前版本独立复现：测试期待 GDBox.app，当前产品使用 GODOT BOX.app。
- verify:changed 与 verify --with-build 均在颜色步骤停止：ProjectSection.vue 裸色 0→1、PlayGameButton.vue 禁用态 opacity。两处均不是本次改动。
- 全量 lint 棘轮仍有既有文件/基线缺口（例如 Godot editor/runtime、registry、locate）；未修改这些文件或任何棘轮基线来绕过门禁。
- Electron 主进程、preload、renderer 生产编译与 CLI 构建通过。0ea40b9 的 Windows build:unpack、依赖闭包与发行内容检查通过（51 个产物文件、212 个依赖包）。Blender 锁定源码 zip、Windows/macOS 安装脚本和 Godot Link 均实查在包内。
- 打包产物离线启动通过：功能页巡检完成，检测到的服务端请求为 0；本检查主要覆盖渲染层，主进程由已通过的官方端点静态检查补充。其后仅澄清 gen_sfx 的缓存计费说明，24 项 Godot 资产工具测试与该文件 ESLint 再次通过。
- 原始验证日志保留于本地 .git/upstream-port-20261016/；整仓聚合门禁没有被描述为通过。
- 未实调付费模型、安装真实 Blender 前置软件、连接真实网络资产服务器；未改 Godot addon 协议。测试通过不等于这些真实环境已验收。

## 直接验收

1. 启动 GDBox，打开偏好设置 → 模型来源：查看主模型和音效生成角色，使用测试连接检查用户自己的模型。
2. 在 Agent 工作时继续发送消息，检查输入框上方队列的插话、撤回编辑和删除。
3. 打开偏好设置 → MCP 服务，检查 Blender 前置条件和一键接入；安装是用户点击后的操作。
4. 对 Godot 工程调用 gen_sfx（不传 description）应继续离线生成 res://assets/gen/sfx 下的 WAV；云端音效需要用户配置来源。
5. 后续增量使用 `pnpm upstream status`；复核本批可使用 `pnpm upstream status --no-fetch --snapshot 87b8e8421b1ba65d8e73d15f078b3cc69ee23cb4`。

## 后续门禁修复（2026-10-17）

本节是最新验证结论；上面的失败项保留为修复前记录。

- 项目按钮裸色改用主题语义变量；运行按钮禁用态改用禁用文字、表面色和无投影，移除 opacity。
- 仅整理 lint 实际报告的格式问题，去掉资源依赖图的未使用参数；Godot 日志改用 Node 标准库清理终端控制字符，并补上颜色、清行和调用位置的回归测试。
- macOS x64/arm64 路径断言对齐现有 `productName: GODOT BOX`，没有修改产品名称或实际打包路径。
- lint 基线逐文件只降不升：errors 1594 → 1435，warnings 保持 9；颜色基线 49 → 40。未修改 ESLint 规则、测试范围、超时、覆盖率阈值或忽略项。
- `VITEST_MAX_WORKERS=1 pnpm verify --with-build` 完整通过，退出码 0，13/13 步通过。单 worker 是本次运行的临时环境变量，用于减少并行高负载下的资源竞争，没有修改仓库默认并发配置。
- 全量单测 837 个文件全部通过：9418 项通过，原有 2 项跳过保持不变。三侧类型检查、颜色、全量 lint 棘轮、改动行 lint、文档与技能检查均通过。
- Windows 生产构建、发行内容和依赖闭包检查通过（51 个产物文件、212 个依赖包）；打包产物离线启动门禁通过。
- 完整日志保留在本地 `.git/gate-repair-final-serial.log`。本次未运行 CI 专属依赖漏洞审计或 macOS 实机打包。
- 全部修改仅在 GDBox；没有修改 UEBox，也没有新增跨仓库运行依赖。
