# 独立验收：恢复 Project 独立入口

**结论：PASS，冻结9项验收标准全部通过。** 恢复覆盖入口、主列表、计数、空态和旧资产分区，不只是改名。未发现阻止交付的确定缺陷，无需追加修复。

验收者 `/root/project_identity_acceptance`，独立于规划和实现，只读审查。根据其返回正文保存本记录。核读项目规范、冻结task/产品共识、实现记录、实际源码增量、断言和原始日志；未修改文件、重跑写入性浏览器旅程或操作真实资产。

## 逐项核验

| AC | 结果 | 证据与判断 |
| --- | --- | --- |
| 1 | PASS | 四语Projects/项目/專案/プロジェクト；首页及顶栏实际点击进入projects；Chrome断言重载默认tabs。 |
| 2 | PASS | 主list仅workspace结果，count为workspaces.length；实际refresh单测及Chrome混合数据验证1项目，旧收纳不在主list。 |
| 3 | PASS | 空态仅依据workspace数量；单测覆盖活动旧记录、仅归档、归档清空，Chrome保留旧三类时清空合成workspace仍显示0与空态，零项目截图有效。 |
| 4 | PASS | 两个原生details默认不带open，标题数量独立，稍后计数明确含归档；Chrome真实聚焦summary发送Space展开、打开稍后/归档，refresh后open保留，单测验证折叠状态独立。 |
| 5 | PASS | 四语创建/保存到/新建/继续/空态表达项目，旧收纳通用继续不误称项目；免命名逻辑未改且单测/Chrome通过，语言旅程业务存储完全一致，无名称重写/迁移/自动转换。 |
| 6 | PASS | Chrome projects15旅程实际断言覆盖选择/仅保存/预览/固定和无关页保护/原窗口及nativegroup撤销/复用/安全切换/失败保留来源和只重试失败项；服务源码不变。 |
| 7 | PASS | 次级ID/kind/事件保留；Chrome真实注入create+group组合故障，保留源/去重/不移原页/同组重试；组及metadata目标实际消失后连续继续完成。helper/adapter未改。 |
| 8 | PASS | Free索引仍含已开/项目/收纳/活动及归档稍后/逐query本地记忆；项目来源标签恢复。全量包含类别覆盖/迟到保护/授权撤回取消；Chrome实际项目/记忆搜索、旧响应隔离、本地隐藏正文上传。检索/runtime/client不变。 |
| 9 | PASS | 基线325、定向55、全量328、语法58通过；验收者独立diff检查退出0。四语×三视图×三尺寸36项measurement无异常，layout保留真实滚轮/键盘/末尾命中与齐平footer，保护文件和包核验见下。 |

原始证据相对本目录evidence/：ui-node-tests.log、ui-targeted-tests.log、ui-javascript-check.log及chrome-release、chrome-projects、chrome-i18n、chrome-layout各result.json/result.log/measurements.json。

## 独立复核

独立读取128文件基线归档并核验哈希，全部与记录一致；当前增量与current-source-diff.patch完全相同，未把旧git dirty归入本轮。

15保护文件相对基线不变：manifest、后台、仓库、项目/操作/恢复服务、安全继续helper、检索/抽取/模型和记忆UI等；7既有ZIP大小及哈希不变。独立逐项读取新ZIP，61文件全与extension源码一致，仅排除本机.DS_Store。

新包：dist/tab-out-2.3.0-project-identity.zip，211918字节；SHA-256 `2d7bfd8c7287be6cfc7775cfa063fc66ee829dc27813e30bc011f83db4c259a6`。

已审保留的三次初始工具失败和当前断言。卡片selector、原生Space输入、closed-details几何测量的适配符合实际问题，没有放宽行为要求。原首卡200px/重复提示280px阈值仍在，实际154px/240px。末尾检查先展开真实次级内容，再测命中和键盘可达。

CUA记录显示本机重载后0项目/临时收纳8/稍后0，截图哈希一致；验收者未读取私人标题，不将界面抽查扩大为真实资产恢复实测。

## 边界

本轮无确定不符合项。实际模型provider、商用付款配置、原生权限提示、真实站点覆盖、繁中/日文母语审校及跨刷新恢复任务的已有边界未由本轮消除；相关行为没有更改。结论支持本地试用与匹配包，不代表全产品/商店已上线，也不授予提交、推送或对外发布许可。
