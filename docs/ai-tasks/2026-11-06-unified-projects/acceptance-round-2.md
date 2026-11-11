# 独立复验：FAIL（修复轮1）

只读独立角色 `/root/unified_projects_acceptance`；13项中12 PASS、1 FAIL、0 BLOCKED。原R1及R2元数据/匿名重复已解除，新增R3非法session结构漏检使AC11仍不符合。没有修改标准、源、用户Chrome或测试文件。

| AC | 结果 | 核对依据 |
| --- | --- | --- |
| 1 单一对象 | PASS | 最终unified/release/layout与源码仍只有统一项目库。 |
| 2 旧数据无损 | PASS | 真实旧File/UI merge/repeat/replace保留名称/日期/URL/固定/native session；同文件2匿名相同内容各自保留；重导不重置改名。 |
| 3 故障安全 | PASS | atomic迁移与锁保留；故障源不清、可重试；新增本地schema拒绝不清空资产/不标成功。 |
| 4 权益一致 | PASS | Infinity基础数量，其他高级门控保留；超额首页/高级/memory保存实测通过。 |
| 5 仅保存 | PASS | 真ID/窗口选择、无关闭移动/重固定、空名可用。 |
| 6 保存并收起 | PASS | 预览范围清楚，保存后才关闭所选普通页，固定/取消/失败保护。 |
| 7 结果撤销 | PASS | 查看项目、原窗口分组恢复、部分/并发Undo、真实新ID即时重绘，记录保留。 |
| 8 持续使用 | PASS | 旧新项目同ID改名更新/继续/排序，原记录不因恢复或Undo删除。 |
| 9 安全切换 | PASS | 迁入来源/目标故障、重试、共享/固定/无关页及Undo实测保留。 |
| 10 复杂恢复 | PASS | combined create/group、stale group/window/metadata最终Chrome及原单测通过。 |
| 11 兼容闭环 | FAIL | 原R1/R2正常及故障重试已通过，但新session保留入口接收null tab，导入后真实继续预览TypeError，见R3。 |
| 12 语言布局 | PASS | 最终4×3×3、固定底栏/滚动/移动/焦点/草稿全部保留。 |
| 13 验证边界 | PASS | 独立核对348/348、60模块、7套最终Chrome，125基线/35差异/62包一致，8旧ZIP/保护文件未变；不能用通过结果抵消R3。 |

## 已解除R1/R2

规则恢复按trashId+原ruleId/序号复用成功项，后续enabled/mode/description编辑不被覆盖，身份碰撞处理正确。独立只读纯内存13项相关测试通过；实际Chrome注入最终trash写失败与第二rule写失败再鼠标恢复，最终2规则无重复/遗漏且disabled/mode保持。

旧File→validator→预览→确认链路现在保留有效元数据；merge/重复merge/改名后重导/replace及现代备份恢复都通过。匿名身份由安全内容和原数组序号稳定区分。

## R3：损坏session被接受，项目无法继续

实际输入：

```js
{tabGroups:[{id:'malformed-session',name:'Readable project',tabs:[{url:'https://good.example/',title:'Good page'}],session:{windows:[{tabs:[null],groups:[]}]}}]}
```

独立运行实际validateImportPayload→workspaceRepository.importData→projectService.previewResume：validator ok:true，项目创建成功，继续预览抛`TypeError Cannot read properties of null (reading 'url')`。

schema.sanitizeTabGroup复用backup-service.validSession，但后者只确认tabs为数组，不验证成员对象/必要字段。

要求：共用session校验拒绝null、非对象tab及必要损坏结构，保留合法安全不可恢复页面；拒绝时既有库不变、不留可确认草稿；补实际File UI拒绝与正常会话、portable入口回归；本地schema遇非法结构仍保留原key/schema不退空。

## 独立证据与限制

125基线哈希、35项差异及patch、62冻结源和ZIP逐字节相同；ZIP214990bytes，SHA256=4bd00b03d87370f6fd466e27a6147ed70668fbab5aacad9f90521134b7e8132d；8旧ZIP/AGENTS/CLAUDE/manifest/adapter和所列memory模块不变。最终repair1-final七套result/log均Chrome151且exit0，348无跳过。独立额外纯内存13项全过。

真实用户数据/provider/私有站点/原生权限弹窗/系统快捷键投递/母语复核仍未验证；omnibox及高级移动主要源码核对。只读复验不替代这些实测。

下一步：正式修复轮2处理R3，更新最终冻结、证据、包并独立复验；不得改写本轮为全通过。
