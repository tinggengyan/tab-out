# 检索与正文抽取实现记录

Developer 实现；依据 task.md 冻结 AC6/AC7/AC13。仅修改指定检索/抽取范围和最小后台加载接线，保留工作区全部既有修改。未提交、推送、发布；未修改预声明检索语料、权限、配置、密钥、存储格式或 UI。

## 行为与文件

- `extension/src/services/browsing-memory-text.js`（新增）：多语言词分段、NFKC（统一全角等兼容字符）匹配、非中日韩词边界、旧正文显示/查询清理、紧凑摘要、安全纯文本高亮。AI 不再从 baike、baidu、paid、trail 等长词片段取得证据；完整词及显式网址仍能命中。中日韩文本可匹配连续文字，不用站点白名单。
- `extension/src/services/browsing-memory-search-service.js`：评分、摘要和字段解释使用统一匹配器。旧正文在查询时清理碎片换行和可识别导航，原存储和摘要引用校验仍读取原始 `record.text`；不要求迁移或重新导入。保留模型扩词、授权后的候选重排、真实来源限制、修订保护，并补强中止检查。
- `extension/src/content/browsing-memory-content.js`：按段落/标题/阅读块输出，行内强调和链接自然连接。遍历可见 body，避免仅第一篇 article 导致同页论坛回复丢失；保留评论正文，排除表单、输入控件、contenteditable（可编辑区域）、textbox、隐藏节点、标准导航和页脚。整页编辑模式不采集。继续保持 30000 字符与 15000 节点上限。
- `extension/background.js`：仅增加 helper 的 `importScripts` 一行，排在检索服务之前。
- `tests/unit/browsing-memory-content.test.js`（新增）与 `tests/unit/browsing-memory-search.test.js`（追加）：边界、旧文清理、多语言、高亮、摘要上限、原文引用、取消、论坛和敏感输入回归。

结果 API 保留所有既有字段，新增：

```js
{
  matchedFields: ['title', 'url', 'text'], // 实际命中字段的子集
  matchedTerms: ['ai'],                  // 实际词法证据，已统一字符与大小写
  snippet: '…纯文本摘要…',               // 最多 240 个 JS 字符（UTF-16 单元）
  snippetParts: [{ text: 'AI', match: true }, { text: ' notes', match: false }]
}
```

`snippetParts` 文本连接严格等于 `snippet`，不含 HTML。界面应通过文本节点渲染。语义重排可返回没有词法证据的候选，因此匹配数组可能为空；已有 `reason` 保留。`includeContent` 仍只控制 AI 请求的正文授权，本地正文搜索始终可用。此接口已提前同步给 UI Developer。

## 实际验证

工作目录：仓库根目录。Node：`/Users/tinggengyan/.nvm/versions/node/v24.15.0/bin/node`。

| 执行命令 | 结果 | 原始证据 |
| --- | --- | --- |
| `node --test tests/unit/browsing-memory-{search,content,runtime,repository}.test.js` | 38/38 通过 | `evidence/search-unit.log` |
| `node tools/check-javascript.mjs` | 58 个 JavaScript 模块语法通过（执行时工作区状态） | `evidence/search-static.log` |
| `node docs/ai-tasks/2026-11-05-release-convergence/evidence/search-performance.cjs` | 15000 行旧碎片 / 75007 字符清理与摘要 43.20 ms；无 Intl.Segmenter 降级及组合音标 72.66 ms；5000 页 × 约 30000 字符，1032.76 ms，目标唯一正确命中 | `evidence/search-performance.log`，可重跑脚本同目录 |

上述计时为本机一次合成检查，不代表用户设备保证。15000 行压力样本刻意超过通常存储正文上限，覆盖碎片拼接退化风险。清理使用一次数组拼接、词边界常数读取和线性降级分段，避免重复遍历已拼接文本。

主会话独立执行预声明 28 页/20 题合成词法评估（`evidence/retrieval.json`）：修改前后目标前三均 20/20；修改后所有目标第一；AI 的五个预标记干扰结果变为零；显式 URL 仍命中；摘要均单行且不超过 240 字符。这是小样本词法回归，不是实际用户找回质量、语义理解或模型联调结论。

## 限制与交接

- 尚未由本 Developer 执行 Chrome 集成或真实服务请求；真实用户内容未上传，模型能力仅用桩对象验证调用/授权/回退/引用约束。
- 导航清理为保守启发式。没有 DOM（页面结构）的旧正文无法完美分辨文章中的导航主题与网站导航。存储原文不改写，引用仍依原文核对。
- 新抽取覆盖可见普通页面结构及论坛回复；不新增 Shadow DOM、跨 frame、PDF 或 Canvas 识别能力。使用标准 header/aside/footer 的网站可能将少量阅读内容置于被排除节点，未作网站特例。
- 完整 Node、Chrome 三视图/尺寸、真实操作旅程、打包与独立验收由主会话统筹。实现完成不等于冻结 AC 已独立验收。
