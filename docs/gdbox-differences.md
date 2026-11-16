# GDBox 移植约束

> English TL;DR: GDBox and UEBox are independent products and repositories. Port committed source
> changes one way into GDBox. Never modify UEBox or add shared build/runtime dependencies. Preserve
> the Godot behavior and product identity below; path classification is only a review aid.

本文件是从 UEBox 移植时必须读取的差异约束。操作说明见 [单向移植工作流](upstream-sync.md)，
路径初筛规则在 [upstream-policy.json](../scripts/upstream-policy.json)。约束说明行为，规则只帮助定位。

## 独立性

- UEBox 是当前的代码来源，不是 GDBox 的运行、安装、构建或 CI 依赖。
- 不修改 UEBox，不要求它重构、拆提交或留接口；所有适配在 GDBox 完成。
- 不引入跨仓库 import、相邻目录依赖、共享工作区包、submodule 或启动时同步。
- 不合并整条上游分支，不使用 `--allow-unrelated-histories` 建立永久合并关系。
- 两边可以有不同的依赖版本、产品功能、发布计划和所有者；停止移植不影响 GDBox 使用。
- 来源版权和许可证声明随代码保留；遇到与本仓许可证不兼容的新来源，不静默搬入。

## 必须保留的差异

| 边界       | GDBox 必须保留的行为                                                                                                                                                                                 | 重点入口（不是封闭清单）                                                                                     |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 产品与发布 | GDBox 品牌、应用身份、独立用户数据、协议、端口和更新源；不借迁移重命名历史内部类型                                                                                                                   | `package.json`、打包配置、`src/main/userDataPath.ts`、`src/main/utils/PathManager.ts`、updater、语言包、图标 |
| 工程       | 识别 `project.godot`，定位 Godot 可执行文件、打开工程并安装 GDBox Link；不恢复 Epic 扫描和 `.uproject` 操作                                                                                          | `src/main/godot/`、`services/project/`、项目库、项目设置                                                     |
| Agent      | 保留 Godot 提示词、工具池、风险与权限规则；没连编辑器也能读写工程、无头检查和试玩                                                                                                                    | `agent-v3/core/createAgent.ts`、`tools/registry.ts`、`tools/godot/`、`tools/editorRpc.ts`                    |
| 编辑器连接 | 保留 GDBox Link 的连接身份、工程归属、命令和回包语义；通用传输层改进可以迁入                                                                                                                         | `resources/godot/addons/gdbox_link/`、`services/websocket/`                                                  |
| 文件和资源 | `.tscn/.tres/.gd`、`res://` 与现有 `uid://` 语义；禁止修改 `.godot/` 缓存、手造 uid；不恢复 UE 软路径和二进制资源操作                                                                                | `utils/fileProcessor/GodotAssetProcessor.ts`、`godot/tscn.ts`、资产导入和依赖查询                            |
| AIGC       | 通用服务商调用可以迁入，Godot 工程内的资源生成、落盘和引用继续按 Godot 管线处理                                                                                                                      | `main/ai/`、`godot/aigc/`、`agent-v3/tools/godot-asset/`                                                     |
| 团队与快照 | 通用协调逻辑可迁入；保留文件锁、编辑器排队、Godot 工程绑定、快照目录与排除规则、回滚后的编辑器刷新。团队模式与 UEBox 一致：默认全放行，盒子里的制作人工具齐全，自己决定单干还是招人（2026-11-05 定） | `agent-v3/core/team/`、`tools/godotLocks.ts`、`ipc/teamSnapshots.ts`                                         |
| 技能与经验 | 使用 GDBox 的工程目录和 Godot 工具语义；不把 UE Python、蓝图、材质流程原样带回                                                                                                                       | `agent-v3/capabilities/skills.ts`、`agent-v3/experience/`、`resources/skills/`                               |
| CLI        | 保留 GDBox 命令、配置、工具和独立打包；不要将 UEBox CLI 作为前置条件                                                                                                                                 | `packages/cli/`                                                                                              |
| 本地数据   | 保留现有用户文件和数据库兼容性；数据库迁移可重复执行；账号、遥测和官方服务要求不得随上游更新悄悄进入本地功能                                                                                         | 数据库、设置、安全存储、网络库                                                                               |

数据库、资产库、团队、AI 是可复用的产品能力，但其整个目录不等于“与引擎无关”。
例如团队快照里的缓存排除列表属于引擎行为，不能随通用团队修复覆盖。

## 如何处理混合改动

1. 对比上游提交的父版本、提交结果和当前 GDBox；查调用方、注册、IPC、持久化、测试。
2. 提取要改善的用户行为，在 GDBox 当前实现上落地；必要时重写小段逻辑，避免搬回已删除模块。
3. 同时核对引入的依赖版本、设置项、数据库字段和服务端契约。文本无冲突不是兼容性证据。
4. 不全局替换 `Unreal` → `Godot`、`.uebox` → `.gdbox`。历史内部标识和外部服务协议可能必须保持。
5. 保留 GDBox 自己已修复的问题。新出现的产品分歧先记 `todo`，只把确实需要产品决策的部分交给用户。

部分移植用 `partial`，说明已迁入与未迁入内容；它会继续出现在待处理清单。
若通用部分已完成，剩余明确是 UE 专属并决定排除，可记 `ported`，但必须写明排除内容，不能写成整个上游提交都已迁入。

## 约束如何演进

以后 GDBox 独立发展的行为也追加到此表，并按需更新路径初筛规则。
已有路径出现新语义时重新评估；未知文件默认待判断。
不要为了让 `pick` 放行，临时把混合目录改成 `shared`；直接按工作流手工适配。
规则变更需要覆盖误分类边界的测试，不能只验证 JSON 能解析。

本文件只约束移植，不禁止用户以后明确调整 GDBox 的产品方向。
