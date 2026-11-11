# 项目工作台任务规格与冻结验收

任务 ID：2026-11-01-project-workbench。风险：Forge L3，按恢复基础、项目服务、真实产品三阶段推进。原始需求及范围见 [requirements.md](requirements.md)，视觉依据见 [design.md](design.md)。本规格根据独立 Tech Lead 对现有源码的规划结果冻结。

## 已确认的技术问题

- 现有工作区只有 URL 条目，没有完整布局快照；新增可选 session，同时保持旧数据可读。
- Undo 使用 merge，未恢复原窗口和位置；不能改掉历史面板“合并当前窗口”的含义，另加 original 模式。
- 缺 tabGroups 权限；新建窗口失败目前会退化到当前窗口；部分 Undo 会消耗失败项。这些均在本轮修复范围。
- 所有条目编辑必须使旧 session 失效或正确同步；元数据重命名/改色无需失效。
- 保留基线已有 Undo 样式与自动刷新修改，不修改 AGENTS.md、CLAUDE.md，不自动提交、推送或发布。

## 用户偏好与数据/API 合同

2026-11-01 用户补充：多个项目混在同一个窗口。新建项目 UI 默认零选（或网格已明确选中项），既有来源项目按 entries 匹配当前窗口成员；窗口只是候选范围。不能以“当前窗口”为由默认收起所有网页。后端 previewSave 的通用缺省选择不变，UI 必须显式传 tabIds。

项目继续使用 workspacesV2，增加可选 `session`、`sessionSavedAt`、`lastUsedAt`。entries 作为旧搜索、规则和 UI 的兼容视图；session 保留真实标签数、窗口及组关系。旧项目无 session 时按 entries 恢复，不虚构组或窗口。

新增 `createProjectService({ chromeApi, workspaceRepository, sessionAdapter, operationService, getWorkspaceLimit?, now? })`，使用 TabOutCore/CommonJS 双导出。

| 方法 | 输入 | 输出 |
| --- | --- | --- |
| previewSave | `{windowId, tabIds?}`，空数组表示不选择，不能解释为全选 | SavePreview：来源、候选、已选、可关闭与保留项、session、counts、状态指纹 |
| save | `{preview, name, workspaceId?}` | Workspace；明确指定 ID 才更新原项目 |
| park | 同 save | ParkResult：先持久化，后关闭；含 operation 与真实计数 |
| previewResume | `{workspaceId, mode?, targetWindowId?}` | ResumePreview：项目、session、已有/缺失/跳过、项目版本 |
| resume | `{preview}` | ResumeResult：只补缺失，不关闭/移动已有页面 |
| switchProject | `{sourcePreview, sourceName, sourceWorkspaceId?, targetPreview}` | SwitchResult：保存源、恢复目标、确认成功后收起源 |

恢复模式为 new-window（默认）或 merge-current（必须有明确目标窗口）。结果包括 `status: complete|partial|failed`、workspace、counts、failures；收起和切换另有 operation。具体字段由后端 Developer 在动工时同步 UI Developer，冻结后不静默更改。

服务执行前重新读取来源标签及项目版本；网址、固定状态或目标项目内容变更时抛出可识别的 `preview_stale`，必须重新预览。恢复执行前再次计算缺失，避免预览之后打开的页面被重复创建。保存新项目检查注入的额度；既有项目更新和恢复不消耗新项目名额。同一服务内互斥执行，重复动作不可重入。

## 安全事务

切换顺序固定为：验证源/目标预览 → 持久化来源 → 恢复目标 → 目标全部成功后收起源。目标部分失败或失败时保持来源打开。来源和目标不能是同一个项目。与目标复用的来源标签、固定页、内页、未勾选页和其他窗口均不得关闭。

Undo 采用 original 模式：优先源窗口和原 index；窗口消失时新建对应窗口，创建失败即报告失败。已成功恢复的标签不能在重试时重复打开；组恢复失败只重试组；未完整恢复前不删除来源数据。

工作区完整快照必须通过仓库方法保存；编辑、删除、移动、跨项目转移条目时使过期 session 失效。回收站恢复和完整备份保留有效 session。窗口 ID 不作为跨重启永久项目身份。

## 文件责任

- 后端 Developer：`extension/src/api/chrome-session-adapter.js`、`src/domain/session.js`（必要时）、`src/services/project-service.js`、`operation-service.js`、`restore-planner.js`（必要时）、`backup-service.js`、`src/storage/workspace-repository.js`、manifest 与对应后端单测/集成测试。
- UI Developer：app.js、index.html、style.css、i18n.js，可新增 `src/ui/project-workbench.js/.css` 及专属 UI 测试。新脚本在调用前加载，所有文字中英文齐全。
- 主会话：本任务需求/视觉/开发/验收记录、tools 测试启动器、真实 Chrome 旅程及截图、打包与集成验证。

所有执行者都不是唯一工作者；不得回退别人修改、另起工作流或擅自改写验收。

## 冻结验收标准

| ID | 可观察通过条件 |
| --- | --- |
| AC-01 | 保存仅包含当前窗口勾选的可保存网页；另一窗口和不支持页面不受影响 |
| AC-02 | 保存失败、额度不足、空选择、取消时关闭次数为 0，不以空集合覆盖项目 |
| AC-03 | 收起预览明确范围；保留固定页、内页、未选页和其他窗口；预览过期时需重确认 |
| AC-04 | 部分关闭报告真实数量，Undo 只恢复实际已关闭页面 |
| AC-05 | 默认仅补缺失，重复恢复不重开已有页面；复用页不移动、不关闭、不改组 |
| AC-06 | 恢复/Undo 的窗口、位置、固定状态、原生组元数据符合模式；窗口创建失败不污染当前窗口 |
| AC-07 | 部分恢复可见、可重试；成功项不重复打开；组失败仅重试组 |
| AC-08 | 切换遵循保存源→恢复目标→收起源；目标失败保留源；共享页保留，有撤销入口 |
| AC-09 | 刷新后项目仍在；旧工作区可恢复；编辑条目不会使用旧 session；回收站保持有效内容 |
| AC-10 | 完整备份包含项目 session，导入往返正确；导出状态准确；免费额度内不依赖支付配置 |
| AC-11 | 新流程中英文完整、键盘可达、焦点合理，三种结果明确；768–1440px 可用，补查窄窗口 |
| AC-12 | Node 全套、语法、manifest 和包检查通过；隔离真实 Chrome 验证保存、收起、Undo、仅补缺失、切换、失败重试、刷新、备份，保留截图和原始记录 |
| AC-13 | 同窗口混有项目 A/B/C 时，新建默认不全选；切换明确来源 A，只有所选 A 成员可收起，B/C、共享目标页与固定页始终保留 |

## 阶段与授权

1. 恢复基础：先失败测试，再修适配器、权限、部分失败及数据兼容。
2. 项目服务与 UI：在以上 API 合同下按独立文件并行，完成服务故障测试和可操作界面。
3. 集成：真实 Chrome 旅程、视觉核验、产物打包，交独立上下文验收。最多两轮自动修复复验，不降低标准。

当前没有需要阻塞开工的业务决定。异步偏好只调整默认范围与文案，不放宽关闭安全规则。
