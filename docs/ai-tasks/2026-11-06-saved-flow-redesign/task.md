# 打开与已保存：体验收敛

状态：开发前冻结。Forge L3，阶段A数据安全、阶段B界面动线，最终独立Tech Lead验收。原始需求：用户采纳2026-11-06产品审视方案，要求“交付一版，看下效果”。依据：docs/product-reviews/2026-11-06-navigation/review.md及其实际Chrome截图。

## 目标与边界

在当前MV3扩展上交付可运行试用版，不另造网页；保留纸色/绿色/卡片风格与固定底栏、三视图及全部既有项目和浏览记忆。导航为“打开的标签页／已保存／浏览记忆”；让保存与打开成为相互独立的状态。保留现有原生标签组/窗口布局、部分失败重试、撤销、旧数据迁移与基础免费项目能力。不新增收纳箱、自动项目归属、AI功能、账号、权限或发布。

## 冻结接口与方案

- 服务save/park({preview,name,workspaceId,updateMode})：存在workspaceId时默认append，显式replace才替换；无ID创建。switchProject内部明确replace，保留安全切换语义。
- append不得使用会清除session的addEntries：保留旧session窗口和组，按规范化URL补充新页面，重新映射新引用防冲突。库内原子校验目标版本，过时预览拒绝，保存失败不能关页。
- TabOutCore.projectUpdateImpact(workspace,preview,updateMode='append')返回{added,retained,removed}，各为含url/title的数组，按规范化URL比较。显式替换显示完整增加/保留/移除清单及数量。
- service.projectFingerprint(workspace)提供版本标识；service.removeSavedEntry({workspaceId,url,expectedFingerprint})从entries和session同步移除，保留剩余布局与组，拒绝删除最后一页（引导删除整个分组）。
- 标签页移除顶部3个项目快捷按钮。卡片不重复保存按钮；保留选择、视图切换、打开/关闭页面。选择后统一操作栏显示范围/数量、保存所选、清空选择；默认保存不关闭，预览明确提供保存并收起。窗口批量动作移至次级入口。不可保存网页不进入保存选择数量。
- 保存弹窗移出projects隐藏视图，app保存入口不提前切换导航；取消/关闭恢复来源视图、滚动、选择和可见焦点；完成也留来源，用户点查看才去已保存。
- 已保存列表缩小宣传区；名称按钮进入详情，卡片仅一个主要打开动作，其余管理/高级切换在更多菜单。中性显示保存N页/已开M页。详情有完整链接、单页打开、补开缺失、添加打开页面、明确的替换与变更预览、移除保存项。
- 选择已有分组时保留用户已经选中的新页面，不以旧项目成员覆盖用户选择。仅高级切换来源选择仍按已保存成员预选。
- 四语同步，保持DOM IDs中必要兼容点，旧合同测试按实际新行为适配，不隐藏死按钮冒充移除。

## 文件职责

- Data Developer：extension/src/services/project-service.js、extension/src/storage/workspace-repository.js及其对应Node测试；不动UI/tools。
- UI Developer：extension/app.js、index.html、src/ui/project-workbench.js、dashboard-navigation.js及对应CSS、i18n.js、locales/{zh-TW,ja}.js及UI Node测试；不动服务存储/tools。
- 根：tools、README/指南、任务与证据、打包/集成验证。

各方不是唯一工作者，保留全部已有未提交修改，不回退其他人。不得改AGENTS/CLAUDE/manifest/模型配置，不commit/push/publish。11个旧ZIP不覆盖，创建新试用ZIP。

阶段A独立审查补充：发现来源页面在捕获/写pending操作记录期间跳转或固定，以及目标项目在恢复期间被另一文档修改时，仍可能关闭来源。Data Developer范围扩至operation-service.js及对应测试，以非持久化beforeRemove校验在真正remove前复核来源和切换目标；保留旧无hook关闭合同。此为标准6所需修复，不改变通过条件。

## 开发前验收条件

1. 导航及两个主视图职责明确；当前页面选择后统一操作，无无选择状态的保存/继续按钮堆叠。保存数量只包含可保存页，允许跨卡片选择。
2. 从标签页/已保存发起预览，取消和完成均保留来源；取消不写业务数据、不关页，选择/滚动/可见焦点恢复；查看结果才主动导航。
3. 已保存名称可查看完整详情，可打开单页/补开缺失，已开不重复，其他页面不关闭，保存记录保留；卡片一个主要动作，其余菜单可操作。
4. 添加3→4页保留旧内容及原布局；选已有目标不丢新选择；重复添加不重复；过时目标/来源与写失败安全拒绝，不关页。
5. 显式替换预览正确列出新增/保留/移除及数量；保存结果只含确认选择；取消不改变旧内容。详情移除单页同步session/entries且不关浏览器页，剩余布局保留，最后一页明确拒绝。
6. 固定页保留；混合窗口无关页/共享页保护，收起可撤销，恢复/重试/原生组/多窗口安全不退步。旧数据迁移/备份导入合同继续通过。
7. 四语完整，1440/1366/390无横向溢出；独立内容滚动及底栏对齐保持；对话框键盘焦点/退出可用。视觉继承审视截图风格，明确标记功能变更造成的有意差异。
8. Node全套、语法、真实隔离Chrome主故事与受影响回归通过，保存原始证据；独立审查逐项判断。新ZIP逐文件匹配源码、旧11包不变。不把自动化通过当作真实用户易用性验证。
