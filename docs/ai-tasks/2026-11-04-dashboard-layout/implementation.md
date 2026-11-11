# 首页层级修复：实现与验证

日期：2026-11-04。依据[冻结合同](task.md)和[用户截图审视](audit.md)。用户指出的问题成立：浏览记忆及空项目工作台叠在标签之前，功能检查通过并不能证明首页主任务可直接操作。

## 交付行为

1. 打开或刷新Tab Out，默认只显示当前标签、稍后阅读及标签收纳组。新增的完整工作台不再占据首页首屏。
2. 顶部一行“标签页／项目／浏览记忆”切换同页视图；导航在长内容中仍可用。项目与记忆保留原节点、控制器、搜索／采集／恢复能力，未改变数据结构或权限。
3. 切换保存各视图滚动位置，返回焦点在可见导航。记忆的查询、日期、结果、选择继续保留；后台完成不会强制进入隐藏视图。刷新始终回标签页，不保存上次活动视图。
4. 修复两类收纳同时显示时主栏固定最小宽度引起的溢出风险，并保留390px纵向布局。页脚工具全局可用。
5. 真实键盘补验发现并修复记忆确认框Tab边界，以及命令搜索观察器误把内部输入框记成返回焦点的问题。Escape只关操作弹窗，不关所属视图。

UI变更及自测细节见[Developer报告](developer-implementation.md)。主要文件为 `extension/index.html`、`style.css`、`i18n.js`、新增 `src/ui/dashboard-navigation.{js,css}`，以及原记忆／项目UI中的可见性保护。`app.js`本轮仅额外修复命令搜索和模态观察器焦点。此仓库含此前未提交实现，不能把相对HEAD的全部diff归为本任务。

集成侧新增 `tools/chrome-dashboard-layout-e2e.mjs` 和runner的 `--layout-only`；原项目／记忆旅程在开始及刷新后显式点击其入口。截图工具等待页面激活、有限动画及绘制帧，避免把旧滚动帧当作首屏证据。README、两份使用指南和CHANGELOG已更新入口说明。

## 实际验证

执行环境：项目根目录，Node24.15.0绝对路径 `/Users/tinggengyan/.nvm/versions/node/v24.15.0/bin/node`，隔离的Chrome for Testing151.0.7922.77。所有浏览器测试使用临时配置，未接触个人Chrome资料。

| 检查／命令 | 结果与证据 |
| --- | --- |
| 开发前 `node --test` | 265/265通过：[原始日志](evidence/baseline-tests.log) |
| 最终 `node --test` | 277/277通过，无失败／跳过：[最终日志](evidence/final-node-tests.log) |
| `node tools/check-javascript.mjs` | 51个模块通过：[语法日志](evidence/final-syntax.log) |
| `node tools/run-chrome-e2e.mjs --layout-only` | 英文布局、真实点击、滚动／焦点／状态／存量数据检查通过：[结果](evidence/final-layout-en/result.json)、[旅程](evidence/final-layout-en/layout/result.log)、[坐标](evidence/final-layout-en/layout/measurements.json) |
| 上述布局命令加 `TAB_OUT_TEST_LOCALE=zh-CN` | 中文对应检查通过：[结果](evidence/final-layout-zh/result.json)、[旅程](evidence/final-layout-zh/layout/result.log)、[坐标](evidence/final-layout-zh/layout/measurements.json) |
| `node tools/run-chrome-e2e.mjs` | 既有搜索／标签／项目完整旅程通过：[结果](evidence/final-regression/result.json)、[标签旅程](evidence/final-regression/regression/result.log)、[项目旅程](evidence/final-regression/projects/result.log) |
| `node tools/run-chrome-e2e.mjs --memory-only` | 采集、历史、模型协议、来源、备份、取消及真实后台重启通过：[结果](evidence/final-memory/result.json)、[旅程](evidence/final-memory/memory/result.log) |
| 静态与范围 | `git diff --check`、311个DOM ID唯一、39个本地资源存在、规则／后端保留校验：[汇总](evidence/final-check.json) |
| 交付包 | 55个文件与当前扩展源码逐字节一致、ZIP完整、manifest完全保留：[包校验](evidence/package-verification.json) |

实际首屏坐标在动画结束后读取，不以元素存在代替可见性：1440×900及1366×768下，英文首张卡片top为151px，中文为187px；首项稍后阅读及收纳组均在首屏。有重复Tab Out提示时，两个桌面尺寸也分别测量，英文为237px、中文273px，满足冻结的200／280px上限。所有三视图在两个桌面尺寸及390×844均无横向溢出。

布局测试以12个本机域名卡片、两类存量收纳、15个已有项目、30条记忆构造长内容，真实坐标点击sticky导航，验证≥400px滚动返回±2px；同时验证异步搜索隐藏后完成、确认框键盘闭环、三个视图中的命令搜索、两类单独／同时收纳组合、刷新回首页及业务资产逐项保持。按[独立初审](acceptance-review-1.md)补验连续长标题／URL的实际渲染、后台真实标签新增／关闭引起重绘时当前视图／滚动／焦点不变、三个视图页脚设置入口真实点击和命令搜索双向Tab循环。记忆查询在刷新后重新执行，保证响应矩阵测到实际长结果。种子写入等待隔离配置首次迁移完成，避免测试准备与迁移竞争；早期试跑失败记录保留，最终依据为 `final-*`。

## 视觉证据与交付

- 默认中文首页：[1440px](evidence/final-layout-zh/layout/01-home-1440.png)、[1366px](evidence/final-layout-zh/layout/04-tabs-1366.png)、[390px](evidence/final-layout-zh/layout/04-tabs-390.png)。已查看实际截图，首屏内容层级与用户目标相符。
- 按需视图：[项目](evidence/final-layout-zh/layout/02-projects.png)、[浏览记忆](evidence/final-layout-zh/layout/03-memory.png)。这两块只在用户进入时显示。
- 交付包：[tab-out-2.3.0-layout-fix.zip](../../../dist/tab-out-2.3.0-layout-fix.zip)，版本仍为2.3.0；源码目录可直接重载。旧 `tab-out-2.3.0-store.zip` 保留，原哈希未改变，不覆盖此前交付证据。
- SHA-256：`45264c4f90af2b12d503ffca03e40568a169d12b549f90d053a1a9c6af2a9d18`。

## 边界

本轮没有改后台、存储、权限、模型服务协议、许可证或版本，没有提交、推送、上架或定时任务。AGENTS.md／CLAUDE.md与进入本轮时哈希一致。原有用户数据不要求迁移、卸载或清空。

真实模型服务与实际内网站点仍留待用户配置联调。记忆Chrome旅程只在隔离副本中预授可选权限，没有自动操作原生授权提示；不把该测试当作真实模型质量或全面无障碍合规证明。独立结论见[验收报告](acceptance.md)。
