# 阶段A独立验收：R1 PASS

日期：2026-11-07。验收者saved_flow_data_acceptance，独立于规划及实现，只读返回，由根保存。仅覆盖task标准4/5/6的数据部分，不替代整体验收。

## 首次FAIL及修复闭环

首次独立96项补测前的90项现有数据回归虽通过，另复现两个真实缺陷：来源页面在关闭操作pending持久化期间导航/被固定仍被关闭；目标在切换恢复期间被另一文档修改仍关闭来源。已记录并交回Data Developer R1修复，未降低标准。

R1在operation.close第三参数接收非持久化beforeRemove，位于capture及pending写入之后、紧邻实际remove之前。项目服务同时验证来源及切换目标。预条件失败单独记录succeeded:0，不能把独立消失的标签误计为本次关闭成功，不能撤销未执行的关闭。

独立复验原复现：来源导航、被固定、独立消失，以及目标在恢复/pending期间修改均closed:0，未调用关闭接口，保留其他编辑。两个原FAIL均关闭。

## 独立证据

- 追加1→2→4页，旧窗口JSON逐字一致，新tab/group/window引用唯一；重复URL不重复。
- 两个独立全局环境和存储实例，使用原生navigator.locks，9次读取及2次写入断言实际持锁，一成功、一preview_stale。
- replace及新增/保留/移除清单正确；移除同步session/entries，保留剩余布局，不关浏览器，最后页/过时详情拒绝。
- 高级切换显式replace；固定/无关/共享页面、原生组、多窗口、撤销、重试、迁移和备份合同通过。
- 独立执行9个数据测试文件96/96、全套380/380、语法61模块、diff-check无错；data-r1-frozen-files.json六文件哈希全部匹配。后续UI菜单改动由最终验收检查。

原始Developer执行证据位于evidence/data-r1-{targeted,node,syntax,diff-check}.log及data-r1-scope.patch。独立代理的执行输出记录在本会话工具轨迹；本文件未伪称代理在本地写过日志。
