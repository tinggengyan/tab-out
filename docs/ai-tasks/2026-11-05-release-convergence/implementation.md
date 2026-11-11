# 发布前体验收敛实现与集成记录

依据冻结 task.md。两个 Developer 的详细文件/行为/自测记录分别见 [UI](ui-implementation.md) 和[检索](search-implementation.md)。本记录汇总主会话实际完成的集成工作，不替代独立验收。

## 已实现的主路径

- 标签页默认首页保留收纳与恢复；保存快捷操作并入桌面导航，窄屏自然换行。将项目命名收敛为“已保存”，旧工作区、收纳组、稍后查看及归档记录统一可见，高级规则与模板仍可访问。
- 名称可选、自动生成可读标题。窗口用序号及页面标题识别。旧收纳继续后保留原资产，复用已开页并只补缺失；部分失败可重试并复用目标窗口/native group，已有数据无迁移。
- Free 基础命令搜索跨打开、已保存、浏览记忆；结果来源可见，本地逐查询获取紧凑记忆结果，取消和序号保护排除迟到响应。
- 本地检索修正短词误命中，新阅读抽取保留论坛回复、排除草稿输入；旧原文不重写，查询时清理并输出最多 240 字符摘要、安全高亮和命中字段。摘要引用仍按原文校验。
- 真实显示暂停/已有记忆状态；本地模式隐藏上传授权；AI 切回本地即取消，包括没有授权正文的 query-only 请求。
- 设置可发现模型/记忆管理、独立记忆导出；普通配置备份明确不含记忆正文。隐藏未实现同步和未配置结账，保留已有授权管理；发布缺口记录在 RELEASE_READINESS.md。

## 主会话验证证据

环境：Node 24.15.0、Chrome for Testing 151.0.7922.77。所有 CLI Chrome 使用临时 profile 和合成网页，未操作用户实际保存资产；memory suite 在临时扩展副本预授予权限，不代表原生授权弹窗已实测。

| 检查 | 实际结果 | 证据 |
| --- | --- | --- |
| 完整 Node 测试 | 325/325，退出码 0（第2轮正式修复后） | evidence/final-node-tests.log |
| JS 语法 | 58 模块通过，退出码 0 | evidence/final-javascript-check.log |
| 差异空白检查 | git diff --check，退出码 0 | evidence/final-diff-check.log |
| 原回归与项目旅程 | 全部通过：精确标签身份、收纳撤销、快照恢复、配额/模拟已有授权、混合窗口选择、安全切换、布局与备份 | evidence/chrome-regression/result.json、各子目录/result.log |
| 浏览记忆旅程 | 全部通过：真实 DOM/登录页、IndexedDB、模拟兼容服务、query-only 切回本地取消、内容撤回、引用、HTTP失败、导出/导入与 worker 重启 | evidence/chrome-memory/result.json、memory/result.log |
| 发布收敛旅程 | 全部通过：旧三类/归档、免命名、混合故障仍同组、组消失与元数据目标关闭后连续重试完成、预先复用页不移动、Free 跨资产搜索/迟到响应、设置与实际记忆下载 | evidence/chrome-release/result.json、release/result.log、release/stale-targets.json |
| 布局旅程 | 全部通过：三视图三尺寸、真实滚轮/键盘、底栏、末尾控件、状态与数据保留、重复页面提示 | evidence/chrome-layout/result.json、layout/measurements.json |
| 四语言 | 四语言×三视图×三尺寸，通过原首屏阈值、齐平底栏、键盘选择、日期、焦点、草稿和失败恢复 | evidence/chrome-i18n/result.json、i18n/measurements.json |
| 预声明词法语料 | 28 页/20 题，前后目标前三均20/20；AI五个干扰结果降至0；显式网址仍匹配；摘要上限通过 | evidence/retrieval.json；tools/fixtures/memory-retrieval.json |
| 保护文件/安装包 | AGENTS、CLAUDE、manifest、配置、记忆仓库/runtime/model client 字节不变；四个旧包不变；新包61项逐字节等于源码 | evidence/package-verification.json |

测试适配保留原标准：收纳卡片新增内容标题后，日期断言指向独立日期字段；导航加入仅标签页可见的快捷按钮后，分别验证三视图按钮和快捷按钮，不将隐藏的快捷按钮误判为导航失效。最初首屏210px、重复提示284px的失败真实触发了布局修复，未放宽200px/280px阈值；失败日志保留在 evidence/*failure.log。最初基线失败来自本轮临时复制的测试被Node重复发现，复制已移至外部临时目录/归档，原基线293/293正常。

## 本机实际界面抽查

通过 CUA 确认 Chrome 的扩展确实加载本仓库 extension/，重载后“已保存”能看到8个旧组；28条旧记忆、暂停状态保留；本地 AI 查询从之前20条变为10条，摘要紧凑并高亮。该单次实际查询不构成总体相关性评价。没有模型调用、购买、权限扩大或增删真实保存资产，最后回到标签页。

实际用户截图只保留在本机独立可视化目录 `tab-out-release-convergence-2026-11-05/`，不放入仓库或上传。

## 可用产物与边界

试用包：dist/tab-out-2.3.0-release-convergence.zip，61文件，211592字节，SHA-256 `03206c41b39200d824596afa8a13572feb923c3a579569fbbd9560a57a6d0518`。四个既有任务安装包不覆盖。前两候选的校验记录保留在 package-before-acceptance.json、package-before-fix-2.json，不能作为本次通过包。

尚未验证用户实际模型服务、真实私有站点全覆盖、原生权限弹窗与母语翻译审校；合成词法和一次性能测量不能证明真实召回/留存。旧收纳的元数据失败重试上下文仅保存在当前页面，刷新后仍能去重补开，但不持久化此前元数据失败提示。抽取不新增 iframe/Shadow DOM/PDF/Canvas 识别。

支持联系信息、销售条款与真实结账/签名服务尚待配置；同步未实现。本轮不提交、推送、上传商店或正式收费发布。独立验收另见 acceptance.md。

## 第1轮正式修复

独立验收首轮判定 AC4 FAIL，其余12项通过，详见 acceptance-round-1.md。主会话以真实 adapter 和隔离 Chrome 双重确认：页面 create 与 native group 首次同时失败，重试把成功页拆成两组却报告完成。新增 Chrome 回归在修复前因2组而失败（evidence/chrome-combined-before）。

修复仅在 saved-library facade 协调旧分组失败和本次补开结果，按 groupRef 合并本次拥有且仍存在的成员，复用单一目标组；不移动预先复用页，不修改共享adapter或旧资产。新增真实adapter测试覆盖重复分组失败、组属性失败和中途关闭页面。根重现退出1→0；最终316/316及Chrome组合失败旅程通过。共享adapter、操作服务、项目服务、工作区仓库亦新增字节不变校验。修复后重打包、重生成本轮source diff，独立复验另行记录。

## 第2轮正式修复

第1轮修复复验仍判定AC4 FAIL：旧组/窗口被用户关闭后映射失效，以及元数据失败页被关闭后旧targetTabId仍被重试，详见 acceptance-round-2.md。根Node重现和隔离Chrome均证实永久partial；Chrome确实销毁了空组，原始 `chrome-stale-before/release/stale-targets.json` 同时记录两个场景。

修复仅在facade校验映射存活与目标窗口、过滤消失的元数据目标，保留本次拥有的恢复成员；组在检查后消失时最多重建一次，普通错误仍如实partial。新增严格ID的真实adapter测试共17/17，覆盖有效目标保留、全部关闭、wrong-window不移动以及检查间消失。根两份重现均退出0；Chrome同脚本修前失败→修后全部通过，连续继续不再卡partial、原固定属性仍恢复；最终325/325、JS58、diff检查通过。重新校验11项保护文件并生成61文件新包，等待最终独立复验。没有第三轮自动修复。
