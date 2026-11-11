# 日本語翻译实现

原始需求：增加多语言支持。依据冻结 task.md，负责日语词典与 Chrome 扩展元数据；未修改其他开发者文件。

## 已实现

- 新增 `extension/locales/ja.js`，通过 `globalThis.TabOutLocales` 注册独立日语词典，共 578 个词条，涵盖标签页、项目、浏览记忆、设置、搜索平台、提示及无障碍名称。补齐原有结果复选框缺失的 `memory.selectResult`（`{title} を選択`）。
- 与最新英文词典逐键对应；所有占位符保留原名及数量。不合并英文词典，不以缺译回退冒充完整翻译。品牌名、协议、API、URL 与搜索命令保持原文。
- 新增 `extension/_locales/ja/messages.json`，保留产品名 Tab Out，扩展说明为日语。
- 统一术语：タブ、プロジェクト、閲覧メモリー、ワークスペース、保存して片付ける。隐私、权限、删除、API 密钥及失败信息保留原有含义。

## 实际验证

使用 `/Users/tinggengyan/.nvm/versions/node/v24.15.0/bin/node`：

1. `--check extension/locales/ja.js`：退出码 0。
2. 通过 `node:vm` 只读提取最新 `i18n.js` 英文词典并加载日语脚本，断言键集合完全相等、每个值非空、逐词条占位符集合（保留重复次数）完全相等；同时检查日语与英文 Chrome 元数据键相同、appName 仍为 Tab Out。

首次实际输出：`PASS: 577 complete Japanese strings, matching placeholders, and Chrome metadata keys.`

验收补充 `memory.selectResult` 后，日语共 578 词条；独立验证实际输出：`PASS: Japanese memory.selectResult preserves the {title} placeholder.`，语法检查退出码 0。并行主开发者尚未落盘英文补充时，全键一致性检查显示英文 577、日语 578，仅差新增的这一键；待主词典补充后由集成验证再检查完整 578 键，不将该中间结果记为通过。

## 验证边界

本子任务未运行整合页面的浏览器流程或全量回归，由主会话与主开发者执行。翻译尚未经过日语母语者审校；不能据此声称已完成母语审校。未新增网络翻译请求、权限或依赖，未提交或发布。
