# 项目工作台 UI 实现记录

实现角色：Forge Developer（UI）。任务：2026-11-01-project-workbench。未修改冻结需求和验收标准，未提交、推送、发布；保留此前 Undo 点击样式和实时刷新改动。

## 实际变更

- `extension/src/ui/project-workbench.js`：项目主区控制器、同窗候选选择、应用内预览/结果、异步提交防重入、错误与恢复重试、焦点/键盘、备份状态。
- `extension/src/ui/project-workbench.css`：沿用暖白、墨色和绿色，提供项目卡片、表单、候选列表、结果及响应式样式；不增加运行时依赖、字体或远程资产。
- `extension/index.html`：新增主区、具名对话框及脚本/样式加载。
- `extension/i18n.js`：新增项目主流程、错误和结果的中英文文案；已知恢复错误展示可理解说明，不直接显示内部错误码。
- `extension/app.js`：注入真实项目服务，静态界面渲染后刷新项目主区，统一 `undoTrackedOperation`，记录最近发起备份导出的时间。
- `extension/style.css`：窄窗口下解除旧标签区域 600px 最小宽度，让旧工具行、页脚和提示正常换行，保留原布局。
- 新增 `tests/unit/project-workbench-ui.test.js`、`tests/unit/project-undo-ui.test.js`。

## 核心交互

针对用户“多个项目混在同一窗口”的真实习惯，保存默认不全选。可以跨网站逐项勾选，或继承 dashboard 已明确选中的网址。选择既有来源项目时，只匹配该项目在当前窗口的条目，不混入同窗其他项目。

筛选时批量选择只增加筛选结果，保留之前明确选择的条目；不会默选隐藏的其他项目。固定页面可保存但显示“保留打开”，内页禁用。来源和目标不能为同一个项目。

仅保存和保存并收起使用不同按钮。切换把源/目标和缺失数量放在同一预览内，事务交给后端服务。结果区区分 complete、partial、failed，显示真实计数、失败详情及恢复重试；已收起标签可由结果按钮或 Toast 撤销。

部分 Undo 不删除 collected/deferred 来源数据；继续指向同一操作以便重试，完整成功后才清理来源并提供更早操作。

备份文案准确显示“最近发起导出”，不声称文件已落盘；本地提醒元数据为 `projectBackupStateV1 = { requestedAt }`，不跨设备导入为虚假备份状态。

## UI 与浏览器旅程接口

- 主区：`#projectWorkbench`、`#projectSaveBtn`、`#projectParkBtn`、`#projectList`。
- 项目卡：`[data-project-id]`，按钮 `[data-project-action="resume"|"switch"][data-project-id]`。
- 预览：`#projectDialogOverlay`、`#projectSourceSelect`、`#projectNameInput`、`#projectTabFilter`、`#projectCandidates input[data-tab-id]`。
- 提交：`#projectSaveOnlyBtn` 为仅保存；`#projectExecuteBtn` 在保存模式为保存并收起，在 resume/switch 模式为恢复/切换。
- 结果：`#projectResultSummary`、`#projectRetryBtn`、`#projectUndoBtn`、`#projectDoneBtn`。
- 备份：`#projectBackupBtn`、`#projectBackupStatus`。
- 状态观察：`globalThis.tabOutProjectWorkbench.controller.state`；正常执行旅程应通过 DOM 控件。

## 本角色执行的验证

统一使用 `/Users/tinggengyan/.nvm/versions/node/v24.15.0/bin/node`。

| 检查 | 结果 |
| --- | --- |
| 最初 8 项控制器行为测试 | 实现前 8 项正确失败（导出能力缺失）；实现后全部通过 |
| `node --test`（首版接入后） | 当时全套 194 项通过、0 失败；后续新增测试由主会话统一复验 |
| 部分/完整 Undo 来源保护 2 项 | 通过 |
| 筛选后批量选择回归 | 先因缺少行为失败，补实现后通过 |
| 恢复失败友好文案回归 | 先因缺少映射失败，补实现后通过 |
| 恢复模式异步预览竞态 | 独立验收复现等待中提交会执行旧模式；新增延迟提交、逆序响应两项先失败后通过，另验证失败释放等待态 |
| 结果与关闭后的焦点回归 | 真实 Chrome 验收发现结果页焦点落在隐藏按钮；补齐等待态、结果优先级、列表重画后定位与回退四项先失败后通过测试 |
| 切换共享页面预览计数 | 按目标完整 session 或旧 entries 规范化网址扣除共享页面，候选明确标注保留；新增纯行为测试先失败后通过，普通收起计数不变 |
| 最后一次 `node --test tests/unit/project-workbench-ui.test.js tests/unit/project-undo-ui.test.js tests/integration/ui-contract.test.js` | 29 项通过、0 失败 |
| `node --check extension/app.js`、新 UI 模块语法检查 | 通过 |
| `git diff --check` | 通过 |

查看了主会话真实 Chrome 截图 `evidence/iteration-1/projects/04-saved-projects.png`，项目主区域与原界面视觉一致。主会话第二轮反馈 390px 横向溢出及失败提示内部码；本角色据此修正。最终浏览器旅程、截图和完整验收由主会话重新执行并记录，本角色不将单测或截图查看视为所有验收通过。

独立验收指出恢复模式变更的等待窗口后，`setRestoreMode` 现在同步进入 `previewBusy`，阻止执行按钮提交旧模式；按请求代次只接纳最新预览，旧响应不覆盖新选择。变更失败时保留先前有效预览，并让模式下拉框恢复到真实模式。修改完成后已通知主会话运行最终真实 Chrome 复验。

真实 Chrome 的键盘检查进一步发现结果切换后的焦点需要主动迁移。现在操作结束且状态释放后，按可见的“重试 → 恢复刚收起页面 → 完成”顺序选择焦点。关闭后优先返回原触发按钮；项目列表重画导致按钮已脱离 DOM 时，以项目 ID 和动作查找替代按钮，必要时回退“保存项目”。不把焦点落在已隐藏的预览区或页面 body。

最后的中文预览检查发现，安全事务已保留共享页面，但来源预览的“将收起”仍按普通收起计数。现在切换预览扣除目标项目共享网址，并在候选项标注“目标共享 · 保留打开”；普通收起不扣除。换来源、勾选或更换恢复模式后均重新计算。该修复只改变预览表达，不修改后端关闭边界。

## 设计偏差与已知边界

没有引入新的独立应用或重做整套页面。主区保留旧工作区数据与高级入口；项目卡按已有 entries 统计可继续的网址，完整布局由后端 session 提供。跨页面并发不作额外承诺，后端服务负责真实事务与过期预览校验。真实网页表单和未保存内容不在恢复范围。
