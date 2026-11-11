# Tab Out 灵魂重建 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 以 `40579ec` 的 `extension/` 为底重建 Tab Out 3.0.0：按站点聚合，一键关闭、关闭重复、收纳与找回，全部可撤销，且不发任何外部请求。

**Architecture:** `extension/` 恢复为原版的单页结构（`app.js` 负责渲染与事件委托）。可单测的纯逻辑抽到 `extension/lib/*.js`，沿用"IIFE + `globalThis.TabOutLib` + `module.exports`"写法，由 `index.html` 按依赖顺序加载。真实浏览器验收由新增的首页守护测试完成。

**Tech Stack:** Chrome MV3，原生 JS/CSS/HTML；Node ≥ 22 内置 `node:test`；Chrome for Testing 加 CDP。

**Spec:** [design.md](./design.md)

## Global Constraints

- 无框架、无构建、无运行时依赖。Node 只用于测试和工具。
- manifest：保留 `key`；`permissions` 恰为 `["tabs", "storage", "favicon"]`；无 host 权限、无可选权限、无 `commands`/`omnibox`/`chrome_url_overrides` 以外的入口；`version` 为 `"3.0.0"`。
- 语言只有 `en`、`zh-CN`，两套词典的键与占位符必须完全一致。
- 页面不发出任何 http(s) 请求：图标用 `_favicon`，字体本地打包。
- 收纳记录存于 `collectedGroupsV3`。不读写、不删除旧键（`workspacesV2` 只在迁移时读取一次）。
- 区头动作作用于所有窗口；撤销时页面回到原窗口，原窗口已关闭则新开窗口。
- 撤销只保留最近一次操作，有效期 30 秒，下一次操作发生时失效。
- 卡片级按钮单行，不使用 `<details>` 或任何菜单。

## Review Focus

1. 页面渲染后标签已被别处关闭，再点关闭或收纳：应跳过已不存在的标签，不能整批失败。→ Task 3 测试 `close skips tabs that no longer exist`。
2. 站点组里有固定页：不关闭、不收纳，撤销后不重复打开。→ Task 3 测试 `pinned tabs are never closed`，Task 4 测试 `collect excludes pinned tabs`。
3. 关闭某窗口的全部标签导致窗口消失，之后撤销：应新开窗口放回。→ Task 3 测试 `undo recreates a closed window`。
4. 标题或 URL 含 HTML 或引号：按文本显示，不破坏属性。→ Task 2 测试 `escapeHtml neutralises markup and quotes`；Task 7 浏览器断言 #9。
5. 恢复收纳时其中一些页已经打开：不应再开一份重复页。→ Task 4 测试 `restoreAll skips urls already open`（Claude 的决定，见 Task 4）。

---

### Task 1: 原版基底、仓库清理与静态契约

**Files:**
- Replace: `extension/` → 来自 `git show 40579ec:extension/...` 的 12 个文件。保留当前的 `extension/LICENSE`。
- Create: `extension/config.js`（只含 `self.LOCAL_LANDING_PAGE_PATTERNS ||= []`、`self.LOCAL_CUSTOM_GROUPS ||= []` 两行）
- Modify: `extension/manifest.json`、`extension/index.html`、`package.json`、`.gitignore`（保留 evidence 规则）
- Delete:
  - `extension/src/`、`extension/locales/`、`extension/entitlement-config.js`、`extension/_locales/{ja,zh_TW}`
  - `server/`
  - `tools/` 下除 `check-javascript.mjs`、`run-chrome-e2e.mjs`、`chrome-test-client.mjs` 外的全部文件，以及 `tools/fixtures/`
  - `tests/` 全部现有文件
  - `docs/` 下除 `PRIVACY.md`、`product-reviews/2026-11-11-soul-review/`、`ai-tasks/2026-11-11-soul-rebuild/` 外的已跟踪文件
  - `design-qa.md`
- Test: `tests/integration/static-contract.test.js`

**Interfaces:**
- Produces: `package.json` scripts
  - `test`: `node --test`
  - `check`: `node tools/check-javascript.mjs`
  - `package`: 生成 `dist/tab-out-3.0.0-store.zip`
  - `e2e:home`: `node tools/run-chrome-e2e.mjs --home-only`

- [ ] **Step 1: 写静态契约测试**，包含以下断言：
  - `manifest.permissions` 深等于 `['tabs','storage','favicon']`；不存在 `host_permissions`、`optional_permissions`、`optional_host_permissions`、`commands`、`omnibox`；`version === '3.0.0'`；`key` 与 `git show 40579ec:extension/manifest.json` 的 `key` 相同。
  - `index.html` 中每个 `<script src>`、`<link href>` 指向的本地文件都存在。
  - `app.js` 中每个字面量 `getElementById('x')` 都能在 `index.html` 找到 `id="x"`。
  - `index.html`、`style.css`、`app.js`、`i18n.js` 中没有 `https?://` 资源引用（`<script src>`、`<link href>`、`@import`、`url(...)`、`s2/favicons`）。唯一白名单是页脚署名的 `<a href="https://x.com/zarazhangrui">`。
  - `index.html` 里没有 `onerror=` 之类的 inline 事件属性。
- [ ] **Step 2: 运行**，预期 FAIL（基底还没替换）：`node --test tests/integration/static-contract.test.js`
- [ ] **Step 3: 替换基底并完成清理。** manifest 改为上述权限和版本。`index.html` 做以下修改：
  - 删除 Google Fonts 的 `<link>`；
  - 把 `config.local.js` 加 inline `onerror` 的写法换成 `<script src="config.js">`；
  - `package.json` 的 `version` 改为 `3.0.0`。
- [ ] **Step 4: 运行**，预期 PASS：`npm test && npm run check`
- [ ] **Step 5: 提交** `chore: rebuild from original 40579ec base and remove v2 surfaces`

### Task 2: 转义、站点分组与重复检测

**Files:**
- Create: `extension/lib/sanitize.js`（复制当前版本 `src/shared/sanitize.js` 的 `escapeHtml` 与 `normalizeWebUrl`，命名空间改为 `TabOutLib`）
- Create: `extension/lib/grouping.js`
- Modify: `extension/app.js`
  - 删除 `renderStaticDashboard` 内的分组闭包，改为调用 lib；
  - 修改 `renderDomainCard`、`buildOverflowChips`、`renderDeferredItem`、`renderArchiveItem` 以及收纳列表渲染：所有插值的标题、URL、文案都经过 `escapeHtml`；
  - 所有图标改用 `_favicon`。
- Modify: `extension/index.html`（在 `app.js` 之前加载 `lib/sanitize.js`、`lib/grouping.js`）
- Test: `tests/unit/sanitize.test.js`、`tests/unit/grouping.test.js`

**Interfaces:**
- Produces（`TabOutLib.*` / `module.exports`）：
  - `escapeHtml(value: any) -> string`
  - `normalizeWebUrl(value: string) -> string|null`
  - `isRealTabUrl(url: string) -> boolean`：排除 `chrome://`、`chrome-extension://`、`about:`、`edge://`、`brave://`。
  - `groupTabsBySite(tabs: Tab[], { landingPatterns, customGroups }) -> Group[]`
    - `Group = { domain: string, label?: string, tabs: Tab[] }`
    - 常用首页组的 `domain` 为 `'__landing-pages__'`，排在最前，其余按 `domain` 不区分大小写排序；`file://` 归为 `'local-files'`。
    - 首页判定规则与自定义分组规则与原版 `app.js:1053-1105` 完全相同。
  - `faviconUrl(pageUrl: string, extensionId: string) -> string`：返回 `chrome-extension://${id}/_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=16`。
  - `duplicateTabIds(tabs: Tab[]) -> number[]`：按精确 URL 分组，每组保留 `active` 的那个（没有就保留第一个），返回其余标签的 ID。固定页永不返回。
  - `Tab = { id, url, title, windowId, index, active, pinned }`

- [ ] **Step 1: 写测试。**
  - `escapeHtml neutralises markup and quotes`：`escapeHtml('<img src=x onerror="a">\'')` 等于 `'&lt;img src=x onerror=&quot;a&quot;&gt;&#39;'`。
  - `groupTabsBySite puts landing pages first and groups by hostname`：输入含 `https://x.com/home`、两个 `https://github.com/a/b`、`file:///tmp/a.md`。断言输出的 domain 依次为 `['__landing-pages__','github.com','local-files']`。
  - `custom group rule merges hostnames under groupKey`。
  - `duplicateTabIds keeps the active copy`：3 个同 URL 标签（id 1、2、3，其中 2 为 active）返回 `[1,3]`。
  - `duplicateTabIds never returns pinned tabs`。
  - `faviconUrl uses the extension favicon endpoint and never google`。
- [ ] **Step 2: 运行**，预期 FAIL（模块不存在）：`node --test tests/unit/sanitize.test.js tests/unit/grouping.test.js`
- [ ] **Step 3: 实现两个 lib 文件，并改造 `app.js` 改为调用它们。** `fetchOpenTabs` 在映射中补上 `index` 和 `pinned` 两个字段。
- [ ] **Step 4: 运行**，预期 PASS：`npm test && npm run check`
- [ ] **Step 5: 提交** `feat: escape rendered tab data, use local favicons, extract site grouping`

### Task 3: 按 ID 关闭与撤销

**Files:**
- Create: `extension/lib/close-undo.js`
- Modify: `extension/app.js`
  - `close-single-tab`、`close-domain-tabs`、`dedup-keep-one`、`close-all-open-tabs`、`defer-single-tab` 全部改为调用 `undo.close(...)`，按标签 ID 关闭。不再使用 `closeTabsByUrls`/`closeTabsExact` 关闭用户标签。
  - 新增区头动作 `dedup-all`（目标为 `duplicateTabIds(getRealTabs())`）。
  - 新增 `undo-last` 动作。
  - "关闭全部"首次使用时，用 `confirm(t('confirm.closeAll'))` 提示；确认后写入 `closeAllConfirmedV1: true`。
- Modify: `extension/index.html`（toast 内新增 `<button id="toastAction" data-action="undo-last">`）
- Test: `tests/unit/close-undo.test.js`

**Interfaces:**
- Consumes: Task 2 的 `Tab` 结构（必须含 `id`、`url`、`windowId`、`index`、`pinned`）
- Produces:
  - `createUndoController({ tabsApi, windowsApi, now = Date.now, ttlMs = 30000 }) -> UndoController`
  - `UndoController.close(tabs: Tab[], meta?: { kind: string, collectedId?: string }) -> Promise<{ closed: number, skippedPinned: number }>`
    - 固定页跳过。
    - 先用 `tabsApi.query({})` 过滤掉已不存在的 ID，再调用 `tabsApi.remove(ids)`。
    - 记录 `[{ url, windowId, index }]` 作为最近一次操作。`closed === 0` 时不覆盖已有记录。
  - `UndoController.canUndo() -> boolean`：超过 `ttlMs` 返回 false。
  - `UndoController.undo() -> Promise<{ restored: number, meta } | null>`
    - 按 `windowId` 分组。窗口仍存在：按 `index` 升序 `tabsApi.create({ windowId, index, url, active: false })`。
    - 窗口已不存在：先 `windowsApi.create({ url: first.url, focused: false })`，再在新窗口追加其余页面。
    - 完成后清空记录。
  - `UndoController.clear() -> void`

- [ ] **Step 1: 写测试**，用内存假 `tabsApi`/`windowsApi`：
  - `close removes by id and records positions`
  - `pinned tabs are never closed`：返回 `{ closed: 1, skippedPinned: 1 }`。
  - `close skips tabs that no longer exist`：`remove` 只收到仍存在的 ID，且没有抛错。
  - `undo restores into the original window at the original index`：`create` 依次收到 `index` 2、5。
  - `undo recreates a closed window`：`windowsApi.create` 被调用 1 次，其余页面用新窗口 ID 创建。
  - `undo expires after 30 seconds`：`now` 推进 30001ms 后 `canUndo()` 为 false，`undo()` 返回 null。
  - `undo returns meta so callers can delete a collected record`：`close(tabs, { kind:'collect', collectedId:'c1' })` 之后 `undo()` 的 `meta.collectedId === 'c1'`。
- [ ] **Step 2: 运行**，预期 FAIL：`node --test tests/unit/close-undo.test.js`
- [ ] **Step 3: 实现模块，并完成 `app.js` 的接线。** toast 带撤销时显示 30 秒，否则沿用原版的 2.5 秒。
- [ ] **Step 4: 运行**，预期 PASS：`npm test && npm run check`
- [ ] **Step 5: 提交** `feat: close tabs by id with 30-second undo`

### Task 4: 收纳记录、迁移与"已收纳"栏

**Files:**
- Create: `extension/lib/collected-store.js`
- Modify: `extension/app.js`
  - 用 store 替换原版 `getTabGroups`/`saveTabGroups` 及其调用方：`collectAllTabs`、`restoreTabGroup`、`deleteTabGroup`、`restoreSingleGroupTab`、`remove-group-tab`、`renderTabGroups`。
  - `collect-domain-tabs` 与 `collect-all-tabs` 先 `add` 再调用 `undo.close(tabs, { kind:'collect', collectedId })`。
  - `undo-last` 拿到 `meta.collectedId` 时调用 `store.remove(id)`。
  - 启动时先 `await migrateLegacy(chrome.storage.local)`，再执行首次渲染。
- Modify: `extension/index.html`：把收纳栏（原 `tabGroupsColumn`）移到稍后查看栏**之前**；标题键改为 `collected.title`。
- Test: `tests/unit/collected-store.test.js`

**Interfaces:**
- Consumes: Task 3 的 `UndoController`
- Produces:
  - `createCollectedStore(storageArea, { now = () => new Date().toISOString(), id = () => crypto.randomUUID() }) -> CollectedStore`，键名 `collectedGroupsV3`
  - `CollectedStore.list() -> Promise<Record[]>`：最新的在前。
  - `CollectedStore.add({ name?, tabs: {url,title}[] }) -> Promise<Record>`
  - `CollectedStore.remove(id) -> Promise<Record|null>`
  - `CollectedStore.takeAll(id) -> Promise<Record|null>`：删除并返回整条记录。
  - `CollectedStore.takeTab(id, index) -> Promise<{url,title}|null>`：移除单页，记录为空时整条删除。
  - `Record = { id, savedAt, name?, sourceId?, tabs: {url,title}[] }`
  - `migrateLegacy(storageArea, { now }) -> Promise<{ migrated: number }>`
    - 已有 `soulMigrationV1` 时直接返回 `{ migrated: 0 }`。
    - 否则把 `workspacesV2[]` 和残留的 `tabGroups[]` 转成 Record 并追加：
      - workspace：`name` ← `name`；`savedAt` ← `sessionSavedAt || updatedAt || createdAt || now()`；`tabs` ← `entries.map(({url,title}) => ({url,title}))`；`sourceId` ← `'workspace:' + id`。
      - tabGroup：`sourceId` ← `'tabGroup:' + id`。
    - 跳过已存在相同 `sourceId` 的记录，以及没有可用 URL 的记录。
    - 写入 `soulMigrationV1 = { migratedAt, count }`。
    - 永不写入或删除 `workspacesV2`、`tabGroups`。
  - `restoreTargets(record, openUrls: Set<string>) -> {url,title}[]`：过滤掉已经打开的 URL（Claude 的决定：恢复时不制造重复页）。

- [ ] **Step 1: 写测试**（内存 storage）：
  - `add then list returns newest first`
  - `takeAll removes the record`
  - `takeTab removes one page and drops an empty record`
  - `collect excludes pinned tabs`：这是 `app.js` 的筛选规则，测试放在纯函数 `collectableTabs(tabs)` 上，该函数导出自本模块，过滤 `pinned`。
  - `restoreAll skips urls already open`：`restoreTargets({tabs:[a,b]}, new Set([a.url]))` 深等于 `[b]`。
  - `migrateLegacy converts workspacesV2 and leftover tabGroups once`：2 个 workspace 加 1 个 tabGroup 迁移出 3 条记录；`workspacesV2` 原样不变；第二次调用 `migrated === 0`。
  - `migrateLegacy is idempotent by sourceId even without the flag`：删掉 flag 再跑一次，记录数仍为 3。
- [ ] **Step 2: 运行**，预期 FAIL：`node --test tests/unit/collected-store.test.js`
- [ ] **Step 3: 实现，并完成 `app.js` 的接线。**
  - 收纳栏卡片标题显示 `name`；没有 `name` 时显示原版的日期。
  - "全部恢复"在当前窗口逐个 `chrome.tabs.create({ url, active:false })`，只打开 `restoreTargets` 的结果。
- [ ] **Step 4: 运行**，预期 PASS：`npm test && npm run check`
- [ ] **Step 5: 提交** `feat: stash records with one-click restore and migration from v2 projects`

### Task 5: 导入导出兼容 v1 与 v2.3 备份

**Files:**
- Create: `extension/lib/config-io.js`
- Modify: `extension/app.js`（`exportConfig`、`importConfig` 改为调用该模块）
- Test: `tests/unit/config-io.test.js`

**Interfaces:**
- Consumes: Task 4 的 `Record` 结构
- Produces:
  - `buildExport({ shortcuts, deferred, collectedGroups }, now) -> { version: 3, exportedAt, shortcuts, deferred, collectedGroups }`
  - `parseImport(payload) -> { shortcuts?, deferred?, collectedGroups? } | null`，可识别三种格式：
    - **v3**：直接取三个字段。
    - **v1**：顶层的 `shortcuts`、`deferred`、`tabGroups`，其中 `tabGroups` 转为 Record。
    - **v2**：`payload.version === 2` 且有 `payload.data`，取 `data.shortcuts`、`data.deferred`；`data.workspacesV2` 加 `data.tabGroups` 用 Task 4 的同一转换规则转为 Record。
    - 无法识别时返回 `null`。
  - 导入时 `collectedGroups` 按 `sourceId`/`id` 去重后**追加**到现有记录；`shortcuts`、`deferred` 沿用原版的覆盖语义。

- [ ] **Step 1: 写测试。**
  - `parseImport accepts v3 export round-trip`
  - `parseImport converts v1 tabGroups`
  - `parseImport converts v2.3 backup workspaces`：用含 `data.workspacesV2` 两项的样例，断言得到 2 条 Record，且 `tabs[0].url` 正确。
  - `parseImport rejects unrelated json`：`parseImport({ foo: 1 })` 为 `null`。
- [ ] **Step 2: 运行**，预期 FAIL：`node --test tests/unit/config-io.test.js`
- [ ] **Step 3: 实现，并完成接线。**
- [ ] **Step 4: 运行**，预期 PASS：`npm test && npm run check`
- [ ] **Step 5: 提交** `feat: import v1 and v2.3 backups into stash records`

### Task 6: 首页布局、字体与文案

**Files:**
- Modify: `extension/style.css`、`extension/index.html`、`extension/app.js`（`renderDomainCard`、区头渲染）、`extension/i18n.js`
- Create: `extension/fonts/{dm-sans-latin-400,dm-sans-latin-500,dm-sans-latin-600,newsreader-latin-400,newsreader-latin-400-italic}.woff2`、`extension/fonts/OFL.txt`
  - 来源：`cdn.jsdelivr.net/npm/@fontsource/{dm-sans,newsreader}@5.0.18/files/`
  - 许可文件：同版本包内的 `LICENSE`
- Test: `tests/unit/i18n.test.js`

**Interfaces:**
- Consumes: Task 3 的 `dedup-all`、`undo-last`；Task 4 的收纳栏
- Produces: DOM 契约，供 Task 7 使用：
  - 区头 `#openTabsSectionCount` 内含 `[data-action="dedup-all"]`（仅在有重复时出现）、`[data-action="collect-all-tabs"]`、`[data-action="close-all-open-tabs"]`。
  - 每张 `.mission-card` 内有且仅有一个 `.actions`，其中直接子元素是 `button`，按此顺序：`[data-action="close-domain-tabs"]`、`[data-action="collect-domain-tabs"]`、`[data-action="dedup-keep-one"]`（仅在有重复时出现）。
  - 重复徽标 `.dupe-count-badge` 与站点名同处 `.mission-top`。
  - 行内按钮 `.chip-actions` 默认 `visibility:hidden`，在 `.page-chip:hover` 或 `:focus-within` 时可见。

- [ ] **Step 1: 写 i18n 测试**：在 `vm` 中加载 `i18n.js`。
  - `en and zh-CN have identical keys`
  - `placeholders match per key`：两种语言里每个键提取出的 `{x}` 集合相同。
  - `new copy exists`：以下键在两种语言中都存在：`btn.closeAllShort`、`btn.collect`、`btn.dedupShort`、`btn.dedupAll`、`btn.undo`、`confirm.closeAll`、`collected.title`、`toast.undone`。
- [ ] **Step 2: 运行**，预期 FAIL：`node --test tests/unit/i18n.test.js`
- [ ] **Step 3: 实现布局。**
  - `@font-face` 指向 `fonts/`。
  - `.actions` 改为 `display:flex; flex-wrap:nowrap; align-items:center; gap`；按钮统一为 `.action-btn` 尺寸（12px，高 28px）。
  - 卡片宽度不足以单行容纳长文案时，切换为短文案；完整文案放进 `title` 和 `aria-label`。用 `ResizeObserver` 或容器查询实现均可。
  - 去重按钮使用琥珀色描边。
  - 重复徽标移入 `.mission-top`。
  - 删除原版 `.mission-meta` 右侧的大数字列，避免与标题行的数量重复（Claude 的决定）。
  - 补齐两种语言的文案。
- [ ] **Step 4: 运行**，预期 PASS：`npm test && npm run check`
- [ ] **Step 5: 提交** `feat: single-row card actions, global dedup, bundled fonts`

### Task 7: 首页守护测试（真实浏览器）

**Files:**
- Create: `tools/chrome-home-e2e.mjs`（以审查用走查脚本为蓝本：本地 HTTP 夹具、`*.localhost` 站点、`connectPage`）
- Modify: `tools/run-chrome-e2e.mjs`：只保留 `--home-only` 套件，并设为默认套件。
- Modify: `tools/chrome-test-client.mjs`：删除 `details.project-card-menu` 的特殊处理。

**Interfaces:**
- Consumes: Task 6 的 DOM 契约；Task 4 的 `collectedGroupsV3`、`soulMigrationV1`

- [ ] **Step 1: 编写守护脚本**，对 design.md §5 的 13 条验收逐一断言。夹具与审查报告一致：
  - 站点 docs、news、mail、shop、video，共 15 个标签，3 个精确重复；
  - 3 条稍后查看，另预置 1 条收纳记录；
  - 视口 1440×900（第 3 条断言另测 1366 宽度）；
  - `TAB_OUT_TEST_LOCALE` 分别为 `zh-CN` 和 `en`。

  具体要求：
  - 控件计数口径：`button, a, summary, input` 中可见且位于首屏内的元素，不计 `visibility:hidden`。
  - 第 8 条：在首次导航前开启 `Network.enable`，收集该页面所有 `Network.requestWillBeSent` 事件，断言 URL 全部以 `chrome-extension://` 或 `data:` 开头。
  - 第 9 条：额外打开一个标题为 `<img src=x id=pwn>` 的夹具页，断言 `document.getElementById('pwn') === null`，且页面文字中包含该字面量。
  - 第 10 条：在全新配置中，先 `chrome.storage.local.set` 预置 `workspacesV2`（2 项）并删除 `soulMigrationV1`，然后 `Page.reload`，断言 `collectedGroupsV3` 新增 2 条。
- [ ] **Step 2: 运行**：`npm run e2e:home`，两种语言都 PASS，截图写入 `TAB_OUT_TEST_ARTIFACTS`。
- [ ] **Step 3: 提交** `test: home guard e2e for soul metrics and core actions`

### Task 8: 文档与收尾

**Files:**
- Modify: `README.md`、`CLAUDE.md`、`docs/PRIVACY.md`、`CHANGELOG.md`（新增 `## 3.0.0 — 2026-11-11`）
- Create: `docs/ai-tasks/2026-11-11-soul-rebuild/implementation.md`（实际改动、验证命令与输出、偏离设计之处）

- [ ] **Step 1: 改写文档。**
  - README：功能列表、安装方式、`npm test`、`npm run e2e:home`、"归档版请在另一个 Chrome 配置中加载"。
  - CLAUDE.md：新结构、`lib/` 模式、守护测试、"新功能默认不进首页"。
  - PRIVACY：无任何网络请求；仅 `chrome.storage.local`。
- [ ] **Step 2: 最终验证**：依次运行 `npm test && npm run check && npm run e2e:home && npm run package`，全部通过，并生成 `dist/tab-out-3.0.0-store.zip`。
- [ ] **Step 3: 提交** `docs: describe Tab Out 3.0 and record rebuild verification`
