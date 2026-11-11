# 浏览记忆搜索：2.3.0 实现报告

日期：2026-11-02。依据[开发合同](task.md)实现 BL-011 首版；真实模型服务按用户要求留待后续配置联调。没有提交、推送、上架或创建定时任务，未改写 AGENTS.md／CLAUDE.md，保留此前项目工作台的工作区改动。

## 可用行为

- 新标签页提供中英文浏览记忆入口、最近30天等日期过滤、本地／AI搜索、原链接、访问时间、片段及正文覆盖状态。打开优先复用现有标签；选中记录可保存到现有集合，沿用当前额度。
- 默认关闭采集。启用时申请可选页面／脚本权限，通用提取公开、登录后与内网页面已经加载的阅读内容，不设题材／域名白名单；排除表单、可编辑区域、隐藏区、脚本、非主frame与无痕页。历史导入单独申请权限，导入最近30天的标题、URL与访问时间，不能还原过去正文。
- 正文保存于 IndexedDB，默认90天、最多5000条／32MiB，每页最多30000字符。支持暂停、站点排除、删除、清空并暂停，以及独立JSON导出／导入预览。旧配置备份不包含正文库。删除阻止同一个仍打开文档立即再次记录，重新访问可形成新记录。
- 设置可填写模型地址、模型名、可选密钥并测试连接；支持自定义基址及完整 Chat Completions 地址，不要求 embeddings。密钥只在可信扩展存储保存，不回显、不进入备份，更换服务来源清除旧密钥；不使用远程代理。
- 默认AI搜索只发送查询来扩展词义，在本地检索正文。本次允许发送内容后才发送有限候选用于重排，或最多8篇选中正文用于概括。链接来自本地记录，摘要要求有效来源ID和真实原文摘录；无效ID／引用被拒绝。网络错误／格式错误时保留本地搜索结果。
- 内容许可撤回、删除／清空和页面权限撤销均处理在途请求，防止随后继续发送候选正文、显示已删除结果或写入旧采集。已经发送的网络数据无法撤回。

## 代码与集成

后台集中执行记忆仓库、配置、权限校验、模型请求及打开／保存。新模块位于 `extension/src/storage/browsing-memory-repository.js`、`extension/src/services/{browsing-memory-runtime,browsing-memory-search-service,openai-compatible-client}.js`、`extension/src/content/browsing-memory-content.js` 与 `extension/src/ui/browsing-memory.{js,css}`。网页脚本只能提交当前页采集，不能执行特权操作或读取密钥。

实现细节见 [Backend 报告](backend-implementation.md) 与 [UI 报告](ui-implementation.md)。更新了版本、README、隐私说明、使用指南、变更日志与backlog实际状态。原有许可与项目模块沿用，不新增运行时依赖。

## 验证结果

| 检查 | 结果与证据 |
| --- | --- |
| 开发前基线 | 213/213通过：[原始日志](evidence/baseline-tests.log) |
| 全量Node测试 | Node24.15.0，265/265通过、零跳过：[最终日志](evidence/final-node-tests.log) |
| JavaScript语法 | 49个模块通过：[日志](evidence/final-syntax.log) |
| 浏览记忆真实Chrome旅程 | Chrome151.0.7922.77，全部通过：[结果](evidence/final-memory/result.json)、[旅程日志](evidence/final-memory/memory/result.log) |
| 原有搜索与项目工作台Chrome回归 | 两套均通过：[结果](evidence/final-regression/result.json)、[搜索日志](evidence/final-regression/regression/result.log)、[项目日志](evidence/final-regression/projects/result.log) |
| 视觉检查 | 实际截图确认1440／768／390px布局无横向溢出：[搜索与引用](evidence/final-memory/memory/02-memory-search-summary.png)、[390px](evidence/final-memory/memory/03-memory-390.png) |
| 打包 | 53个文件与源码逐字节一致、ZIP完整、保留可选权限并含LICENSE：[校验和与文件哈希](evidence/package-verification.json) |
| 工作区检查 | `git diff --check`通过；AGENTS.md／CLAUDE.md无改动 |

复现入口：使用Node22+执行 `npm test`、`npm run check`、`npm run e2e:memory`、`npm run e2e:isolated` 和 `npm run package`。浏览器测试使用隔离的临时配置，不读取日常浏览数据。

真实Chrome测试包括带cookie校验的模拟登录页、表单祖先排除、动态hash路由、实际IndexedDB与历史API、真实HTTP协议替身、429／无效JSON降级、撤回内容许可、伪造来源过滤、打开复用、保存集合、实际下载与文件导入、后台强制停止后新进程重开IndexedDB并逐条比较正文、页面重载、删除竞态和多宽度布局。独立审查提出的表单祖先误采集、撤回许可后的后续外发、撤权时在途写入三项边界均已修复并复验；另补测真实后台重启持久化，避免只刷新页面作为证据。早期失败运行保留于evidence，最终依据为`final-*`。

## 交付与未验证项

- 安装包：[tab-out-2.3.0-store.zip](../../../dist/tab-out-2.3.0-store.zip)，172510字节，SHA-256：`b319599dd7dc04aa153f5b4a078acb6a18fd2af0df9a8945d0b61150d750c32e`。
- 已装本地扩展可直接重新加载，再刷新新标签页；配置步骤见[浏览记忆指南](../../BROWSING_MEMORY_GUIDE.md)。不要卸载或清空旧数据。
- 模拟服务证明请求协议、流程和数据边界，不能证明真实模型的理解／召回／摘要质量。用户服务地址、模型、密钥尚未配置；没有调用用户真实服务，也没有测试真实内网站点。
- 自动Chrome记忆测试只在临时扩展副本中预授可选权限；真实Chrome系统权限弹窗尚待人工联调。用户手势申请、拒绝和撤销路径由单元测试覆盖；交付包仍是可选权限。
- 通用提取不保证所有站点、图片／视频／PDF、未加载内容和特殊编辑器可读。当前不提供全量向量语义索引；关键词扩展＋本地召回＋有限候选重排的实际找回率与5000条真实数据性能仍需试用评测。
- 独立验收结论见 [acceptance.md](acceptance.md)。
