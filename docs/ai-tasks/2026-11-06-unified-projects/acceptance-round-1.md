# 独立验收第一轮：FAIL

只读独立角色 `/root/unified_projects_acceptance`。13项：11 PASS、2 FAIL、0 BLOCKED。验收期间源与包保持冻结，未操作真实用户Chrome，未改文件或标准。

| AC | 结果 | 依据 |
| --- | --- | --- |
| 1 单一对象 | PASS | 旧双列表/bridge已移除；旧6+新3统一项目，导航及稍后查看保留。 |
| 2 旧数据无损 | FAIL | 本地迁移通过；实际legacy文件validator丢名称/session/pinned，见R2。 |
| 3 故障安全 | PASS | atomic提交/原始备份/Web Locks/失败源保留/真实多dashboard并发/身份碰撞已核对。 |
| 4 权益一致 | PASS | 基础项目各计划Infinity，其他门控保持；首页/高级/memory超过3条可保存。 |
| 5 仅保存 | PASS | 真实ID/窗口/URL/固定校验；无关闭移动，空名默认。 |
| 6 保存并收起 | PASS | 先保存后关闭；范围与固定计数清楚，取消/失败不关闭。 |
| 7 结果撤销 | PASS | 查看项目、保留记录、真实鼠标Undo与新ID即时重绘，原窗口分组保护。 |
| 8 持续使用 | PASS | 同ID改名更新/补缺继续/最近保存置顶，重复旧导入不重置编辑。 |
| 9 安全切换 | PASS | 迁入来源/目标真实故障保留来源，重试、再次切换、共享固定无关页及Undo覆盖。 |
| 10 复杂恢复 | PASS | canonical路径复用恢复安全引擎；combined/stale group/window/metadata实测与单测通过。 |
| 11 兼容闭环 | FAIL | 现代导入/搜索/旧ID/后台基本通过；规则恢复重试重复、legacy文件匿名重复和元数据丢失，见R1/R2。 |
| 12 语言布局 | PASS | 4×3×3矩阵、固定底栏/滚动/焦点/草稿；首卡154px、重复提示240px；窗口大数ID已修复。 |
| 13 证据边界 | PASS | 340测试、60模块、7套Chrome原始结果；125基线/30差异/62包字节核对一致，8旧ZIP及保护文件不变。现有测试通过不能消除新增缺陷。 |

## R1：规则恢复重试不幂等

app.restoreTrashItem先恢复project与逐条ruleRepository.create，最后trashRepository.restore。project通过restoredFromTrashId幂等，rule.create忽略输入id并生成UUID。

独立使用实际函数与三个实际repository、纯内存storage注入最终trashV2.set一次失败：首轮project=1/rule=1/trash=1；重试project=1/rule=2/trash=0。相同workspace/pattern/mode出现重复规则。

要求：按trashId+原ruleId（缺失时稳定序号）恢复身份，复用已成功项；覆盖最终trash写失败及多规则中途写失败，不能简单跳过所有规则而遗漏未完成项。

## R2：实际旧格式文件validator丢数据与匿名随机身份

app.importConfig调用schema.validateImportPayload，sanitizeTabGroup仅保留id/savedAt/tabs.url/title，丢name/session/pinned；无id生成随机UUID。实际validator→repo.importData复现名称从Keep my project name变Page，原绿色native组与固定状态丢失；相同匿名文件merge两次生成2项目。当前Chrome直接repo.importLegacyGroups未覆盖此入口。

要求：安全保留有效名称、日期、session/固定/布局元数据，valid session兜底旧tabs无有效URL；匿名身份稳定但不按URL合并不同记录。补真实File→UI预览→确认的legacy merge/replace及反复导入回归。

## 证据与限制

独立重算归档125文件、30项变更及整个patch一致；62冻结源和ZIP逐字节一致；包SHA256=6801d193b317fc8a7c967a01eccb711fd9a562d332d7e5b725aba076409504bc；8旧ZIP及保护文件均不变。原始7套Chrome151结果全部exit0，日志晚于范围文案修复；340/340与syntax60真实通过。

真实用户档案、provider/私有站点、原生快捷键投递和真实权限弹窗未覆盖。omnibox与advanced旧ID移动主要源码核对，缺专项Chrome行为。本轮不扩大到收费/同步/真实模型发布。

下一步：一次修复R1/R2、补实际入口与故障检查、重冻结与重打包，独立复验，不降低13AC。
