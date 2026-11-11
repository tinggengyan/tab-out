# 多语言核心实现

状态：实现及开发者自测完成，Chrome 集成与独立验收由主会话继续执行。原始需求、冻结标准见 task.md。

## 变更

- `extension/i18n.js`：保留既有英/简中词典，新增 58 项设置/平台/状态/无障碍词条；四语言各 577 项。合并两个独立翻译文件，不通过英文覆盖掩盖缺译。统一偏好键 `interfaceLanguageV1`，值 auto/en/zh-CN/zh-TW/ja。
- `TabOutI18n.ready` 完成初始读取；`.locale` / `.preference` 提供当前值；`.setLanguage(value)` 先保存再变更，等待本地更新订阅者结束；`.onChange(fn)` 注册。写失败保留旧语言，队列恢复后可重试。读失败和无效存储值按自动选择继续。
- 自动选择尊重 navigator.languages 顺序，再 navigator.language、Chrome 界面语言及英文；Hant/Hans 优先于中文地区；TW/HK/MO 繁体。Intl.PluralRules 统一计数；日期及 html lang 使用当前语言。
- 设置新增语言选择、状态和保存失败提示。五个选项支持键盘；保存时短暂禁用，结束后在未转移至其他控件时恢复焦点。无刷新，不改变当前视图。
- 导航、项目、浏览记忆及平台 UI 等待语言读取后初始化，并原位更新已有控制器。模型地址/模型名/密钥/排除项草稿不回填，搜索状态、结果、选择及模型摘要不改变。权限请求前没有新增 await。
- 搜索平台从独立双语 COPY 改为统一词典，更新静态标签及已有列表，保留平台表单草稿。主页面保留标签选择、展开卡片、归档查询、工作区与清理勾选，更新动态 Undo/导入/恢复提示。语言重绘回收站不触发过期清理。
- 补充通用关闭/搜索及工作区颜色无障碍名称，元数据文件与翻译由其他拥有者负责。

## 文件归属

修改：`extension/i18n.js`、`index.html`、`app.js`、`style.css`、`src/ui/{dashboard-navigation,project-workbench,browsing-memory,search-platform-settings}.js`。
新增：`tests/unit/i18n.test.js`。
未修改后台、manifest、数据仓库、AGENTS.md、CLAUDE.md 或备份格式；保留已有未提交改动。未提交、推送或发布。

## 已执行验证

使用 `/Users/tinggengyan/.nvm/versions/node/v24.15.0/bin/node`：

- `node --test`：286/286 通过（原 277 + 语言 9）；证据 `evidence/core-tests.log`。
- `node tools/check-javascript.mjs`：54 个 JS 模块语法通过（包含主会话新增 Chrome 脚本）；证据 `evidence/core-syntax.log`。
- 最后语言选择焦点补充后重跑 i18n、command-focus、dashboard-refresh、ui-contract 相关测试，全部通过；证据 `evidence/core-focus-tests.log`；app.js 语法复查通过。
- `git diff --check`：通过。
- 9 项语言测试覆盖自动匹配、脚本及地区、初次读取、读写失败与重试、快速切换顺序、完整键及占位符、复数和日期、安全回退及状态重译。

## 验证边界

Chrome 四语言实际切换、键盘与布局、真实原有流程回归由主会话运行并补充最终证据。本报告不将 Node 通过视为 Chrome 全部功能通过。新增翻译为开发翻译，未经母语者审校。当前不强制已打开的其他 Tab Out 页面同步切换，重新加载/新开页面会读取保存偏好；Chrome 管理页描述由 Chrome 自身语言控制。

## 独立审查修复轮次

根据主会话转交的明确不符合项修复：

- `projectMainStatus` 原来的备份失败/打开项目失败提示不会随语言变化。现在显式保留提示 key，语言回调重译已有提示，不重试备份或预览操作。提示先于列表刷新更新，即使后续读取失败也保留可理解的当前语言说明。
- `upgradeStatus` 现在保存已知 plan，语言切换仅重新渲染状态，不重新调用激活、支付或授权服务。计划名作为插值保留原文。
- 补齐先前实际调用但词典遗漏的 `memory.selectResult`。四语言现为 **578 keys**，复选框名称包含用户原标题。
- 增加所有 UI literal `t` / `tr` 调用 key 扫描，防止存在性检查只比较词典自身而漏掉调用端缺词；增加项目提示不重试业务和升级状态保留计划的真实行为单测。

修复后：语言相关 **12 项通过**；全量 **289/289 通过**（`evidence/core-tests-review-fix.log`）；**54 模块语法通过**（`evidence/core-syntax-review-fix.log`）；`git diff --check` 通过。Chrome 原始交互/布局及正式验收仍由主会话执行。

只读复核：语言通知使用 allSettled 让某个界面读取失败不阻止其他界面更新；写偏好失败发生在通知前并可重试。语言保存写入值是真实持久化结果，但通知故障不能只凭 setLanguage resolve 证明所有 UI 已完成，需依赖主会话逐界面 Chrome 断言。语言切换不触发业务提交、模型或权限请求；回收站重绘关闭过期清理写入。
