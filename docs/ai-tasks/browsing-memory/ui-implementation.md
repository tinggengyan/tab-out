# 浏览记忆 UI 实现记录

## 实际变更

- 新增 `extension/src/ui/browsing-memory.js`、`browsing-memory.css`，在现有暖色工作台顶部增加浏览记忆搜索与可折叠设置，不重构旧项目界面。
- `index.html` 加入搜索、最近7／30／90天范围、本地／AI方式、逐次内容发送许可、带访问和正文记录日期的结果、选择／复用打开／保存／概括／删除、来源引用、原生确认对话框。
- 设置区提供主动开启／暂停记录、最近30天历史导入、OpenAI兼容地址／模型／可选密钥、保留期限／排除域名，以及独立浏览记忆导出、文件预览后导入和清空并暂停。
- 模型密钥仅在用户编辑后提交，初始空白保留已存密钥；不从后台读取或回显真实密钥。连接测试按钮明确说明会先保存设置。
- 权限请求在用户手势处理中的首次 `await` 之前发起；拒绝授权时不发送记录或历史导入命令。
- 新增匹配的中英文文案，并修正原有 onboarding／隐私设置中“绝不上传”描述，准确区分本地数据和用户主动发起的模型查询／内容发送。
- 显示 AI 内容排序的候选范围、仅元数据标记和正文截断提示；模型输出、页面标题、片段及错误均按文本显示，链接仅接受无凭据的 HTTP(S) 地址。
- 搜索请求有唯一requestId、取消消息与世代校验；清空、删除、搜索变化或撤回内容许可时立即取消旧请求，避免扩展查询结束后再继续发送候选正文。撤回许可或改变选择时，正在生成的旧概括也不能重新显示。

## 模块与交互合同

UI仅调用 `{type:'browsing-memory',action,payload}` runtime bridge，自行初始化后暴露 `globalThis.tabOutBrowsingMemory`。主要定位符：

`memoryWorkbench`、`memorySearchForm`、`memoryQuery`、`memoryDays`、`memoryUseAI`、`memoryIncludeContent`、`memoryResults`、`memorySummary`、`memorySettings`、`memoryRecordingBtn`、`memoryHistoryBtn`、`memoryBaseUrl`、`memoryModel`、`memoryApiKey`、`memorySaveSettingsBtn`、`memoryTestBtn`、`memoryExportBtn`、`memoryImportFile`、`memoryImportConfirmBtn`、`memoryConfirmDialog`。

清空和删除使用原生 `dialog`，支持取消、Escape和返回焦点。首次加载只请求status，不自动采集或访问模型。模型发往内容的许可默认未勾选，不持久化为全局授权。

## 验证

- 使用 `/Users/tinggengyan/.nvm/versions/node/v24.15.0/bin/node --test tests/unit/browsing-memory-ui.test.js tests/integration/ui-contract.test.js`：26项通过，0失败。原始记录：[ui-tests.log](evidence/ui-tests.log)。其中17项新增控制器行为测试，9项原有页面契约测试。
- 初始测试在模块尚未创建时因 `MODULE_NOT_FOUND` 失败；模块实现后测试通过。新增测试覆盖权限请求顺序、拒绝、密钥保留／清除、搜索乱序、清空后旧结果、内容许可撤回、选择变化、概括来源上限和导入确认，未将初始缺文件失败表述为真实业务失败复现。
- `node --check extension/src/ui/browsing-memory.js` 与 `node --check extension/i18n.js` 通过。
- `git diff --check` 通过；41个字面量 memory DOM 引用均能解析到静态标记。

## 验证边界

本记录不宣称已完成真实浏览器截图、原生权限弹框、真实用户模型服务或全站提取覆盖测试。上述界面与后台的真实浏览器集成由主会话验证；最终结果以集成交付报告为准。未修改AGENTS.md、提交、推送或访问真实模型服务。
