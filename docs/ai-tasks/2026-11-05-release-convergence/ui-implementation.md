# UI 实现记录

模式：Forge Developer。范围依据同目录 task.md 的冻结验收条件；此文件是实现与自测记录，不替代独立验收。基于已有大量未提交代码继续修改；未提交、推送或发布。

## 实际行为

- 主导航“项目”改为“已保存”，内部 `projects` 路由与原 workspace 存储结构保留。一个列表展示原 workspace、原 `tabGroups` 和未完成 deferred；完成的 deferred 可从同页归档折叠区打开。仅增加只读适配，没有迁移、清空或改写这些旧资产。
- “高级管理 · 规则与模板”从已保存页和底栏可达，原模板、规则、转移、删除/回收站等操作保留。标签页仍是默认首页，增加一行紧凑的“仅保存 / 保存并收起 / 继续已保存”快捷操作；原域名/窗口卡片、收纳和稍后查看保留。
- 保存名称可留空；提交时从第一条选中页面的标题或域名生成名称。没有选中页面仍不能提交，预览、固定页保护、关闭数量和撤销沿用原事务服务。窗口使用可读序号和页面标题；旧收纳卡片使用内容标题，日期作为辅助信息。
- 旧收纳组继续改用 `saved-library.js` 辅助器：完整保存资产保留；先读取实际已开页面，再把缺失页面交给现有 session adapter。继续及单页打开都不再删除原保存记录。部分失败显示计数和重试；重试保留已创建窗口/native group 的映射，并重试元数据失败，避免重复打开成功页面。
- Free 命令搜索的本地索引包含原 workspace、收纳组、active/archived deferred；历史快照与高级筛选仍按原授权控制。每个普通关键词查询另外调用 memory runtime `search(useAI:false, includeContent:false, days:365)`，只取当前查询的紧凑结果，不把全库正文读到 UI。结果有来源，提示说明范围为已开/已保存/近一年浏览记忆；请求序号和取消使旧响应不能覆盖新查询。
- 浏览记忆结果消费新 `snippetParts` 与 `matchedFields`：逐段 `textContent` 渲染，命中片段用 `mark`；只有连接结果严格等于 snippet 时才采用 parts。命中来源名称四语言本地化。命令结果中的 snippet 同样安全转义。
- 本地模式隐藏模型正文同意、上传说明和摘要按钮；AI 模式显示相关内容，切回本地撤回当前正文同意并保留已有取消逻辑。已有记录显示可搜索的总数及记录/暂停事实；真正 0 条时才提示启用记录/导入。
- 设置新增“记录与模型设置”和独立浏览记忆导出入口。普通备份明确排除浏览记忆及采集正文；下载文案只说已经请求。已有授权在设置中管理；未配置 HTTPS checkout 时不显示购买卡片；同步购买卡片始终隐藏，并在点击入口拒绝 sync checkout。
- 四语言的新增键与占位符一致；保存弹窗与主页面的可见“项目”文案统一为保存分组语义。沿用固定底栏、各视图独立滚动恢复；语言重绘保留弹窗选择/名称和候选列表、弹窗滚动。部分小按钮增大、正文辅助信息加深颜色。

## 文件归属内改动

- `extension/app.js`、`extension/index.html`
- `extension/i18n.js`、`extension/locales/zh-TW.js`、`extension/locales/ja.js`
- `extension/src/ui/project-workbench.js`、`extension/src/ui/browsing-memory.js`
- `extension/src/ui/dashboard-navigation.css`、`extension/src/ui/browsing-memory.css`
- 新增 `extension/src/ui/saved-library.js`
- `tests/unit/free-command-palette.test.js`、`tests/unit/command-focus.test.js`、`tests/unit/project-workbench-ui.test.js`、`tests/unit/browsing-memory-ui.test.js`
- 新增 `tests/unit/saved-library-ui.test.js`

没有修改后台、记忆检索/内容抽取、权限、密钥、仓库存储格式、Chrome 工具或 task.md 的冻结验收标准。其他文件的既有或并行改动不属于本 UI 记录。

## 真实自测

环境：`/Users/tinggengyan/.nvm/versions/node/v24.15.0/bin/node`。

| 命令 | 结果 | 原始证据 |
| --- | --- | --- |
| `node --test` | 311/311 通过；包含并行 Search Developer 的测试 | `evidence/ui-node-tests.log` |
| `node tools/check-javascript.mjs` | 58 个 JS 模块语法通过 | `evidence/ui-javascript-check.log` |
| `git diff --check` | 退出码 0 | 本次执行输出无告警 |

新增测试覆盖：旧三类只读适配与归档；可读默认名称；旧资产 partial continue 后保持完全不变；成功页面不重复、重试使用已创建窗口/native group 映射、原颜色/折叠/固定状态保留；只失败元数据重试；Free 保存范围、逐 query 本地 memory、旧结果竞态；免命名提交；snippet 安全渲染与不匹配 parts 降级。

首次全量自测出现 3 个测试夹具缺少新查询状态变量，已补充夹具后全量通过。原始首轮输出保留在 `evidence/ui-tests-first.log`。

## 集成与仍需独立判断

Chrome 集成由主会话拥有并执行。主会话反馈 memory、新 release、regression/projects suite 已通过；首次 layout/i18n 检查发现快捷行使 1440×900 首卡 top 为 210.1875px，超过既有 200px 标准。首轮修复收紧了 12px 间距后，英文普通首屏满足要求，但多语言标题换行和 duplicate banner 场景仍不满足原标准。UI 随后将桌面快捷操作并入导航现有行，仅标签页显示，移除独立快捷行的高度；窄屏保留可读换行，收纳长标题最多显示两行。未改测试阈值；后续重跑结果以主会话 Chrome 证据和独立验收为准。

没有实际调用用户模型、支付服务或同步服务；不将合成资料、纯单测或代码修改称为实际模型联调/正式发布验收。旧收纳继续的失败重试状态仅保存在当前 dashboard 实例；刷新后再次继续仍会读取真实已开页并补缺失页面，但不会保留此前失败的 native group 元数据重试提示。该实现不改旧资产结构；若需跨 dashboard 关闭仍持续恢复元数据，应另行设计可持久化的恢复任务。

## 定点补修：切回本地取消 query-only AI

主会话明确将“AI 查询进行中切回本地应取消，无论此前是否勾选正文”纳入 AC8/AC11。新增控制器 `setSearchMode`，在 query-only AI 和含正文 AI 的待处理请求中统一发出原 requestId 的取消消息，并使旧响应失效；UI 模式选择调用该控制器方法。没有触碰请求权限的直接点击链路。

新增延迟控制器行为测试：query-only AI 开始 → 切回本地 → 确认 cancel → 完成本地新查询 → 旧 AI promise 返回 → 仍保留本地结果。补修前该测试因缺少方法正确失败，证据 `evidence/ui-mode-cancel-before.log`；补修后浏览记忆 UI 单测 22/22，证据 `evidence/ui-mode-cancel-after.log`。该模块 `node --check` 退出码 0。最终全量和 Chrome memory 复验由主会话执行。

## 正式独立验收第 1 轮定点修复：混合创建/分组失败

独立验收确认 AC4 缺陷：同一源 native group 的 a/b 成功恢复、c 创建失败且首次分组失败时，下一次继续先把 c 建为 group 90，再由旧 failure 把 a/b 建为 group 91，错误返回 complete。修复严格限制在 `extension/src/ui/saved-library.js` 与 `tests/unit/saved-library-ui.test.js`；原 `chrome-session-adapter.js` 未修改。

facade 现在分步协调：先通过原 adapter 补缺页及重试 tab 元数据，再按 `groupRef` 合并旧失败成员与本次 `restoredTabs` 成员，复用本次最新的 group mapping 一次统一分组并恢复 title/color/collapsed。若再次分组或属性更新失败，保留完整合并成员和已创建组 ID 供下一次重试。成员按实际 `tabs.query` 存活、原组 URL 和目标窗口过滤，不纳入用户预先打开的复用页，不把已关闭的旧 tab ID 带到下一次 Chrome 调用。保存资产未改写。

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| 冻结根重现 `node evidence/repro-legacy-group.cjs` | 原退出 1；修复后退出 0，a/b/c 均在 group 90；第二次只打开 c | `evidence/legacy-combined-failure-before.log` / `evidence/legacy-combined-failure-after.log` |
| 新真实 adapter 行为测试（修复前） | 3 条按预期失败：拆组、旧失败成员未合并、属性失败缺 canonical ID | `evidence/ui-combined-group-before.log` |
| `node --test tests/unit/saved-library-ui.test.js`（修复后） | 8/8 通过 | `evidence/ui-combined-group-after.log` |
| `node --check extension/src/ui/saved-library.js` | 退出 0 | 本次工具结果 |
| `git diff --check` | 退出 0 | 本次工具结果 |

新增场景还包括第二次仍无法分组后第三次恢复、合并后 native group 属性更新失败后再试、仅组属性失败、两次继续之间关闭成功页后的补开；每步校验原 asset 的 JSON 字节不变、已开复用页窗口及 group ID 不变、成功页不重复创建、native group 属性仍正确。Chrome 同故障场景、最终全量与新包由主会话复验，本文不把局部自测称为独立验收通过。其余 UI 保持冻结。

## 正式独立验收第 2 轮定点修复：过期恢复目标

独立复验与真实 Chrome 确认两个同类 AC4 缺陷：原 native group/窗口被用户关闭后，旧 group ID 仍被重复使用；原固定状态更新失败的页面被关闭后，旧 targetTabId 仍被反复更新。根重现 `repro-stale-targets.cjs` 修复前退出 1，两场景第三次仍 failed=1。本轮仍只修改 saved-library facade 和对应单测，不改 adapter、其他 UI、冻结标准或资产结构。

恢复前现在用 `chrome.tabGroups.get` 校验 groupMappings 与旧 groupFailures.existingGroupId 的存活及目标窗口；明确已失效或已移窗的映射不再传给 adapter。metadataFailures 仅保留 `tabs.query` 当前存在的目标页，新补开的页面继续由原 session 元数据应用 pinned/active。仍活着的旧映射和失败继续保留。retryState 记录本轮拥有的 restoredTabs，使原组消失后，仍存活的旧恢复成员与新补开成员可以重新归同一组；用户预先打开或已移动到别的窗口的页面不被纳入移动。

校验之后 native group 仍可能在 group/update 之间消失。只对 Chrome 明确报告不存在/失效 group ID 的错误清理该 ID，并最多创建重试一次。普通 group/update 故障仍返回 partial，保存有效映射和失败等待用户再试。不会仅因过滤掉失效目标就把尚未成功的分组操作报告为完成。

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| 根两个过期目标重现 `node evidence/repro-stale-targets.cjs` | 修复后退出 0；新 group 91 包含 a/b/c，固定页面替换为新 ID 且 pinned=true；第二、三次均 failed=0 | `evidence/stale-targets-before.log` / `evidence/stale-targets-after.log` |
| 第 1 轮混合故障重现 `node evidence/repro-legacy-group.cjs` | 仍退出 0，a/b/c 同 group 90 | `evidence/legacy-combined-failure-round2.log` |
| 严格 ID 验证、真实 adapter 测试（实现前） | 6 条新增行为失败，准确覆盖过期组/窗口、旧 failure ID、旧 metadata ID 和校验期间消失 | `evidence/ui-stale-targets-before.log` |
| `node --test tests/unit/saved-library-ui.test.js`（实现后） | 17/17 通过，原 8 条全部保留通过 | `evidence/ui-stale-targets-after.log` |
| `node --check extension/src/ui/saved-library.js`、`git diff --check` | 均退出 0 | 本次工具结果 |

严格测试中的 Chrome API 会拒绝不存在的 tab/group/window ID，并真实更新 native group 成员；覆盖过期组及整窗、过期旧 failure 组 ID、关闭 metadata 失败页、仍活目标保留、adapter 与 facade-only 两条路径上 get/group/update 之间的组消失、普通临时错误保持 partial，以及移窗映射不牵动用户已有页面。每条恢复场景持续检查保存资产 JSON 字节不变和成功页不重复创建。最终真实 Chrome 场景、全量与包一致性由主会话复验，本文仍是实现/自测记录。
