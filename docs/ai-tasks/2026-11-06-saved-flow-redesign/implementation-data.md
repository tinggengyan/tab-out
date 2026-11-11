# 数据阶段实现报告

状态：数据源码已完成并冻结；针对性Node39/39通过，等待独立阶段审查与根集成验收，不宣称UI或全产品验收通过。

## 实际变更与接口

- `extension/src/services/project-service.js`：已有workspaceId时save/park默认append；显式`updateMode:'replace'`才替换，switchProject内部显式replace保留原来源快照语义。
- append保留原session窗口、原生分组属性、固定/顺序/活动页信息；只追加规范化URL尚未存在的捕获页面，按窗口保留新页面的布局，并重映射新增tab/group/window引用防止冲突。重复添加不生成重复保存页。新窗口若原sourceWindowId冲突，使用独立负整数标识，恢复引擎仍按保存窗口规划处理。
- `TabOutCore.projectUpdateImpact(workspace,preview,updateMode='append')`输出`{added,retained,removed}`，各数组成员含url/title。仅计算明确选中的可保存网页，规范化URL去重。append保留全部旧网页；replace只保留交集、标记移除项。
- `service.projectFingerprint(workspace)`提供与预览及持久化一致的项目版本。
- `service.removeSavedEntry({workspaceId,url,expectedFingerprint})`移除一个规范化URL对应的保存页面，更新session与entries；空窗口/空组剪除，其他tab/group属性保留。返回更新后的workspace；最后一页拒绝`empty_selection`，目标过时拒绝`preview_stale`，不调用浏览器关闭API。
- `extension/src/storage/workspace-repository.js`：saveSession增加可选expectedFingerprint；在原有共享storage lock之内，读取最新记录后、写入之前比较，避免多个Tab Out页的旧预览覆盖新编辑。旧无该参数调用保持兼容。另导出同一projectFingerprint供服务使用。
- 保存在异步capture后再次校验源页面，目标版本在原子提交内再校验；写失败不会进入关闭流程。

仅修改上述两个数据文件与tests/unit/project-service.test.js、workspace-repository.test.js。没有修改UI、tools、task冻结标准、业务权限、迁移规则或既有旧包。与UI开发者并行，未回退其他修改。

## 验证

执行Node24.15.0：

`node --test tests/unit/project-service.test.js tests/unit/workspace-repository.test.js`

结果39/39通过，0失败/跳过；原始日志`evidence/data-targeted.log`。覆盖默认追加、重复去重/引用完整、原布局保留、显式替换及三类影响、移除保留元数据/剪空组窗口/最后页拒绝、捕获时目标与源竞态、共享锁内多仓库实例CAS、删除提交前竞态、写失败不关闭。

两个源码文件`node --check`均exit0，日志`evidence/data-syntax.log`。`git diff --check`exit0，日志`evidence/data-diff-check.log`。本轮数据差异保存在`evidence/data-scope.patch`。

全套Node、真实Chrome故事、四语/布局/焦点与包装由根和UI开发方执行，本数据阶段未执行也不冒称通过。未操作真实用户浏览器，未提交/推送/发布。

## R1：真正关闭前复核来源与切换目标

独立阶段A审查发现：保存后的operation capture及pending持久化仍有异步空档，期间URL跳转或被固定的页面仍可能关闭；切换目标在恢复期间被另一文档编辑后也可能误关来源。本轮按根扩大所有权，另改operation-service.js及operation-service.test.js；不改冻结标准。

- operation.close新增第三个、非持久化参数`{beforeRemove}`，在capture和pending写完成后、紧邻remove调用前执行。函数不进入metadata或存储。无hook的旧调用保持原行为。
- 预条件失败单独记录partially_failed、succeeded:0和明确失败code，再抛原错误；不进入移除失败推断，不把独立消失的标签误计为本次关闭成功，也不能撤销一个实际未关闭的操作。
- project.closeSource通过hook复核来源URL/窗口/固定状态；高级switch同时复核已恢复目标的版本。拒绝时返回结构化failed、closed:0、kept为选中页数与preview_stale，保留已经保存的来源记录和已恢复的目标，不关闭来源。
- 新增URL及pin在pending写后变化、目标在restore及pending写后变化四个服务回归；operation测试验证hook执行顺序、不持久化、原错误保留、零成功诊断和不可撤销。此前所有无hook关闭/撤销合同继续通过。

R1针对性三文件Node53/53通过（evidence/data-r1-targeted.log）。另执行全套Node380/380通过、语法61模块通过、差异检查exit0，原始结果分别保存在evidence/data-r1-node.log、data-r1-syntax.log、data-r1-diff-check.log。最终6文件数据差异及哈希保存在data-r1-scope.patch和data-r1-frozen-files.json。源码重新冻结；真实Chrome未由数据Developer运行，等待根集成及独立复验。
