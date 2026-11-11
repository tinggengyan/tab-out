# Developer 实现报告

状态：生产源码与单元测试已冻结，待根进行最终隔离浏览器回归和独立验收。未声明全部验收通过。

## 实际行为

- 增加 `extension/src/storage/project-normalization.js`。旧 tabGroups 真正进入 workspacesV2；稳定来源身份、ID碰撞后缀、原名称/日期/session保留、无名使用可读标题。不同记录即使URL相同也不合并。有完整session而旧tabs缺有效URL时，以session补齐entries。原始payload保留在本机projectMigrationBackupV1。
- repository通过原生Web Locks协调dashboard/service worker，Node后备队列协调同存储多实例。新增项目、原始备份、清空活跃tabGroups在同一次storage set提交，失败保留源并可重试。repository全部读写共用锁。新增importData/importLegacyGroups供历史导入和恢复；重复旧导入不覆盖用户后来编辑的项目。
- 基础workspaces.limit在各计划均Infinity，保留rules/templates/history等原高级门控。现代备份导出只含canonical项目及空兼容tabGroups，不导出迁移备份或双份记录；legacy/portable merge/replace导入统一经repository。
- 删除标签页右侧旧列表、项目页临时收纳分区和advanced跨类型bridge；原read-later/归档、三个导航、固定footer保留。项目卡片统一rename/update/delete/switch/resume，最近保存置顶，不改变repository的pin/order。
- 所有页面保存入口复用项目预览。卡片按真实tabID选择，可明确跨窗口；顶部/后台收起限定来源窗口，后台快捷键不先关闭页。预览有窗口范围、保存/关闭/固定保留计数。名称选填；结果新增查看项目；Undo保留项目。
- 项目继续统一复用已修复的savedContinuation引擎，支持new-window/merge-current；复杂group/create、stale native IDs、closed metadata target重试安全覆盖迁入后的真实projectService路径。
- 删除项目先保存trash payload，再删除源和相关规则；旧tabGroup恢复直接归一化，workspace恢复后才移除trash，使用restoredFromTrashId避免最后一步移除trash失败后重试生成重复项目。迁入ID含冒号的advanced目标解析保留完整ID。
- command/omnibox以项目为统一来源；四语用户术语/数量/升级文案同步，Chrome自身标签组作为布局元数据保留。

## 修改范围

Production：app.js、background.js、index.html、i18n.js、locales/{zh-TW,ja}.js、src/storage/{project-normalization,workspace-repository}.js、src/services/{backup-service,entitlement-service,project-service}.js、src/ui/{project-workbench.js,project-workbench.css,saved-library.js}。

Tests：新增project-normalization.test.js，更新entitlement-service、free-command-palette、project-undo-ui、project-workbench-ui、saved-library-ui及integration/ui-contract。原有适用行为覆盖保留；仅将旧双类型/3数量/Undo删除收纳的断言改为本次明确采用的模型。

未修改tools、manifest、AGENTS/CLAUDE、权限、真实用户Chrome数据或旧ZIP；未提交、推送、发布。

## 自测证据

Node路径：`/Users/tinggengyan/.nvm/versions/node/v24.15.0/bin/node`。

- `node --test`：340/340 PASS，无失败/跳过；原始日志evidence/dev-node-tests.log。基线328，本次新增12项行为测试。
- 数据阶段专项：repository/normalization/entitlement/project-service/saved-library/backup通过，日志evidence/dev-data-tests.log；最终更完整覆盖见340全量日志。
- `node tools/check-javascript.mjs`：60模块PASS，evidence/dev-syntax.log（包含根正在维护的工具脚本）。
- `git diff --check`：exit0。
- 初轮旧契约失败日志保留在dev-node-tests-initial.log，原因是本次变更后旧文案/双类型/数量/Undo断言已不适用；没有忽略或跳过失败测试。

## 交接API与selector

- `workspaceRepository.importData(data,{strategy:'merge'|'replace'})`；`importLegacyGroups(groups)`；list自动归一化旧记录。
- `previewSave({windowId,tabIds,acrossWindows:false})`默认当前指定窗口；跨窗口卡片入口显式true，所有选择基于actual tabID。
- `tabOutProjectWorkbench.begin(mode,workspaceId,{windowId,tabIds,acrossWindows})`。
- 卡片：`.project-card[data-project-id] [data-project-action=rename|update|delete|switch|resume]`。rename沿用native prompt；update打开同一项目预览并选当前窗口该项目成员。
- 结果：`#projectViewBtn`、`#projectUndoBtn`、`#projectDoneBtn`。范围：`#projectScope`；原其他dialog IDs保留。
- 后台：`collectCurrentWindow`不关闭页面，存projectCaptureRequestV1并定位目标dashboard；dashboard消费后打开同一preview，只有确认后才保存并关闭非固定页。

## 限制与待验证

本Developer未运行浏览器E2E（依分工由根执行），未操作真实用户资产。真实provider、付款及同步不在本次范围。旧迁移原始备份保留本机，不作为活跃用户分类或现代portable导出的重复来源。失败恢复的临时上下文仍仅当前dashboard有效，未新增跨刷新持久化承诺。

## 浏览器视觉检查后的小修

根在真实浏览器截图发现范围文案显示了Chrome内部windowId。已修复：与标签页窗口视图一致，按实际窗口ID升序生成1/2等人类可读序号；来源就是dashboard当前窗口时显示“当前窗口”，跨窗口候选行同样使用该文案。内部真实windowId/tabID、保存范围及关闭安全逻辑均保留。project.scopeWindow翻译key未改变。新增2项测试分别验证大数ID不进入文案，以及显式来源窗口ID只在内部保留。重新运行全量340/340与syntax60 PASS，diff-check exit0；本次小修后源码重新冻结。

## 独立验收后修复轮 1（R1 / R2）

第一轮独立验收为FAIL：13项中11通过，R1规则恢复重试重复及R2实际旧文件验证链路丢元数据/匿名随机身份两项未通过。本轮只修复这两项及R2引出的本地迁移故障安全边界；未改验收标准、权限、模型模块或高级权益。

R1：ruleRepository新增restore(input,{trashId,sourceRuleId})，用垃圾记录与原规则来源识别已成功恢复项；缺原ID时使用原数组序号。已恢复后用户修改的规则保持不变，同pattern但不同来源仍分别恢复。碰撞ID不会覆盖无关规则。规则repository读写与项目共用存储锁，app真实恢复循环由create改为restore，最后才清垃圾。

R2：schema.validateImportPayload现在安全保留name、日期、tabs.pinned及通过现有portable workspace-session校验的完整session。有效session可补齐flat tabs无有效URL的记录。匿名group按清理后的安全内容与原数组序号生成稳定身份：同文件重复merge不重复，文件内两条完全相同的匿名记录仍各自保留。哈希按完整UTF-16单位处理，避免不同emoji因共享高代理位而碰撞。直接旧记录规范化也保留组序号。

旧格式整体新增深度、字符串长度、条数及原型键边界；非法session的危险URL或结构会拒绝导入，普通旧叶子危险URL仍按既有规则过滤。复用同一validator的本地migrateLegacyState遇验证失败会抛异常，runStorageMigration不会写空shortcuts/deferred/session或标记升级成功；原始key与备份保留，修正来源后可重试。

新增tests/unit/project-compatibility-ui.test.js经过真实app File.text→validator→UI预览→confirm handler→repository链路，覆盖legacy merge/repeat/replace、改名保留、两匿名记录、原生session/固定状态、session兜底及危险输入拒绝。使用实际workspace/rule/trash三个repository执行真实restoreTrashItem，分别注入最终trash写失败及多规则中途写失败后重试；验证数量、成功ID、属性及后续用户编辑。另补rule identity冲突和真实migration service拒绝/重试。

修复范围：extension/app.js、src/storage/{rule-repository,schema,project-normalization}.js；新增project-compatibility-ui.test.js，增补rule-repository.test.js、migration-service.test.js。无tools改动。

最终重新冻结自测：

- node --test：348/348 PASS，0失败/跳过；evidence/dev-repair1-node.log。
- syntax：60模块PASS；evidence/dev-repair1-syntax.log。
- git diff --check：exit0；evidence/dev-repair1-diff-check.log。
- 首次修复针对性测试13/13通过见dev-repair1-targeted.log；随后补充边界全部包含在最终348测试中。
- 修复轮首跑347/347真实通过，但该整份日志被后续348重跑更新；会话原始工具输出仍可查，dev-repair1-first-run-summary.json明确仅保留摘要，不冒充完整首跑日志。初始340完整日志及最终348日志保留；dev-repair1-node-before-final-checks.log保留了最终边界修订前的一次348完整通过。

本Developer未执行Chrome E2E或独立复验；由根提供浏览器原始证据并组织复验。生产源码已最终冻结，等待根重新归档/打包和独立验收。

## 独立复验后修复轮 2（R3，最终源码冻结）

修复轮1的R1/R2已解除；第二次独立复验为12 PASS/1 FAIL。R3是保留session时只验证tabs为数组，漏过null/primitive等成员，导致导入后的真实projectService.previewResume抛TypeError。此次为最后一轮自动修复，未降低标准。

新增domain/session.js纯函数isValidSessionShape，供legacy→portable validator、现代workspaces/session/snapshot/tabGroups.session、当前schema的旧记录normalizer及repository save/restore共用。背景已先加载domain/session，不依赖前台backup模块。校验session/window/tab/group为正确对象和数组、tab有有效HTTP网址或明确restorable:false的已支持内部页；验证tabIds引用成员及存在时的布尔/文本/索引/标识元数据。省略非必要字段兼容，不把缺省元数据强行视为错误。非法session在canonical提交前抛明确异常，原key、现有项目与schema不被清空，可修正后重试。repository恢复也接受合法不可恢复内部页，不因增强校验破坏其垃圾恢复往返。

importConfig开始清空pendingImport并隐藏旧确认预览；新增generation在读取文件和读取存储后校验，使前一个慢文件不会在新坏文件拒绝后重新出现旧确认。坏JSON、过大文件、读失败或结构验证失败都不留下可确认旧草稿。

测试新增7项，总数由348到355。tests/helpers/session-import-fixtures.js提供43种坏session，覆盖null/primitive/缺URL/不安全协议、window/group/tabIds与标量类型错误。实际app File→validator→UI流程对legacy、portable workspace、portable tabGroups、snapshot四类容器逐项检查：先有合法未确认草稿，再加载坏文件，pending=null/预览隐藏/存储逐字不变，调用过期确认也无写入。另有慢File竞态、共享portable校验矩阵、本地schema迁移和current-schema normalizer原始来源保留及修正重试。合法HTTP、受支持内部协议及省略可选字段保持；实际File→repository→真实projectService预览及垃圾恢复往返保留session，报告2个可补页、1个不可恢复页，没有TypeError。

修复范围：extension/app.js、src/domain/session.js、src/services/backup-service.js、src/storage/{project-normalization,workspace-repository}.js；tests/helpers/session-import-fixtures.js，及backup-service/project-compatibility-ui/project-normalization/migration-service测试。不改tools、权限、AGENTS/CLAUDE或模型模块。

最终冻结自测证据（全部真实执行）：

- node --test：355/355 PASS，0失败/跳过；evidence/dev-repair2-node.log。
- syntax：60模块PASS；evidence/dev-repair2-syntax.log。
- git diff --check：exit0；evidence/dev-repair2-diff-check.log。
- 实现过程中针对性35/35通过，evidence/dev-repair2-targeted.log；之后新增的合法service往返测试已包含在355全量中。

本Developer不宣称独立验收通过；浏览器、重新归档/包和最终独立复验由根负责。以上源码及测试已最终冻结，没有待进行的额外代码修改。
