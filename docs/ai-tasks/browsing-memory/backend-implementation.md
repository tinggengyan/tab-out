# 浏览记忆后端实现报告

依据冻结的 [task.md](task.md) 完成后端模块；不修改 UI、后台集成、manifest、AGENTS 或既有工作区变更。

## 实际交付

- `extension/src/storage/browsing-memory-repository.js`：IndexedDB documents/meta 对象仓库、唯一URL索引、串行与原子写入、持久化revision。历史元数据不会清空已有正文；批量导入先全量校验，外部ID与额外密钥字段不存储。支持删除、清空、统计和按日期／条数／字节预算淘汰旧记录；无变更的维护不增加revision。正文最多30000字符，超限标记truncated。
- `extension/src/services/openai-compatible-client.js`：支持HTTP/HTTPS API基址与完整completion地址的Chat Completions客户端。默认根地址补`/v1/chat/completions`；`/v1`等路径后补`/chat/completions`。拒绝URL凭据、查询参数与fragment；不跟随重定向、不携带浏览器登录cookie。请求只使用model/messages/stream，不假设JSON模式、tools或embeddings。
- `extension/src/services/browsing-memory-search-service.js`：本地标题／网址／正文检索、访问时间过滤、模型查询扩展、明确同意后的有限候选重排，以及选中正文的引用总结。查询扩展只发送查询；结果链接只取自本机记录。删除或清空后，异步模型结果通过revision检测失效。

## 兼容接口及边界

- 三个factory名称及数据形状遵守冻结合同，模块同时提供TabOutCore全局和CommonJS导出。
- 为Node测试提供可注入事务store；生产未配置该适配器时必须使用真实IndexedDB，不会静默回退成不持久化的内存存储。
- 客户端额外导出`normalizeOpenAIBaseUrl`，返回规范化后的完整completion endpoint；`parseModelJSON`支持纯JSON及带JSON围栏的回复。
- 服务错误只输出稳定错误code，不回显网络异常消息或服务错误响应体。支持有界超时，即使测试transport忽略AbortSignal也不会无限等待。
- 重排候选最多40条，每条snippet最多700字符；服务返回`scanned`与`aiCandidates`供界面解释检索覆盖。
- 总结最多8个来源、每来源8000字符、总32000字符；发生缩减时返回`summary_content_limited` warning。每条显示的总结必须带有效sourceIds和至少一个在所引用来源中确实存在的原文quote；错误引用被过滤，无有效引用则返回invalid_citations。
- 语义能力通过模型查询扩展和有明确内容发送同意的候选重排提供；没有新增embeddings端点要求，也没有宣称这是完整本地语义向量索引。

## 验证与证据

使用 `/Users/tinggengyan/.nvm/versions/node/v24.15.0/bin/node`。

1. 实现前写入仓库／客户端／检索测试，首次因模块尚未存在而失败，见 `evidence/backend-red-tests.log`。
2. 无变更prune错误增加revision的行为测试先失败（2 !== 1），修复后通过，见 `evidence/backend-prune-red.log`。
3. 三个定向测试文件共 **22项通过、0失败**，见 `evidence/backend-tests.log`。覆盖并发写、持久store重建、导入原子校验、旧正文保留、容量淘汰、语义扩展命中正文、离线回退、搜索／总结删除竞态、内容发送同意、伪造ID／quote、endpoint变体、无密钥服务、协议参数、错误脱敏和超时。
4. 三个新模块 `node --check` 与限定文件 `git diff --check` 退出0。

以上Node仓库测试使用注入事务适配器；真实IndexedDB、可选权限、网络权限、内容脚本与完整界面由主会话的隔离Chrome测试验证。本报告不将适配器测试当作真实浏览器验证，也没有连接用户真实模型服务或测量真实找回率。

## 未验证事项

- 用户自有模型的参数兼容、查询扩展效果、中文相关性和引用生成质量需要实际配置后联调。
- 本次backend子任务未执行全产品测试、真实Chrome、打包或独立验收；这些属于集成阶段。
- 正文提取覆盖、网页权限与采集删除门禁由集成层负责。API不负责在网页中执行操作，不接受模型生成的外部链接作为历史证据。
