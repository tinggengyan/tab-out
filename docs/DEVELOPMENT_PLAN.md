# Tab Out 商业化开发方案

> 文档状态：Draft v1.0  
> 更新日期：2026-08-09  
> 对应产品方案：[PRODUCT_PLAN.md](./PRODUCT_PLAN.md)  
> 当前基线：Manifest V3、无构建工具、原生 JavaScript/CSS、`chrome.storage.local`

## 1. 实施目标

在不破坏现有轻量、本地优先体验的前提下，分阶段交付：

1. 可逆操作、数据安全和可迁移存储。
2. 完整会话捕获、自动快照与可靠恢复。
3. 工作空间、全局搜索与自动化规则。
4. 本地 Pro 授权。
5. 经验证后再交付端到端加密同步。

## 2. 当前技术基线评估

### 2.1 架构

- `extension/index.html`：单页新标签界面。
- `extension/app.js`：约 2,000 行，混合 Chrome API、存储、领域逻辑、模板和事件处理。
- `extension/background.js`：service worker，目前仅维护徽标。
- `extension/i18n.js`：运行时中英文词典。
- `extension/style.css`：全局样式。
- `extension/manifest.json`：Manifest V3，权限为 `tabs`、`activeTab`、`storage`、`favicon`。

### 2.2 当前存储

- `deferred`：稍后查看及归档项目。
- `tabGroups`：仅保存 `url`、`title` 的收纳组。
- `shortcuts`：自定义快捷入口。
- 导出格式 `version: 1`，无统一 schema 元数据和迁移执行器。

### 2.3 主要技术债

- UI、业务和存储高度耦合，继续向单一 `app.js` 增长会提高回归风险。
- 多处字符串模板写入 `innerHTML`，外部标题与用户输入缺少统一安全边界。
- ID 使用 `Date.now()`，并发创建时可能冲突。
- 关闭与删除没有持久化操作日志。
- 收纳不保留 `windowId`、`index`、`pinned`、`groupId` 等恢复信息。
- service worker 未承担快照调度、恢复任务和存储维护。
- 没有自动化测试、构建校验和发布流水线。
- `index.html` 引用 Google Fonts 外部资源；商店版本应验证 CSP、离线体验和远程资源政策，优先改成本地字体或系统字体。

## 3. 目标架构

保持无框架也可以完成前两阶段，但先完成模块化。建议目录：

```text
extension/
  manifest.json
  background.js
  index.html
  style.css
  i18n.js
  src/
    api/
      tabs-api.js
      groups-api.js
      windows-api.js
    domain/
      session.js
      workspace.js
      operation.js
      rule.js
    storage/
      db.js
      schema.js
      migrations.js
      repositories.js
      retention.js
    services/
      capture-service.js
      restore-service.js
      snapshot-service.js
      undo-service.js
      search-service.js
      entitlement-service.js
    ui/
      render.js
      events.js
      views/
      components/
    shared/
      ids.js
      sanitize.js
      errors.js
      telemetry.js
tests/
  unit/
  integration/
  e2e/
```

建议引入轻量构建与测试链路：ES modules + esbuild/Vite、Vitest、Playwright。若团队坚持零构建，则至少用原生 ES modules 和 Node test runner；不要继续把新领域逻辑加入 `app.js`。

## 4. 存储设计

### 4.1 存储选择

小型设置保留在 `chrome.storage.local`；会话、操作日志和搜索数据建议迁至 IndexedDB。

- `chrome.storage.local`：schema 元数据、设置、onboarding、entitlement 缓存、规则开关。
- IndexedDB：sessions、snapshots、workspaces、operations、trash、search index。
- `chrome.storage.sync`：仅用于小体积、非敏感偏好；不用于标签资产。

原因：历史快照会快速增长，IndexedDB 更适合结构化记录、索引、事务和容量管理。

### 4.2 顶层 schema

```ts
type StorageMeta = {
  schemaVersion: number;
  installedAt: string;
  migratedAt?: string;
  deviceId: string;
};

type Session = {
  id: string;
  type: 'manual' | 'automatic' | 'collected' | 'undo';
  name?: string;
  capturedAt: string;
  deviceId: string;
  windows: SessionWindow[];
  stats: { windowCount: number; tabCount: number; groupCount: number };
  fingerprint: string;
  schemaVersion: number;
};

type SessionWindow = {
  sourceWindowId?: number;
  focused: boolean;
  incognito: boolean;
  state?: 'normal' | 'minimized' | 'maximized' | 'fullscreen';
  tabs: SessionTab[];
  groups: SessionGroup[];
};

type SessionTab = {
  id: string;
  url: string;
  title: string;
  index: number;
  active: boolean;
  pinned: boolean;
  groupRef?: string;
  favIconUrl?: string;
  restorable: boolean;
  capturedAt: string;
};

type SessionGroup = {
  ref: string;
  title?: string;
  color: chrome.tabGroups.ColorEnum;
  collapsed: boolean;
  tabIds: string[];
};
```

### 4.3 操作与回收站

```ts
type Operation = {
  id: string;
  kind: 'close' | 'collect' | 'delete' | 'restore' | 'move';
  createdAt: string;
  expiresAt?: string;
  status: 'pending' | 'complete' | 'partially_failed' | 'undone';
  before?: Session;
  targetRefs: string[];
  result?: { succeeded: number; failed: RestoreFailure[] };
};

type TrashItem = {
  id: string;
  entityType: 'session' | 'workspace' | 'deferred';
  entityId: string;
  payload: unknown;
  deletedAt: string;
  purgeAt: string;
};
```

所有持久实体使用 `crypto.randomUUID()`；时间统一 ISO 8601 UTC。

### 4.4 工作空间

```ts
type Workspace = {
  id: string;
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  pinned: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
  entries: WorkspaceEntry[];
};

type WorkspaceEntry = {
  id: string;
  url: string;
  title: string;
  order: number;
  pinned?: boolean;
  group?: string;
  addedAt: string;
};
```

### 4.5 迁移策略

首次升级执行：

1. 读取旧 `deferred`、`tabGroups`、`shortcuts`。
2. 在写入新库前创建 `migrationBackupV1`。
3. 将旧 `tabGroups` 转为 `Session(type='collected')`，缺失字段采用安全默认值。
4. 校验条数和关键字段后切换 `schemaVersion`。
5. 迁移失败时保留旧数据并回退旧读取路径，不清空数据。
6. 两个稳定版本后再提供清理旧备份的操作，不自动提前删除。

## 5. 核心技术流程

### 5.1 会话捕获（PRD-201）

1. `chrome.windows.getAll({ populate: true })` 获取窗口和标签。
2. 收集非 Tab Out 页面；内部页标注是否可恢复，不静默丢弃。
3. 汇总有效 `groupId`，通过 `chrome.tabGroups.get()` 获取组元数据。
4. 规范化并生成 fingerprint；与最近快照相同则跳过写入。
5. 事务写入 Session，再更新索引和保留策略。

注意：不捕获 incognito 数据，除非用户明确允许扩展在无痕模式运行；即使允许，也默认不持久化。

### 5.2 自动快照（PRD-202）

由 service worker 监听：

- `tabs.onCreated/onRemoved/onMoved/onUpdated/onAttached/onDetached`
- `tabGroups.onCreated/onUpdated/onRemoved/onMoved`
- `windows.onCreated/onRemoved`

事件只标记 dirty，使用 10–30 秒 debounce 合并捕获。另用 `chrome.alarms` 做周期兜底和保留策略清理，因此 manifest 需新增 `alarms` 权限。

避免在每次标题变化时写快照；`onUpdated` 仅对 URL、pinned、groupId 等结构字段触发。

### 5.3 安全关闭与撤销（PRD-101）

所有关闭入口必须调用统一 `operationService.close()`：

1. 捕获目标标签所在窗口的 before session。
2. 持久化 `Operation(status='pending')`。
3. 调用 `chrome.tabs.remove()`。
4. 更新操作结果后显示撤销 toast。
5. 撤销时使用 before session 的目标子集执行恢复。

UI 动画不能先于操作日志落盘。浏览器 API 部分失败时展示准确数量。

### 5.4 恢复引擎（PRD-203）

恢复采用可重入任务：

1. 创建 `RestoreJob` 并写入待恢复列表。
2. 根据模式创建或选择窗口。
3. 创建未分组标签并记录旧引用到新 tabId 的映射。
4. 设置 pinned、顺序和 active 状态。
5. 使用映射创建原生标签组并恢复元数据。
6. 输出逐项结果；失败项保留重试入口。
7. 任务完成前不删除原收纳或快照数据。

service worker 重启后应能根据 job 状态继续或安全重试。

### 5.5 搜索（PRD-401）

首版采用本地倒排索引，无需远程搜索：

- 索引规范化 title、hostname、pathname、workspace 名和 entity type。
- 中文按字符 bigram，英文按 token；输入变化 debounce 100–150ms。
- URL 与标题只在本机索引。
- 数据变更时增量更新，schema 变化时可完整重建。

数据量在万级以内可使用自研轻量索引；超过此范围再评估 MiniSearch 等依赖，并审查包体和许可证。

## 6. 安全与隐私

### 6.1 DOM 安全

- 禁止把 tab title、URL、shortcut name、导入内容直接拼入 `innerHTML`。
- 优先使用 `textContent`、`setAttribute` 和 DOM API。
- 若必须模板渲染，统一调用经过测试的 `escapeHtml`/`safeUrl`。
- 仅允许 `http:`、`https:` 及产品明确支持的协议；阻止 `javascript:` 等危险 URL。
- 外链使用 `noopener`，并明确新窗口行为。

### 6.2 数据验证

- 为导入、存储读取、同步载荷建立 runtime schema 校验。
- 限制单文件大小、实体数、字符串长度和嵌套深度。
- 无效实体跳过并生成报告，不因单条坏数据丢弃整份导入。

### 6.3 权限

按功能逐步申请：

- 现有：`tabs`、`storage`、`favicon`。
- 快照：新增 `tabGroups` API 无需单独权限；定时维护新增 `alarms`。
- omnibox：manifest 新增 `omnibox` 配置。
- 支付或同步不应扩大网页 host permissions；后端域名使用最小白名单。

重新评估 `activeTab` 是否仍必需，不必需则移除。

### 6.4 遥测

- 默认事件不得包含 URL、标题、搜索词或用户命名内容。
- 事件 schema 需代码审查；开发环境可打印，生产环境默认静默。
- 遥测必须可关闭，并在隐私政策中逐项说明。

## 7. Pro 授权与支付

### 7.1 第一阶段建议

支付放在外部 HTTPS 结账页，扩展只接收短期兑换码或登录后的 entitlement。不要把支付密钥放入扩展。

授权对象：

```ts
type Entitlement = {
  plan: 'free' | 'pro_lifetime' | 'sync';
  status: 'active' | 'grace' | 'expired' | 'refunded';
  issuedAt: string;
  expiresAt?: string;
  features: string[];
  signature: string;
};
```

- 服务端使用私钥签名，扩展内置公钥离线验签。
- Lifetime 可长期离线使用。
- Sync 允许 7 天离线宽限，过期后只停止新增同步，不锁定本地数据。
- 开发环境提供固定 test entitlement，禁止发布包包含绕过开关。

### 7.2 Feature gates

功能门禁集中在 `entitlement-service.js`，UI 只消费能力：

- `history.days`
- `manualSnapshots.unlimited`
- `workspaces.limit`
- `search.advanced`
- `rules.enabled`
- `sync.enabled`

不能在各按钮里散落套餐判断。

## 8. 同步架构（验证后实施）

### 8.1 加密模型

- 客户端生成 256-bit 主密钥。
- 使用用户口令经 Argon2id 派生 KEK，加密主密钥。
- 数据采用 AES-256-GCM，每条记录使用独立 nonce。
- 服务端仅保存密文、版本向量和设备元数据。
- 恢复码可解封主密钥；服务端不可重置加密内容。

正式实施前必须完成独立安全设计评审，不以本节替代密码学评审。

### 8.2 同步协议

- 实体包含 `id`、`updatedAt`、`deletedAt`、`deviceId`、revision/vector clock。
- 默认 last-write-wins 只适用于设置；工作空间条目使用实体级合并。
- 删除使用 tombstone，达到保留期且所有活跃设备确认后清理。
- 所有 API 幂等，客户端保留 outbox，离线后重试。

### 8.3 服务端最小范围

- 身份认证与设备管理
- entitlement 查询
- 加密 blob 增量上传/下载
- 用量、限流和账户删除
- 支付 webhook

服务端不建立 URL 或标题索引，不记录明文 payload。

## 9. 测试方案

### 9.1 单元测试

- schema 验证与各版本迁移
- session fingerprint 和去重
- retention 保留策略
- URL 协议过滤与 HTML 安全处理
- 搜索分词、排序和过滤
- entitlement 验签与过期逻辑
- 同步合并算法

### 9.2 Chrome API 集成测试

- 多窗口捕获与恢复
- pinned 标签顺序
- 原生标签组名称、颜色、折叠状态
- 重复 URL 跳过策略
- 特殊页面和权限失败
- service worker 重启后的恢复 job
- 连续事件 debounce 只生成预期快照

### 9.3 E2E

关键旅程：

1. 安装 → onboarding → 收纳 → 撤销。
2. 自动快照 → 关闭窗口 → 新窗口恢复。
3. 创建空间 → 添加标签 → 搜索 → 打开缺失标签。
4. 导出 → 清空测试 profile → 导入 → 数据一致。
5. Free 达到限制 → 购买模拟 → 立即解锁。
6. 恢复部分失败 → 查看报告 → 重试成功。

### 9.4 非功能测试

- 100、1,000、10,000 条历史资产下的首屏与搜索性能。
- 快照连续运行 7 天的存储增长和写入次数。
- 损坏 IndexedDB、配额不足、断电式中止写入。
- 键盘可达、焦点顺序、屏幕阅读器标签、对比度。
- 中英文长文本和窄屏布局。

## 10. 里程碑与工作量

以下为 1 名熟悉 Chrome Extension 的工程师估算，包含开发与基础测试，不含商店审核等待时间。

### M0：工程化与安全基线（1.5–2 周）

- 建立模块、构建和测试框架
- 安全渲染和 URL 校验
- storage schema、迁移器、导入校验
- 基础 CI：lint、unit、build、package

交付门槛：现有功能无回归，所有外部文本走安全边界。

### M1：撤销与回收站（1.5–2 周）

- Operation/Trash repository
- 统一关闭服务
- 撤销 toast、操作历史和回收站 UI
- 关闭/删除故障注入测试

覆盖：PRD-101、PRD-102、PRD-103、PRD-104。

### M2：完整会话与自动快照（3–4 周）

- Session 捕获与 IndexedDB
- service worker 事件合并和 alarms
- 恢复任务、冲突策略、失败报告
- 历史时间线、预览和容量管理

覆盖：PRD-201、PRD-202、PRD-203。

### M3：工作空间（2.5–3.5 周）

- Workspace repository 和视图
- 添加、打开、排序、多选与拖拽
- 规则建议和基础模板

覆盖：PRD-301 至 PRD-304。

### M4：搜索、命令与自动化（2–3 周）

- 本地搜索索引与全局 UI
- 命令面板、快捷键、omnibox
- 清理建议、白名单和规则预览

覆盖：PRD-401 至 PRD-403。

### M5：Pro 商业化（2–3 周，含轻量服务端）

- 定价页、结账、webhook、entitlement
- 扩展登录/兑换与离线验签
- feature gates、退款/降级、隐私和条款页面
- beta 发布与漏斗指标

### M6：加密同步（5–8 周，验证后启动）

- 密钥、恢复码与设备管理
- 加密同步协议、outbox、冲突与删除
- 服务端 blob、限流、账户删除
- 安全评审、双设备与离线测试

覆盖：PRD-501 至 PRD-503。

本地 Pro 可在 M5 后发布，预计单人 13–18 周；Sync 不应阻塞首次收费。

## 11. 任务拆分与依赖

```text
M0 安全/模块/迁移
 ├─ M1 操作日志/撤销
 │   └─ M2 会话捕获/恢复/快照
 │       ├─ M3 工作空间
 │       │   └─ M4 搜索/规则
 │       └─ M5 Pro 授权与支付
 └─────────────────────── M6 加密同步（商业验证后）
```

M2 是产品和技术的关键路径。M3/M4 可以在 M2 数据模型稳定后并行，但单人开发建议串行以降低集成风险。

### 11.1 PRD 追踪矩阵

| PRD | 核心模块 | 里程碑 | 主要验收测试 |
|---|---|---|---|
| PRD-101 统一撤销 | operation、undo、restore | M1 | 单页/域名/全量关闭后撤销，多窗口保真 |
| PRD-102 回收站 | trash、retention | M1 | 恢复、永久删除、到期清理 |
| PRD-103 数据安全与迁移 | sanitize、schema、migrations | M0 | 恶意标题、畸形导入、迁移中断 |
| PRD-104 首次使用与权限解释 | onboarding、settings UI | M1 | 首装、首次危险操作预览、权限文案 |
| PRD-201 完整会话模型 | capture、session repository | M2 | 窗口、顺序、pinned、原生标签组捕获 |
| PRD-202 自动快照 | snapshot、background events | M2 | debounce、去重、保留策略、容量不足 |
| PRD-203 恢复冲突处理 | restore job、report | M2 | 三种恢复模式、重复跳过、部分失败重试 |
| PRD-301 工作空间 | workspace repository/view | M3 | CRUD、置顶、排序、打开缺失标签 |
| PRD-302 拖拽与批量操作 | selection、drag/drop | M3 | 多选移动/复制、失败回滚、键盘等价操作 |
| PRD-303 自动归类规则 | rule engine | M3 | pattern 命中、白名单、建议/自动模式 |
| PRD-304 空间模板 | template service | M3 | 保存模板、隐私 URL 选择、实例化 |
| PRD-401 全局搜索 | local index、search UI | M4 | 跨来源结果、中文/英文、性能和排序 |
| PRD-402 地址栏与快捷键 | omnibox、commands | M4 | 命令触发、键盘导航、冲突处理 |
| PRD-403 清理建议 | recommendation engine | M4 | 预览、忽略域名、固定标签保护 |
| PRD-501 可选账户与设备 | auth、device service | M6 | 游客可用、设备撤销、离线状态 |
| PRD-502 端到端加密同步 | crypto、key recovery | M6 | 密文验证、错误口令、恢复码演练 |
| PRD-503 同步范围 | sync、outbox、merge | M6 | 双设备冲突、离线重试、删除传播 |

## 12. CI、发布与回滚

### 12.1 每次提交

- 格式与 lint
- 单元测试
- manifest 校验
- 构建并扫描禁止的远程代码/危险协议
- 检查生成包仅包含允许文件

### 12.2 发布渠道

- `dev`：本地 unpacked，允许诊断日志
- `beta`：小比例可信用户，独立扩展 ID 或商店测试渠道
- `stable`：分阶段发布，先 5%，观察 48 小时再扩大

### 12.3 数据回滚原则

- 代码可回滚，schema 不做破坏性降级。
- 新 schema 写入后旧版本仍能读取最小兼容视图，或阻止自动降级。
- 发布前保留迁移备份；出现错误时切回旧读取路径。
- 不使用卸载重装作为故障解决方案。

## 13. 可观测性

定义不含敏感内容的事件：

- `snapshot_created`：type、tab_count_bucket、duration_ms、result
- `restore_started/completed`：mode、count bucket、error_code
- `undo_used`：operation_kind、age_bucket
- `search_completed`：source filters、result bucket、action type
- `paywall_viewed/purchase_completed`：feature、plan，不记录浏览内容

本地错误日志采用环形缓冲并允许用户主动导出；默认不上传 URL 和标题。

## 14. 开发验收清单

每个 PRD 完成必须满足：

- 产品验收标准有对应测试用例。
- 新数据字段有 schema、迁移、导出和删除策略。
- 失败、刷新、service worker 重启路径已验证。
- 中英文文案齐全。
- 键盘与无障碍基本可用。
- 不新增不必要权限或远程代码。
- 不记录 URL、标题、搜索词等敏感内容。
- 文档和变更日志同步更新。

## 15. 首个开发迭代建议

首个两周迭代只做 M0 的可验证切片：

1. 建立测试/打包脚本和基础 CI。
2. 抽出 `tabs-api`、storage repository、ID 和 sanitizer。
3. 为现有 `deferred/tabGroups/shortcuts` 建立 v2 schema 与非破坏迁移。
4. 替换所有外部文本的直接 `innerHTML` 拼接。
5. 为关闭域名实现“先记录、再关闭、30 秒撤销”的纵向闭环。
6. 用多窗口、重复 URL、恶意标题和 API 部分失败做验收。

该切片完成后，团队将同时拥有更安全的发布基线和后续快照/恢复所需的核心骨架。
