# 浏览记忆搜索：开发合同

状态：2.3.0首版实现完成，独立验收PASS；真实模型服务后续配置联调。基线版本2.2.0、213项测试；最终265项通过，详见[实现报告](implementation.md)与[验收报告](acceptance.md)。

## 原始需求与范围

用户要找回过去30天访问过但未收藏的内容，支持自然语言主题搜索、原链接和简短总结；公开文章、登录后文档和公司内网均需要，不限题材和域名。用户已有 OpenAI API 兼容模型服务，要求先开发、后调试。交付可配置服务地址、模型名称、密钥的可用扩展增量，不要求用户在聊天中提供凭据。

当前阶段开发 BL-011 主线，并复用打开标签／保存集合实现找回后继续。提供独立浏览记忆导出／导入、暂停／删除、容量控制。保留所有既有工作区修改，不提交、推送、上架、修改 AGENTS.md 或创建定时任务。无真实模型配置时用隔离测试模型服务验证协议与行为，明确尚未联调的范围。

## 架构与数据

- 后台统一负责 IndexedDB 记忆、模型访问、配置与权限校验；UI 仅通过 runtime bridge 发命令。网页脚本仅可提交本页内容，不可读取密钥或执行 UI 特权命令。
- 正文采集默认关闭，用户点击开启后申请可选 scripting 与 HTTP/HTTPS 页面权限。浏览历史导入单独申请可选 history 权限。模型连接只申请用户配置服务的来源权限；更换来源不转发原服务密钥。
- 普通网页、登录后网页共用通用正文提取路径；不读取密码、表单输入、可编辑草稿与脚本。无法访问、无正文、内容截断均不得宣称完整记录。既有历史只导入网址、标题、访问时间，不倒推历史正文。
- 文档为 `{id,url,title,text,visitedAt,capturedAt,source}`，时间使用毫秒；仅HTTP/HTTPS，拒绝URL凭据。metadata更新保留已有正文与正文采集时间。默认90天、5000条、32MiB预算，单页正文有长度上限，UI说明实际覆盖。
- API设置与密钥只保存在可信扩展存储，密钥不返回 UI、不写日志、不包含在备份中。保留现有配置备份白名单；新的浏览记忆以独立、版本化、可预览的文件导入导出。
- OpenAI兼容协议采用 `POST .../chat/completions`、`model/messages/stream:false`，不假设支持embeddings、工具或JSON模式。支持完整completion地址和API基址，普通错误与无效JSON可解释处理。
- 默认 AI 搜索仅发送查询做词义扩展；只有用户本次勾选允许发送候选内容时才做有边界的候选重排／总结。UI明确这一设置也覆盖内网／登录后内容。模型只可返回现有记录ID；链接与引用从本机取回，不采信模型生成URL，不执行正文中的指令。

## 冻结模块合同

Backend exports:

1. `createBrowsingMemoryRepository({indexedDB,dbName?,now?})`：`list({since?,until?,limit?})`, `getMany(ids)`, `upsert(input)`, `importRecords(records)`, `remove(ids)`, `clear()`, `prune({retentionDays,maxRecords,maxBytes})`, `stats()`, `revision()`。写入串行、原子，revision随变更递增。
2. `createOpenAICompatibleClient({fetchImpl?,timeoutMs?})`：`expand({query,config,signal?})`, `rerank({query,candidates,config,signal?})`, `summarize({query,sources,config,signal?})`, `test({config})`。`config={baseUrl,model,apiKey}`。expand只发query；rerank候选为`{id,title,url,snippet}`；summary sources为`{id,title,url,text}`，返回`{items:[{text,sourceIds,quote?}]}`。
3. `createBrowsingMemorySearchService({repository,modelClient,now?})`：`search({query,days=30,limit=30,useAI=false,includeContent=false,config?})`→`{results:[{id,url,title,visitedAt,capturedAt,coverage,snippet,reason?}],mode,warnings,scanned}`；mode为local/expanded/reranked，coverage为content/metadata。`summarize({query,ids,includeContent,config})`→`{items,sources,warnings}`。异步响应前复核revision，删除／清空后的旧结果不得复现。

Runtime bridge: `{type:'browsing-memory',action,payload}`，响应 `{ok:true,data}` 或 `{ok:false,error:{code,message}}`。特权actions仅可信扩展页面可调用：status,getSettings,saveSettings,testConnection,setRecording,importHistory,search,summarize,remove,clear,export,import,open,save。网页采集采用独立消息类型，校验sender当前标签URL、主frame和非无痕状态。getSettings返回apiKeyConfigured，不返回密钥；saveSettings中apiKey缺省保留、空串删除。配置跨来源变更清除旧密钥，除非该次明确提供新值。

集成审查补充（不改变业务范围）：search携带requestId，cancel action使用`{requestId}`撤销后台AbortController；撤回本次正文发送许可时取消在途查询，防止扩展词请求结束后继续外发候选正文。权限撤销使在途采集失效；提取正文时同时检查阅读区祖先是否为表单、可编辑区或隐藏区。

Status data: `{settings,stats,permissions:{capture,history},lastError?}`。Settings: `{recording,retentionDays,exclusions,baseUrl,model,apiKeyConfigured}`。setRecording payload `{enabled}`，权限由UI用户手势直接申请后再调用；importHistory payload `{days:30}`；search/summarize同服务参数但后台使用已存config，不接受页面传入密钥配置；remove/open/save为`{ids,name?}`；clear为`{}`且暂停采集；export返回`{format:'tab-out-memory',version:1,exportedAt,records}`；import接受该数据并支持`{backup,preview:true}`预览；确认后`{backup,preview:false}`。open返回`{opened,reused,failed}`，save返回既有workspace对象并遵守免费额度。

## 实现归属

- Backend Developer：新增记忆仓库、OpenAI兼容client、检索服务及对应单测，不改UI或后台。
- UI Developer：新增浏览记忆UI JS/CSS、index.html及i18n.js、新UI测试。沿用当前暖色视觉，不改旧项目模块。
- 集成执行者：后台bridge、可选权限与内容脚本、独立Chrome/协议测试、版本打包与文档；不回退其他修改。
- 独立Tech Lead：只读依据原始需求、此冻结合同与实际证据验收。

## 可观察验收标准

- AC01 默认不采集、不导历史、不调用模型；拒绝权限仍能使用旧功能和本地已有记忆。
- AC02 用户手势可开启/暂停通用HTTP/HTTPS采集，公开与模拟登录后页面均能记录；表单、草稿、脚本、无痕及不匹配来源排除。权限撤销和清空后不继续写入旧采集。
- AC03 历史导入覆盖明确时间范围并标metadata，不声称旧正文；重复导入和页面采集保留现有正文，日期过滤按访问时间。
- AC04 IndexedDB重启持久化、并发写不丢记录，删除/清空/导入可正确处理；保留和容量上限可见。
- AC05 模型基址/完整地址、模型名和可选密钥可配置/测试，网络错误、401/429、超时、非JSON及格式错误有清楚结果；不泄露密钥或跨重定向发送凭据。
- AC06 自然语言查询通过模型扩展检索到正文相关结果，离线本地搜索可用；结果含真实链接、访问日期、命中片段与内容覆盖信息。
- AC07 未勾选发送内容时网络中没有历史文档/正文；勾选后仅发送本次有界候选／选中正文。未知ID、伪造引用／链接不被采信；删除后的异步结果失效。
- AC08 可总结选中的有正文记录，每条结论有有效来源；无正文、未允许发送、无有效引用不得伪装成功；摘要是模型生成信息。
- AC09 打开结果复用已开标签；选中结果可保存到现有集合，遵守额度；失效ID和不安全URL不可打开。
- AC10 独立文件可导出/预览/导回浏览记忆；不含密钥或服务配置；无效/超大导入不覆盖现有资产；清空暂停采集且UI立即更新。
- AC11 中英文一致，状态/错误/权限/内容发送说明清楚；键盘与390/768/1440px布局无严重阻碍。
- AC12 原有213项基线不回退，新增核心测试与隔离真实Chrome旅程通过；包可安装，文档明确需要用户真实模型服务后续联调。

真实用户网站全面兼容、真实用户模型输出质量及自然语言找回率尚不能由模拟服务证明；交付必须明确这些边界，不将协议/流程测试当作质量评测。
