# 从 UEBox 单向移植

> English TL;DR: Keep both repositories independent. Fetch committed source into a local GDBox ref,
> pin its full SHA, review changes, port in an isolated GDBox worktree, verify locally and record the
> outcome. The source repo is read-only. There is no shared package or automatic publication.

## 入口

对编码 Agent 说：**“把 UEBox 最近的通用改进同步到 GDBox，保留 GDBox 自己的差异。”**
使用仓库技能 [gdbox-upstream-port](../.agents/skills/gdbox-upstream-port/SKILL.md)。
只想评估时明确说“仅评估，不迁入”。执行前必读 [GDBox 差异约束](gdbox-differences.md)。

同步只在用户要求时执行，没有定时任务，也不挂在安装、启动、构建和 CI 上。
上游默认是 `../uebox-pub` 的已提交 `main`；可以设置 `GDBOX_UPSTREAM` 为另一个本地克隆目录。
脚本不会替上游执行 pull、checkout、commit 或任何修改。源目录未提交内容不会被读取为迁移输入。

## 获取和固定范围

```powershell
pnpm upstream
# 可供 Agent 解析的清单；-s 避免 pnpm 命令提示混进 JSON
pnpm -s upstream status --no-fetch --json
```

`status` 默认获取上游到 GDBox 的 `refs/upstream/uebox`，不修改工作区、索引和台账；
试合并会在 GDBox 的 Git 对象库写临时树，不是完全不写磁盘。
报告包含完整上游 `snapshot`、GDBox `head`、工作区是否脏、提交来源、增删路径、分类和文本冲突。
有未提交改动时，试合并只针对 **HEAD**，不代表这些改动也可以合并。

记录输出的完整快照 SHA，后续明确传 `--snapshot <上游完整SHA>`。
`pick` / `mark` 不自动获取；即使后来再次 fetch，也可以选择此前仍属于上游历史的旧快照。
上游历史重写导致基点或旧快照不再属于上游时停止，人工核对，不能自动改 `base`。
源仓库暂不可用时，已经获取过的提交仍可用 `--no-fetch` 评估和移植。

## 分类只是初筛

规则在 `scripts/upstream-policy.json`：以 `/` 结尾表示目录前缀，其余是完整路径；
优先级为 `protected` → `engine` → `review` → `shared`，未命中为 `unknown`。

| 报告               | 意义与处理                                                      |
| ------------------ | --------------------------------------------------------------- |
| `shared-candidate` | 全部路径是通用候选；检查实际差异及依赖后才能挑取                |
| `engine-only`      | 全部路径为引擎专属；通常跳过，仍需检查是否有通用修复价值        |
| `needs-review`     | 混合、保护、未知或其他需核对的改动；适配迁入，不自动丢弃        |
| `trial.clean`      | 仅表示单个补丁能合到当前 HEAD；不证明行为正确或前置依赖齐全     |
| `trial.already`    | 完整试合并树等于 HEAD；只证明补丁无需新增文本，不证明功能已验收 |

删除路径也参与分类；重命名按旧路径删除＋新路径新增分析。
合并提交也列出，并展示相对第一父提交的改动；检查 merge 独有的冲突解决，避免遗漏。
不能把子提交和合并提交整体各挑一次；合并提交由 Agent 手工适配。
脚本不推断跨提交语义依赖；选中提交按上游拓扑顺序执行，但顺序正确不等于依赖完整。

## 在 GDBox 隔离工作区执行

先检查 GDBox 状态，基于已提交的目标版本建立或复用专用工作区和分支，例如
`codex/port-uebox-20261016`。不搬走、不 stash、不覆盖其他会话的未提交改动。
工作区应包含同步脚本、规则和技能的已提交版本。实际创建方式遵循执行环境的 worktree 工具。

如果必要的本地功能还未提交，先说明依赖这一事实；不要把工作区中的半成品当作迁移基线。
UEBox 不需要创建分支或工作区，也不需要安装 GDBox 的工具。

### 通用候选

```powershell
pnpm upstream pick <提交SHA> <另一提交SHA> --snapshot <上游完整SHA>
```

脚本要求干净的工作区（包括未跟踪文件），且没有进行中的合并、变基或 cherry-pick。
整批参数先验证：必须在快照范围内、是普通提交、没有已处理记录，并且全部为通用候选。
然后按上游顺序 `cherry-pick -x`，每成功一条立即写台账；不自动提交台账。
台账的 `ported` 表示代码已落地，自动生成的 `verification: not-run` 明确表示没有验证。

执行结束后先验证、更新和按路径提交台账，再开始下一批 `pick`；未提交台账也会被干净工作区检查拦住。

冲突时保留现场，停止后续提交。检查失败原因，不一律按文本冲突处理：

- 有冲突：按差异约束解决，按路径暂存，`git cherry-pick --continue`，随后 `mark`。
- Git 报空提交：核对完整差异确实已存在后，`git cherry-pick --skip`，用当前本仓提交和说明 `mark`。
- 放弃当前挑取：`git cherry-pick --abort`；它不会撤回本批前面已经成功的提交和台账记录。
- 记录失败但提交已成功：`status` 会显示未记账的挑取记录，核对后补 `mark`，不要重复执行。

### 混合、未知与保护路径

在隔离工作区用 `git show <sha>` / `git diff <sha>^ <sha> -- <path>` 查看补丁，
在 GDBox 现有代码上移植需要的行为，按路径暂存并创建本地提交，提交说明包含上游完整 SHA。
不得整文件覆盖品牌、依赖、差异规则、台账和引擎逻辑。无需为了移植调整 UEBox。

```powershell
pnpm upstream mark <上游SHA> partial "已迁入通用召回逻辑；剩余错误归因待适配" --local <本仓SHA> --snapshot <上游完整SHA>
pnpm upstream mark <上游SHA> skip "仅 UE 蓝图编辑命令，Godot 不适用" --snapshot <上游完整SHA>
pnpm upstream mark <上游SHA> todo "依赖前置数据库迁移，下一批处理" --snapshot <上游完整SHA>
```

`partial` 和新记录中 `verification: not-run` 的已迁入项继续显示；其余 `ported` / `skip` 默认隐藏，`--all` 可查看全部。
`ported` / `partial` 必须提供当前 GDBox 历史里的 `--local`，所有状态必须有说明。
手工移植已完整覆盖目标通用行为时，使用 `ported` 并注明排除的 UE 部分。
旧八位 SHA 台账继续可读，新记录使用完整 SHA；不重写历史记录来假装已验证。

## 验证与收尾

按功能检查必要的调用链、依赖、数据库升级和引擎行为，给新增或改变的行为补测试。
执行仓库 AGENTS 的门禁层级；改编辑器协议还必须完成真实 Godot 编辑器验证。
检查没有恢复 UE 专属模块、覆盖 GDBox 标识或引入跨仓库依赖。
不通过修改无关基线、删测试或改 UEBox 来让 GDBox 的验证通过。

验证结果写入台账，失败或缺少条件也照实记录，例如：

```powershell
pnpm upstream mark <上游SHA> ported "已迁入队员成果筛选；保留 Godot 工程绑定" --local <本仓SHA> --verification "相关测试通过；完整门禁通过；未改编辑器协议" --snapshot <上游完整SHA>
git add -- scripts/upstream-sync.json
git commit -m "chore(upstream): 记录本批移植与验证结果"
```

交付报告只需说明：固定快照、迁入功能、跳过和待处理项、验证结果、目标分支/工作区。
仓库的发布规则仍然适用，不自动 push 或开 PR。失败批次保留隔离分支供修复；
已合入的移植若要撤回，用有范围的 revert 并将相应台账改回 `todo` 或 `skip`，不要重置共享历史。
如果以后需要重新迁入，按手工适配流程处理；脚本不会自动重放历史里已有挑取记录的提交。
