# 后端实现报告

日期：2026-11-01。责任：Forge Developer，后端模块及对应测试。范围以 task.md、requirements.md（含混合同窗、默认零选的 AC-13）为准。没有修改根 AGENTS.md、CLAUDE.md，没有提交或发布，也未回退已有修改。

## 实际变更

- 新增 `extension/src/services/project-service.js`：统一预览、保存、收起、仅补缺失恢复和安全切换；同一服务内互斥；新建额度检查；源标签和源/目标项目版本检查；固定页、共享目标页及同窗其他项目保护。
- `workspace-repository.js` 新增原子 `saveSession` 和 `touch`，保存可选完整布局及兼容 entries；回收站恢复保留有效 session。新增/删除/移动/转移条目时使旧布局失效，重命名与改色保留布局。
- `chrome-session-adapter.js` 捕获 pendingUrl，无法获取原生组元数据时拒绝悄悄丢组；新增 original 模式用于 Undo，保留原窗口和 index，源窗口消失时创建对应替代窗口。新建窗口失败不回落至无关窗口。返回恢复页、窗口/组映射，以便部分失败只重试剩余项。
- `operation-service.js` Undo 改用 original；部分失败保留失败 session、组/元数据重试状态，完整成功才标记 undone。组恢复失败可只重试组；成功页面不重复打开。旧历史 merge 模式含义保持。
- Manifest 增加 tabGroups 权限；权限列表的集成测试同步更新。版本号由主会话统一管理。
- `backup-service.js` 验证 workspacesV2 中的可选 session 结构，完整备份保留项目布局。UI 的 `projectBackupStateV1` 为本机导出提示状态，不导入到其他设备。

## API 与 UI 联动

方法与构造器遵循 task.md。SavePreview 含候选 id/url/title/pinned/eligible/selected/reason、tabIds、closeTabIds、session、counts、fingerprint 和 workspaceVersions；显式零选仍返回完整候选，保存/收起时才抛 empty_selection。

ResumePreview 含 workspaceId/workspace/session/mode/targetWindowId/counts/fingerprint。默认 new-window，merge-current 必须指定 targetWindowId。旧项目按 entries 构建会话，不虚构布局。

park/resume/switchProject 返回 status、workspace、counts、failures，关闭发生时附 operation。counts.saved 为来源保存标签数，opened 为目标本次与重试累计创建数，reused 为既有目标页，closed 为真实成功关闭数，kept 为已选择但保留的来源页，skipped 为不支持的目标项，failed 为失败数。收起全部关闭失败仍保留已经保存的项目并返回 failed；验证和写入失败则抛错。

部分恢复结果附不透明 retryPreview，UI 使用 `resume({preview: result.retryPreview})`。目标页在预览后新打开时，执行会重新计算缺失，不重复创建；touch 的 lastUsedAt 不参与项目内容版本指纹。

主要错误 code：empty_selection、preview_stale、workspace_limit、operation_busy、invalid_name、same_workspace、invalid_window、invalid_mode、workspace_not_found；原生组捕获失败 code 为 group_metadata_unavailable。

UI 应仅在 Undo 返回 status=undone 时删除关联收纳/稍后来源；partially_failed 保留来源，并继续指向同一 operation.id。已向 UI Developer 和主会话明确同步。

## 验证证据

先运行失败测试，再修改对应行为；原始记录位于 evidence/backend-*-red.log，覆盖缺少项目服务、原窗口/index 未恢复、新建窗口失败回落、旧 Undo merge、备份非法 session 未拒绝、组元数据丢失、来源项目并发编辑未检测。

最终定向命令：

```sh
/Users/tinggengyan/.nvm/versions/node/v24.15.0/bin/node --test tests/unit/project-service.test.js tests/unit/chrome-session-adapter.test.js tests/unit/workspace-repository.test.js tests/unit/operation-service.test.js tests/unit/backup-service.test.js
```

结果：54 项通过、0 项失败，退出码 0。原始输出：`evidence/backend-tests.log`。

新增项目服务文件含 16 项行为测试：零选候选、混合同窗选择、保存持久化、固定页/其他窗口保护、额度与配额失败、URL/固定状态过期、仅补缺失及重复恢复、目标版本过期、安全切换、共享页保留、目标部分失败重试、源目标同项目拒绝、预览后目标已打开、组失败只重试组、原窗口消失后的部分 Undo 续用同一替代窗口、组专用 Undo 重试、重复提交互斥、来源项目编辑检测等组合场景。

`node --check` 对 project-service、chrome-session-adapter、workspace-repository 通过；`git diff --check` 通过。

## 未执行与边界

本角色未运行真实 Chrome 旅程、视觉核验和打包，由主会话集成执行并交独立验收。后端单测通过不等于整体验收通过。互斥仅限同一服务实例，不宣称跨所有扩展页面具有数据库事务隔离。页面恢复不恢复网页内存、表单或登录状态。

## 独立验收反馈修复：并发 Undo

独立验收发现，同一页面的 Toast 与项目结果区可同时触发同一操作的 Undo。新增行为测试复现原代码调用两次 restoreSession（`restoreCount=2`，期望 1），证据 `evidence/backend-undo-concurrency-red.log`。

`operation-service.js` 现为同一 operationId 复用正在执行的 Promise，完成或失败后清理；不同 operationId 不互相阻塞。新增“同操作两个入口只恢复一次”和“不同操作独立撤销”两项测试。定向 `operation-service.test.js` 与 `project-service.test.js` 共 24 项通过、0 失败，证据 `evidence/backend-undo-concurrency-green.log`；语法与差异检查通过。跨不同扩展页面的多实例互斥仍未宣称支持。
