# UI 实现与自测

Developer 实现记录，2026-11-05。依据 task.md 与 product-agreement.md 的冻结范围实现；本记录不表示独立验收通过。

## 实际变更

- `extension/index.html`：顶栏静态回退文案恢复 Projects；主项目列表之后先显示项目空态，再显示临时收纳、稍后查看两个原生 details（可用键盘展开，初始不带 open）。归档 details 保留在稍后查看内部。
- `extension/src/ui/project-workbench.js`：主列表、项目数量、项目空态只依据 workspace；临时收纳与稍后查看分别渲染到独立列表。稍后查看总数包含未忽略的活动与归档记录，文案明确“含归档”；归档另外显示数量。刷新只更新标题与列表内容，不重建 details 或设置 open。
- `extension/src/ui/project-workbench.css`：次级区轻分隔、summary 样式与可见键盘焦点。
- `extension/app.js`：首页快捷入口恢复项目语义；旧收纳的继续按钮使用独立通用文案，避免误标成“继续项目”。原 action、项目导航目标与恢复接线保持不变。
- `extension/i18n.js`、`extension/locales/zh-TW.js`、`extension/locales/ja.js`：四语言恢复顶栏、保存/新建/继续/切换/空态/介绍/额度错误和搜索项目来源语义。浏览记忆“保存所选”实际创建 workspace，因此其保存按钮与结果文案明确保存为项目。保留跨类型 Saved、原生标签组相关描述、可选命名提示与用户原有资产名称。
- `tests/unit/project-workbench-ui.test.js`：新增 3 个实际调用 refresh 的行为测试，覆盖混合数据分区与计数、活动/归档不能抑制项目空态、数据刷新保留独立折叠状态；同时检查渲染不修改原始资产和重试按钮接线标识保留。

未修改后台、业务/恢复服务、数据仓库、权限、manifest、saved-library 安全继续实现、检索或正文抽取；保留此前未提交改动。未提交、推送、发布。

## DOM 与文案契约

| 区域 | Selector | 数据/显示规则 |
| --- | --- | --- |
| 项目主列表/数量/空态 | `#projectList` / `#projectListCount` / `#projectEmpty` | 仅 workspace；零 workspace 时显示空态 |
| 临时收纳 | `#savedCollections` / `#savedCollectionsTitle` / `#savedCollectionsList` | summary 使用 `saved.collections({n})`；仅 collected |
| 稍后查看 | `#savedLater` / `#savedLaterTitle` / `#savedLaterList` | summary 使用 `saved.later({n})`，含归档总数；列表仅活动 deferred |
| 稍后区内归档 | `#savedArchive` / `#savedArchiveTitle` / `#savedArchiveList` | summary 使用 `saved.archive({n})`；归档为零时隐藏 |
| 首页入口 | `#tabsSaveBtn` / `#tabsParkBtn` / `#tabsSavedBtn` | `project.saveProject` / `project.parkProject` / `project.continueProjects`；内部 `show-saved` 仍进入 projects |

所有记录卡片继续保留 `data-project-action` 或 `data-saved-action` 与对应 ID/kind。新旧存储格式、用户名称、免命名默认名逻辑不变。

## 已执行的自测

执行环境：macOS 项目根目录，Node `/Users/tinggengyan/.nvm/versions/node/v24.15.0/bin/node`。

| 命令 | 实际结果 | 原始证据 |
| --- | --- | --- |
| `node --test tests/unit/project-workbench-ui.test.js tests/unit/project-undo-ui.test.js tests/unit/i18n.test.js tests/unit/dashboard-navigation.test.js tests/integration/ui-contract.test.js` | 55/55 通过；四语言键与占位符匹配、项目控制器/撤销/导航/HTML ID 检查通过 | `evidence/ui-targeted-tests.log` |
| `node --test` | 328/328 通过（实现前 325，本次新增 3） | `evidence/ui-node-tests.log` |
| `node tools/check-javascript.mjs` | 58 个 JavaScript 模块语法检查通过 | `evidence/ui-javascript-check.log` |
| `git diff --check` | 退出码 0，无差异格式错误 | `evidence/ui-diff-check.log`（空输出） |

与实现前源码归档逐文件比对保存为 `evidence/ui-baseline-diff.patch`，仅包含本次所归属的 8 个 UI/测试文件增量，不混淆工作区原有变更。

## 未由本 Developer 执行的验证

真实 Chrome 的零项目/混合数据、原复杂继续/恢复重试、四语言与三视图三尺寸、固定底栏与滚动、打包和本机扩展重载，由根协调者执行并记录。这里的轻量 DOM mock 单测不构成原生 details 键盘行为或实际布局通过的证据。独立 Tech Lead 尚需依据冻结标准验收。

## 偏差与剩余风险

无存储或功能范围偏差。稍后查看总数选择含归档，避免仅有归档时标题为零而仍藏有资产；四语言 summary 均明确该口径，已与根对齐。实际布局与浏览器操作仍以根提供的后续证据和独立验收结论为准。
