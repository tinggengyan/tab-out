# Tab Out 搜索 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一个浮层，按关键词搜索打开的标签页、稍后查看、已收纳，以及授权后的书签和历史记录。

**Architecture:** `extension/lib/search.js` 放纯逻辑：分词、匹配、分组、去重、高亮、书签展开。`app.js` 负责以下几件事：
- 读取数据；
- 画浮层；
- 处理键盘和执行结果；
- 申请可选权限。

浮层的 DOM 静态写在 `index.html` 里，默认 `hidden`。

**Tech Stack:** Chrome MV3，原生 JS/CSS；`node:test`；Chrome for Testing + CDP。

**Spec:** [design.md](./design.md)

## Global Constraints

- `permissions` 恰为 `["tabs", "storage", "favicon"]`；`optional_permissions` 恰为 `["history", "bookmarks"]`；`key` 与 `version`（3.0.0）不变。
- 页面零 http(s) 请求；书签和历史记录只读。
- `en` 与 `zh-CN` 键和占位符一致；术语沿用 CLAUDE.md 的对照表。
- 首屏常驻控件 ≤ 31。

## Review Focus

1. 标题含 HTML 或引号：高亮后仍是文本。→ Task 1 `highlight escapes markup around marks`；Task 4 e2e 搜索 XSS 标题。
2. `toLowerCase` 改变长度的字符（如 `İ`）：高亮不能错位或抛错。→ Task 1 `highlight falls back to plain text when case folding changes length`。
3. `javascript:` 书签：不能出现在结果里，更不能被执行。→ Task 1 `bookmarks and history keep only http, https and file`。
4. 打开浮层后收纳已被别处改动，再执行收纳单页：按网址找回，找不到就不动记录。→ Task 3 `openStashedPage` 按 URL 重新定位；Task 4 e2e。
5. 快速连续输入：迟到的历史结果不能覆盖新输入的结果。→ Task 3 用递增序号丢弃过期结果；Task 5 e2e 连续输入。

---

### Task 1: `lib/search.js` 纯逻辑

**Files:** Create `extension/lib/search.js`, `tests/unit/search.test.js`

**Produces:** `TabOutLib` 上新增以下接口：
- `tokenize(query) → string[]`
- `searchAll({ query, tabs, saved, stash, bookmarks, history }) → { tokens, groups: [{ key, items }] }`
  - `key` 取值：`tabs` / `saved` / `stash` / `bookmarks` / `history`；
  - `bookmarks` 或 `history` 为 `null` 时，表示未授权，不出该组。
- `highlight(text, tokens) → html`
- `flattenBookmarks(tree) → [{ id, title, url, path: string[] }]`
- `dayBucket(ms, now) → 'today' | 'yesterday' | 'earlier'`

`searchAll` 返回的条目类型：
- `{ kind: 'tab', id, windowId, url, title }`
- `{ kind: 'saved', id, url, title, savedAt }`
- `{ kind: 'record', recordId, name, count, savedAt }`
- `{ kind: 'stashPage', recordId, recordName, savedAt, url, title }`
- `{ kind: 'bookmark', id, url, title, path }`
- `{ kind: 'history', url, title, lastVisitTime }`

- [ ] 先写失败测试：分词、全部词命中、中文子串、分组顺序与空组、稍后查看只取未完成未删除、记录名命中出记录行、单页只按标题或网址命中、协议过滤、历史去重与按时间倒序、高亮转义与合并区间、长度变化回退、书签路径（不含根节点）、`dayBucket`。
- [ ] 运行 `node --test tests/unit/search.test.js`，预期 FAIL（模块不存在）。
- [ ] 实现，直到 PASS；`npm test` 全绿。
- [ ] Commit `feat: search matching, grouping and highlighting`

### Task 2: 契约、文案和静态结构

**Files:** Modify:
- `extension/manifest.json`
- `tests/integration/static-contract.test.js`
- `extension/i18n.js`
- `extension/index.html`
- `extension/style.css`

- [ ] 先改测试，预期 FAIL：
  - 可选权限恰为 history 和 bookmarks；
  - `app.js` 不出现书签或历史的写接口；
  - `lib/search.js` 在 `app.js` 前加载；
  - 浮层和按钮存在于 `index.html`。
- [ ] 改 manifest、加 `search.*` 文案（中英一致）、加静态 DOM 和样式，使测试 PASS。
- [ ] Commit `feat: search entry, overlay markup and optional permissions`

### Task 3: `app.js` 浮层行为

**Files:** Modify `extension/app.js`

- [ ] 实现以下功能：
  - 打开与关闭、`/` 键、焦点归还；
  - 读取数据；
  - 渲染四个状态；
  - ↑↓、回车、悬停选择、"还有 N 条"；
  - 六类结果的执行；
  - "开启"申请权限；
  - 过期结果丢弃。
- [ ] `npm test`、`npm run check` 全绿（行为由 Task 4、Task 5 的浏览器测试验证）。
- [ ] Commit `feat: search overlay across open tabs, saved, stash, bookmarks and history`

### Task 4: 首页守护 e2e（未授权）

**Files:** Modify `tools/chrome-home-e2e.mjs`

- [ ] 把检查 2 的上限改为 31。
- [ ] 新增场景 16，覆盖设计 §7 列出的未授权检查项。
- [ ] `npm run e2e:home` 全部 PASS（中英两轮）。
- [ ] Commit `test: browser checks for search`

### Task 5: 已授权 e2e

**Files:**
- Create `tools/chrome-search-e2e.mjs`
- Modify `tools/run-chrome-e2e.mjs`：增加一套测试，加载补全权限的扩展副本，key 不变，扩展 ID 不变

- [ ] 测试内容：
  - 书签路径；
  - 历史去重；
  - 回车在当前标签页打开；
  - 授权后不再出现授权卡片；
  - 连续输入后结果对应最后一次输入。
- [ ] `npm run e2e:home` 全部 PASS。
- [ ] Commit `test: browser checks for search with bookmarks and history granted`

### Task 6: 文档

**Files:**
- `CHANGELOG.md`
- `README.md`
- `CLAUDE.md`
- `../2026-11-11-soul-rebuild/design.md`（第 53 行和 §5 加注）
- `implementation.md`

- [ ] Commit `docs: search`
