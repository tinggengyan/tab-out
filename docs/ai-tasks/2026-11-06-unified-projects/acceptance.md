# 最终独立验收：PASS

任务：2026-11-06-unified-projects。只读独立验收角色 `/root/unified_projects_acceptance`。

**13 PASS、0 FAIL、0 BLOCKED。** 两轮修复后R1/R2/R3全部解除，未发现新的明确不符合。此前acceptance-round-1.md及acceptance-round-2.md保留原FAIL，不改写历史。独立验收没有改文件、操作个人Chrome或委派；额外纯内存检查39/39通过。

## 逐项验收

证据相对evidence/；最终projects为repair2-final-v2/projects，其余六套为repair2-final。

| AC | 结果 | 独立核对的依据 |
| --- | --- | --- |
| 1 单一对象 | PASS | 两处独立收纳列表和advanced跨类型区域移除；旧新项目统一列表/计数/空态/操作，导航和稍后查看保留。 |
| 2 旧数据无损 | PASS | 本地及实际File导入保留名称/日期/URL/固定/native session；同内容两匿名记录独立，重复迁移/merge不重复、不覆盖改名；有效session兜底flat tabs。 |
| 3 故障安全 | PASS | 项目/原始备份/清来源同次提交，共用锁多上下文协调；失败源保留、碰撞安全、真实双dashboard并发。非法session写前拒绝，旧/当前schema都保留数据可重试。 |
| 4 权益一致 | PASS | 基础项目Infinity，其他高级门控不变；Free超额后首页/advanced/memory保存、使用、恢复通过，模板同一基础数量逻辑。 |
| 5 仅保存 | PASS | 真实tab/window ID和预览过期检查；无关闭/移动/重新固定/跨窗误选；空名默认可用。 |
| 6 保存并收起 | PASS | 先保存后关闭确认普通页；范围、保存/关闭/固定保留可见，取消/失败不关闭，固定/未选/无关页保留。 |
| 7 结果撤销 | PASS | 查看项目、Undo保留项目，原窗口/分组/部分及并发Undo、真实新ID即时呈现均覆盖。 |
| 8 持续使用 | PASS | 迁入和新项目同ID改名更新/继续补缺，更新排序、重导保留改名；不重复打开或删记录。 |
| 9 安全切换 | PASS | 迁入来源及目标真实失败/重试、来源保留、共享/固定/无关页及Undo通过。 |
| 10 复杂恢复 | PASS | canonical复用安全引擎；combined create/group及stale group/window/metadata重试，不分裂组/重复开页/移动既有页。 |
| 11 兼容闭环 | PASS | 后台预览、legacy/portable merge/replace/重复导入、回收站、备份、搜索来源和旧ID核对；R1/R2/R3故障和正常路径均解除。 |
| 12 语言布局 | PASS | 4×3×3共36几何记录、底栏齐平/可命中/无横溢；首卡154px、重复提示240px；滚轮/键盘/焦点/草稿/移动布局通过。 |
| 13 证据边界 | PASS | 最终355/355无失败跳过、syntax60、七套Chrome exit0；基线/delta/冻结/ZIP独立一致，8旧包及保护文件不变，无提交推送发布。 |

## 缺陷关闭证据

R1：规则恢复按垃圾记录+原规则来源身份复用成功项。最终trash写失败或第二rule写失败后实际鼠标重试，最终2规则且成功ID/disabled/mode保留；独立内存检查确认恢复后用户编辑不被覆盖。

R2：实际File→validator→预览→确认保留元数据。同文件2条相同匿名记录各自保留，重复merge不增份、后续改名保留；replace和现代备份恢复原库通过。

R3：共用结构校验覆盖页面/窗口/组/tabIds成员。原null tab最小复现明确返回ok:false及Malformed backup entity。43类坏结构×4实际File容器检查通过；拒绝后pendingImport=null、预览隐藏、存储不变，旧确认不能写入，慢File不复活草稿；Chrome另测10类坏文件。合法HTTP、省略可选字段及明确不可恢复的安全内部页仍兼容，实际service继续和trash往返保留session，无TypeError。

## 原始证据及试用包

独立重算125基线文件哈希、38项真实差异及整个patch一致；冻结62源和ZIP62条逐字节相同。8旧ZIP及AGENTS/CLAUDE/manifest权限/Chrome adapter和列明memory模块保持基线。verification-index.json与全部result.json及完整日志一致，生成于最终冻结后。

projects首跑超时记录保留；工具增加fixture删除完成后卡片显示2缺失页的语义等待，不重复业务点击、不降低条件，随后完整15旅程通过。

- 包：dist/tab-out-2.3.0-unified-projects.zip
- 大小：215602 bytes
- SHA256：681cc244f7e58a45bae3db53fe9cf53e317fa06166f0018e37c72aafa65864af

## 未实测边界

未操作真实用户Chrome/实际旧资产；真实provider/私有站点、系统快捷键投递、原生权限及文件选择弹窗、母语复核未实测。Chrome用临时配置、合成资料及实际File对象，memory可选权限仅临时副本预授。omnibox和部分advanced旧ID/移动主要源码核对，无新增完整Chrome旅程。失败恢复上下文不承诺跨dashboard刷新持久化。

结论支持交付当前可安装试用版，不代表真实环境联调、商店发布或收费上线完成。
