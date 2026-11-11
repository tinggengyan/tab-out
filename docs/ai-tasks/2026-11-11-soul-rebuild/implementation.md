# Tab Out 灵魂重建：实施记录

- 日期：2026-11-11
- 实施者：Claude（按 [plan.md](./plan.md) 在会话内逐项执行）
- 分支：`rebuild/soul`，起点为归档提交 `cd4289f`（标签 `v2.3-workbench-archive`）。未合入 `main`，未推送。

## 结果

| 项 | 改造前（v2.3 工作区） | 改造后（3.0.0） |
|---|---|---|
| 扩展代码行数（js/css/html/manifest） | 14,635 | 4,588 |
| 权限 | tabs、tabGroups、storage、favicon、alarms，另有 license host、可选的 history、scripting、全站点 | tabs、storage、favicon |
| 首张卡片顶部（1440×900，同一组测试标签） | 190px | 80px |
| 首屏常驻可见控件 | 68 | 30 |
| 收纳本站 | 5 次点击，2 层弹窗 | 1 次点击，可撤销 |
| 关闭本站 | 2 次点击（藏在"更多"里） | 1 次点击，可撤销 |
| 找回收纳 | 切换视图，约 3–4 次点击 | 首页右栏 1 次点击 |
| 页面外部网络请求 | Google favicon（原版）/ 无 | 无（测试断言为 0） |

## 各任务提交

| 任务 | 提交 | 内容 |
|---|---|---|
| 1 | `0f9fb5b` | 以 `40579ec` 为基底，删除 v2 功能面；静态契约测试 |
| 2 | `e886806` | `lib/sanitize.js`、`lib/grouping.js`；全部插值转义；图标改用 `_favicon` |
| 3 | `ec64acb` | `lib/close-undo.js`；所有关闭操作按标签 ID 执行并可撤销；全局去重；"关闭全部"只在首次确认 |
| 4 | `00f9dad` | `lib/collected-store.js`（`collectedGroupsV3`）；一次性迁移；"已收纳"栏移到"稍后查看"之上 |
| 5 | `363d9a0` | `lib/config-io.js`：导出 v3；导入兼容 v1 与 v2.3 备份 |
| 6 | `699eb6e` | 卡片按钮单行、短文案；行内按钮悬停才出现；区头全局动作；打包本地字体 |
| 7 | `a3d777e` | 首页守护测试 `npm run e2e:home`（zh-CN、en） |
| 8 | 本提交 | README、CLAUDE.md、PRIVACY、CHANGELOG 3.0.0、本记录 |

## 验证（2026-11-11 本机）

- `npm test`：47 项全部通过。
- `npm run check`：`PASS syntax: 20 JavaScript modules`。
- `npm run e2e:home`：zh-CN 与 en 各 13 条断言全部通过，覆盖 design.md §5 中的第 1–10 条及"关闭全部"只确认一次。第 11–13 条由单元测试和静态契约测试覆盖。
- `npm run package`：生成 `dist/tab-out-3.0.0-store.zip`，共 31 个条目。

## 偏离计划之处

每一条偏离都在执行账本中记为 Ruling，最终汇总见交付说明。要点如下：

- 行内 × 关闭这个网址的所有副本，不再只关第一个副本。
- "稍后查看"也纳入撤销范围。
- 去重时优先保留固定页那一份。
- "关闭"按钮改用中性墨色，琥珀色只留给重复项。
- 数量徽标只显示数字。
- 只要有一张卡片放不下完整文案，所有卡片统一改用短文案。
- 右栏用一个 `<aside>` 同时承载"已收纳"和"稍后查看"。
- 英文文案改用 Stash / sites。
- 导入去重同时比较 id 与 sourceId。

## 未做与已知限制

- **页面不会实时刷新。** 与原版一致：在别的窗口开关标签后，需要重新打开新标签页才能看到变化。
- **2.x 的旧数据保留但不再读取。** 包括快照、浏览记忆等。设置里没有"清理旧数据"入口。
- **AGENTS.md 未改。** 这是上游的安装向导，内容仍然适用。
