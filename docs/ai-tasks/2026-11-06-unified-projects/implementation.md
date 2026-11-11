# 统一项目：集成实现与验证

状态：实现与集成验证已完成并冻结；355项测试、7套最终Chrome和独立验收13/13通过。最终结论见acceptance.md，历史两轮FAIL仍保留。

## 已实现

产品只保留项目这一种批量保存对象。旧tabGroups真正归一化进入workspacesV2，原始本地备份、名称/日期/完整session、稳定来源身份、冲突处理与重复导入保护保留。Web Locks协调dashboard和后台写入，迁移失败不先清源；历史备份/垃圾恢复也进入同一路径。

原标签页右侧列表、项目页临时收纳分区和advanced跨类型bridge移除。项目统一继续、更新、重命名、删除恢复及切换；最近保存置顶。所有保存入口共用预览，跨窗口卡片按实际tab ID，当前窗口/后台快捷键明确来源窗口；保存成功才收起普通页，固定页保留。结果可查看项目，Undo恢复页面且保留记录。基础项目取消3条上限，其他高级门控不变。四语言同步，稍后查看、浏览记忆、三个导航及固定底栏保留。

复杂恢复复用原已修复引擎，canonical项目路径覆盖创建/分组同时失败、空组/窗口消失及metadata目标关闭。浏览器检查发现范围文案显示Chrome内部大数ID，已改为可读窗口1/2或当前窗口，内部仍使用真实ID；新增2单测后重新冻结。

Developer具体范围和API见[实现报告](implementation-developer.md)。根独占tools浏览器验证、README/CHANGELOG/产品方案/Backlog/指南/发布准备、任务证据与ZIP；没有与Developer共享编辑同一源文件。

## 验证证据

Node24绝对路径执行。基线328/328；最终355/355，无失败或跳过。最终syntax60模块；diff-check退出0。原始日志evidence/repair2-final-node.log、repair2-final-syntax.log、repair2-final-diff-check.log。

Chrome151.0.7922.77全部使用临时配置与合成资料，不连接个人Chrome档案。最终套件路径、原始结果与生产冻结哈希汇总位于evidence/verification-index.json，7/7通过：

- unified：混合6份旧收纳+3项目；两真实dashboard并发；重复旧导入；实际跨窗口卡片与后台命令处理函数；同ID改名更新及取消；删除恢复；迁入来源/目标安全切换；超过旧额度的memory保存；现代备份反复合并；迁移提交故障重试。
- projects：原15条混合窗口保存/收起/Undo/复用/切换/共享页/部分失败/备份/响应式流程。
- release：迁入项目真实对话框与combined create/group故障、stale group/window及metadata目标；空名保存；Free搜索和单独memory导出。
- regression：搜索/平台/精确重复页、预览保存并收起及真实鼠标Undo、实际新tab ID即时渲染、快照、Free超过3条、已有授权管理和普通备份恢复。
- i18n：4语言×3视图×3宽度及键盘切换、数据/草稿/焦点、错误重试。
- layout：1440×900、1366×768、390×844；第一张真实卡片<=200px、有重复提示<=280px；实际滚轮/键盘、内容独立滚动、底栏齐平与最后控件可达。
- memory：实际IndexedDB、模拟登录页、local Chat Completions fixture、取消/引用/HTTP429、下载导入、worker重启及移动端；不是实际用户provider联调。

## 探测与工具适配

保留所有失败日志/截图。工具适配没有删除行为覆盖或降低布局阈值：

1. 首轮fixture使用tabs.create的pending URL，改为capture后实际查询到的URL；同时生产补session有效而旧tabs无效时的entries兜底。
2. 更新后session capture时间变化，垃圾恢复应与刚更新的session逐字比对，不能拿更新前快照作期望。
3. selectionSummary新增固定页计数，旧测试补传pinned参数。
4. 收起后旧DOM可被隐藏而未移除，改为检查真实浏览器页关闭、空态隐藏，以及Undo后的真实新tab ID立即呈现。
5. 移除旧右栏后，最后DOM控件变为稍后查看按钮，修正键盘目标，仍要求Tab进入底栏。
6. 单页目标可能由windows.create直接打开，故障注入同时覆盖窗口和标签创建，并断言确实触发故障。

## 产物与边界

新包dist/tab-out-2.3.0-unified-projects.zip；62条目逐字节匹配冻结extension源，SHA与字节数见evidence/package-verification.json。8份既有ZIP保持原哈希。AGENTS/CLAUDE、manifest/权限、Chrome adapter和浏览记忆采集/模型/库代码保持基线；本轮实际源差异见evidence/current-source-diff.patch，不能用全仓dirty diff误算本轮变更。

未修改真实用户资产，未重载个人Chrome触发迁移，未提交/推送/商店发布。重新加载扩展后才会在实际安装中转换旧收纳。当前交付范围仍是可安装试用版；真实模型、母语复核、支持联系资料和收费服务联调不在本轮完成声明中。失败重试上下文仍不承诺跨dashboard刷新持久化。


## 独立验收修复轮1

首轮独立验收11 PASS/2 FAIL，原报告acceptance-round-1.md保留，不把此前340单测与7套通过冒充无缺陷。

R1：ruleRepository.restore使用trashId+原ruleId（缺失时序号）识别来源，重试复用已成功规则且不覆盖其后续编辑；actual app恢复循环调用此方法。最终trash写失败及第二条规则写失败均通过实际三repo/内存故障与真实Chrome鼠标重试，最终规则不重复或遗漏，disabled/mode保留。

R2：legacy文件validator保留经过portable安全验证的session、name和pinned；匿名来源由规范化内容及原数组序号稳定识别，同文件完全相同两条记录各自保留，重复merge不重复且保留用户改名。增加资源/深度/原型键限制；本地schema迁移validator拒绝时抛错，保留原数据与旧schema，修复后可重试，禁止退空集合。真实File→importConfig→radio merge/replace→确认UI补测通过，现代备份可再replace回原库。

修复轮1为348/348（比基线新增20项）；最终355/355（比基线新增27项），60模块syntax通过；新增project-compatibility-ui.test.js与rule/migration故障回归。根新Chrome脚本故障探测有一处动态IIFE字符串闭合错误，原失败日志保留，修正脚本后完整R1/R2检查通过；没有更改生产行为来满足错误脚本。最终所有套件结果与冻结源重新汇总到evidence/verification-index.json，当前包已重打并逐字节校验。


## 独立验收修复轮2

复验12 PASS/1 FAIL，原R1/R2通过，R3坏session成员被接收导致继续预览TypeError；原报告acceptance-round-2.md保留。

新增domain/session.isValidSessionShape作为共用纯结构校验：页面对象/必需网址、窗口/组/tabIds成员与存在时的基础元数据类型，允许合法省略字段和明确不可恢复的安全内部页。legacy、portable工作区/旧组/快照、本地schema升级及当前schema旧组归一化共用此检查，非法输入在写入前拒绝并保留旧数据。importConfig选新文件即清旧草稿/隐藏预览，并用generation防慢旧文件重新激活确认。

Developer新增43类坏session×4容器的实际File VM检查、合法service与trash往返、本地迁移拒绝保留等测试；根真实Chrome补10类legacy/portable坏文件，每次先准备valid未确认草稿再换bad file，确认pending=null、预览隐藏且整个chrome.storage.local逐字不变。正常旧文件metadata、merge/repeat/replace及所有前轮安全流程保持。

最终355/355，无失败/跳过；syntax60和diff-check通过。最终原始证据统一为repair2-final及verification-index.json；新ZIP62条215602bytes，SHA256=681cc244f7e58a45bae3db53fe9cf53e317fa06166f0018e37c72aafa65864af，逐字节匹配冻结源；8旧包不变。最后独立复验13/13 PASS，见acceptance.md；不改写此前FAIL。


最终projects首跑在fixture删除目标页后的下一次鼠标动作等待预览超时，原日志/截图保留。工具补上“目标卡片已反映2个缺失页”的语义等待，确保清理结果在UI呈现后再点击；没有重复业务点击或放宽通过条件。重跑完整15旅程通过，原始结果repair2-final-v2/projects，其余6套为repair2-final。source与ZIP仍保持最终冻结不变。
