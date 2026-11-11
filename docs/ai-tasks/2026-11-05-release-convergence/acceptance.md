# 发布前体验收敛：最终独立验收

**最终结论：PASS。冻结的13项验收条件全部通过。** 独立验收发现的组合失败拆组、失效组映射和已关闭元数据目标三项AC4问题，已在两轮正式修复后通过源码审查、失败前后重现和相关Chrome验证。

本结论适用于本轮本地体验收敛及试用包，不代表实际模型服务已联调，也不代表正式收费或商店发布条件已满足。

验收者：`/root/release_acceptance`，独立于规划和实现，严格只读。本文由主会话保存其最终结论及证据要点；前两次FAIL分别保留在 acceptance-round-1.md 和 acceptance-round-2.md。

## 验收方式

核读冻结task、根汇总与两份实现记录；相对本轮前快照的source diff、基线哈希及变更清单；关键源码、测试断言、原始日志、结果JSON、布局测量及代表截图；主会话执行的失败重现、修复后结果与包校验。没有将旧有未提交改动全算成本轮改动，没有编辑源文件、操作用户真实资产或自行运行写入性检查。

## 逐项结果

| 编号 | 结果 | 核验与主要证据 |
| --- | --- | --- |
| AC1 | PASS | 默认标签页、保留收纳操作；两桌面尺寸首卡top均154px，底栏齐平、内容独立滚动。chrome-layout/layout/measurements.json及四语言截图。 |
| AC2 | PASS | 已保存统一workspace/tabGroups/deferred，归档和高级规则模板可达，无旧资产迁移/改写；Chrome release验证旧三类及归档。 |
| AC3 | PASS | 免命名生成内容标题、窗口序号与页面信息；选择/关闭预览/固定页保护/撤销保留，Node与Chrome projects/release覆盖。 |
| AC4 | PASS | 保留完整资产、复用且只补缺失；组合失败、重复组/属性失败、组窗消失、目标关闭及检查间组消失均有证据，预先复用和用户移窗页不被牵动。详见修复核验。 |
| AC5 | PASS | Free搜索已开/已保存/近一年记忆，来源与范围可见；逐查询本地检索，取消/序号保护迟到响应，打开复用。单测及Chrome release验证。 |
| AC6 | PASS | 短词边界排除baidu/baike/paid/trail片段，显式URL可查；预声明28页20题目标前三前后20/20，修改后目标均第一，5个AI干扰降0。fixture、评估脚本、retrieval.json。 |
| AC7 | PASS | 阅读块/论坛回复保留，输入/表单/编辑区/隐藏内容排除；旧记录直接获得≤240字符安全高亮摘要，原始record.text仍用于引用校验。相关单测和Chrome memory。 |
| AC8 | PASS | 0条/有记录/暂停状态真实；本地隐藏上传和摘要操作，AI切回本地取消query-only或含正文待处理请求并使旧响应失效。单测和Chrome memory。 |
| AC9 | PASS | 设置发现模型/记忆；普通备份排除记忆正文，独立记忆导出实际下载，界面仅报告请求。Chrome projects/release/memory及下载文件。 |
| AC10 | PASS | 同步不展示购买且处理器拒绝sync，结账未配置隐藏卡片；已有授权管理保留，RELEASE_READINESS如实记录商用缺口。 |
| AC11 | PASS | 四语言键/占位符及四语言×三视图×三尺寸；查询/选择/滚动/草稿/失败本地化/焦点关闭有证据。母语审校待做。 |
| AC12 | PASS | 最终Node325/325，无失败跳过；JS58模块和diff通过；Chrome regression/projects/release重跑通过，memory/layout/i18n相关源在定点修复未变，原证据适用。实际模型未联调边界明确。 |
| AC13 | PASS | 数据、权限、密钥路径未发现倒退；11关键保护文件/四旧包不变，新包61项匹配源码，任务/实现/独立验收齐全。 |

表中原始证据相对本任务目录的evidence/。

## 两轮修复核验

首轮发现页面创建与原生组创建同时失败后，新旧成功成员被拆成两组却报告complete。修复按同一groupRef合并成员，复用最新映射并恢复属性。

- legacy-combined-failure-before.log退出1；legacy-combined-failure-round2.log退出0，A/B/C同属90组。
- 真实Chrome修前两组断言失败，最终相同故障脚本通过；预先复用页窗口/原组不变。
- 重复组失败、属性失败保留完整成员与有效目标供重试。

第1轮复验发现旧组/窗口关闭后仍反复使用旧组ID；元数据失败页关闭后仍永久重试旧tabID。第2轮修复预检组存活和窗口、过滤已关闭元数据目标，保留本次拥有的恢复成员用于合并；明确消失竞态最多重建一次，普通错误仍partial。

- stale-targets-before.log退出1；stale-targets-after.log退出0，两场景第二、第三次均failed0，替换页pinned为true。
- ui-stale-targets-after.log：17/17，实际恢复adapter配合严格拒绝无效tab/group/window ID的模拟API；覆盖有效目标、旧failure失效组、关闭整窗、检查间消失和wrong-window不移页。
- chrome-stale-before/release/result.log修前失败；最终chrome-release/release/result.log和stale-targets.json确认Chrome确实销毁旧组后可恢复，无重复且固定状态正确。

共享恢复adapter、操作服务、项目服务和仓库源码未因定点修复变化。此前确定性不符合项均已关闭，最终未发现剩余确定性不符合项。

## 最终产物

`dist/tab-out-2.3.0-release-convergence.zip`：61文件，211592字节。

SHA-256：`03206c41b39200d824596afa8a13572feb923c3a579569fbbd9560a57a6d0518`。

package-verification.json确认每项与当前源码一致、11保护文件及四旧包不变。结论只对应最终包，前两候选不沿用最终验收结论。

## 验证边界与发布限制

- Chrome采用隔离配置/合成资料/故障注入，未操作真实保存资产；memory预授予权限，原生授权弹窗未验证。
- 模型采用模拟兼容服务，未连接用户实际服务、验证真实费用或全部私有站点。
- 28页20题仅证明合成词法回归；前三前后均20/20，不证明真实整体召回率提升；单次性能不是设备保证。
- 未新增iframe/ShadowDOM/PDF/Canvas提取；旧文清理是保守启发式。
- 重试上下文仅当前dashboard存在；刷新后仍能去重补开，但不保留此前元数据失败任务。
- 母语翻译审校、真实使用观察、实际模型联调待做。
- 支持渠道、销售条款、结账/授权签发仍是商用门槛；同步未实现。本轮未提交、推送或发布。

两轮正式修复及复验结束，标准未降低。可交付本地试用包，后续按发布准备清单完成真实服务与商用验证。
