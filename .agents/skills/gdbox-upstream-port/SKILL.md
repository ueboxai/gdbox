---
name: gdbox-upstream-port
description: 单向评估或移植 UEBox 已提交的通用改进到 GDBox，保留 Godot 与产品差异、记录来源并独立验证。用于“同步 UEBox 更新”“迁移上游通用功能”；保持两个仓库独立，只读 UEBox。
---

# UEBox → GDBox 单向移植

目标：UEBox 正常独立开发，GDBox 按需吸收功能。迁入的是本仓代码，不是跨仓库依赖。
本技能位于 GDBox 的 `.agents/skills/`，服务编码 Agent，不是应用内置运行时技能。

## 先确定边界

读取 GDBox 根目录 `AGENTS.md`、`docs/gdbox-differences.md`、`docs/upstream-sync.md`。
路径规则以 `scripts/upstream-policy.json` 为准，台账是 `scripts/upstream-sync.json`。
文档相对 GDBox 根目录定位，不是相对当前 shell 或技能目录。

- “只评估/先讨论/不要改”：只读分析，使用 `pnpm -s upstream status --no-fetch --json`。
  若未获取上游，用只读 Git 命令查看源仓已提交历史并报告尚未试合并；不执行 fetch、pick、mark。
- “同步/迁入”：执行下面流程；普通冲突自行适配，仅产品方向分歧或无法验证的关键约束需要用户决策。
- 用户指定范围优先；默认评估当前上游已提交分支及台账待办，不复制未提交内容。
- 不修改 UEBox，不在其中执行 pull/checkout/安装/测试，不要求上游配合重构。

## 选择可交付的批次

1. 检查 GDBox 的工作区、正在进行的 Git 操作和已有隔离工作区。新建或复用本次专用的
   **GDBox** 工作区，从已提交目标版本开始。保留他人未提交内容；同步脚本必须已存在于该版本。
2. 运行 `pnpm -s upstream status --json`，记下完整 `snapshot` 和 GDBox `head`。
   后续使用 `--snapshot <完整SHA>`；重新查看报告加 `--no-fetch`，避免执行中扩大范围。
3. 阅读候选提交的实际 diff、父版本、GDBox 当前实现及调用链。按功能归并前置依赖和后续修复；
   `shared-candidate`、标题和 `trial.clean` 都不是可直接交付的证据。
4. 混合/未知路径按行为判断，不能整目录跳过。合并提交核对独有解决逻辑，避免漏迁或重复迁入。
   对新增依赖、数据库迁移、IPC 和 pi API 版本做兼容性判断，保留来源版权及许可证。
5. 告知本批迁入范围与明确保留的差异，然后继续执行；不为普通实现细节反复请求许可。

## 实施

- 通用候选：确认依赖齐全后 `pnpm upstream pick <sha...> --snapshot <snapshot>`。
  脚本在当前工作区创建代码提交，台账留作未提交改动；不要再启动第二个并发同步。
- 混合/保护/未知路径：在 GDBox 当前实现上移植通用行为，保留差异约束；按路径提交，
  提交说明保留上游完整 SHA。不要扩大 shared 规则来绕过适配，不全局换品牌字符串。
- 冲突：保留并检查现场，解决后继续当前 cherry-pick，再补 `mark`。失败不自动 reset/stash。
  中止当前挑取不会撤回之前的成功项；检查台账和 Git 日志后再继续。
- 来源记录：`mark <sha> ported|partial|skip|todo "具体说明" --snapshot <snapshot>`；
  ported/partial 加 `--local <本仓提交>`。partial 说明已迁入与剩余部分，仍留待办。
  若 UE 专属部分是有意排除且通用部分完整，可用 ported，但明确写出排除范围。
- 台账里 `ported` 仅表示代码落地，不代表测试通过；不要把未验证批次描述为可用交付。

## 验收和交付

按 GDBox AGENTS 执行对应层级的验证；必要时跑真实 Godot 编辑器流程。
同时检查没有新增跨仓库构建/运行依赖、恢复 UE 专属模块或覆盖 GDBox 身份与用户数据规则。
更新台账的 `--verification "实际结果与缺口"`，按路径提交台账；下一批 pick 前工作区应干净。
不自动发布，不擅自修复其他会话造成的门禁失败。

给用户简短交付：来源快照、迁入的功能、跳过/待适配项、检查与实际效果的区别、验收入口或分支。
对未完成部分明确记录，不为了赶进度把 partial/todo 改成 ported。
