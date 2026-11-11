# 固定底栏核心实现

状态：核心实现和开发者自测完成；真实 Chrome 交互、布局及独立验收由主会话继续。按 task.md 冻结标准执行，未改变需求。

## 变更

- `extension/index.html`：三视图保留原 DOM 和控制器，包在唯一 `main#dashboardContent` 内；共享 `footer#dashboardFooter` 与顶部导航分别处于内容容器之外。main 可通过键盘获得焦点，其可访问名称跟随当前视图。
- `extension/src/ui/dashboard-navigation.css`：视窗高度壳层使用三行 grid（导航 / minmax(0,1fr) 内容 / 底栏），提供 100vh 回退和 100dvh；body 不滚动，内容与快捷方式侧栏各自滚动。底栏正常占一行，去除旧外边距及位移动画，支持安全区域底部间距、多语言和窄屏自然换行，内容不会伸到底栏后方。
- 保存待办和收纳组两列改为自然流，随主内容一起滚动；取消旧按整个 100vh 计算的 sticky/内层高度限制，避免嵌套滚动和底部内容被裁切。内容保留底部留白与滚动条占位，顶部滚动偏移改为 8px（导航已经在内容容器外）。
- `extension/src/ui/dashboard-navigation.js`：记录和恢复 content.scrollLeft/scrollTop，在隐藏旧视图前记录位置；重复点击不重置，新页面默认标签页顶部。导航不调用 window.scrollTo、不把 window.scrollY 当滚动源。
- `extension/app.js`：切换语言保存、恢复真实内容容器位置；不重建控制器、不写业务数据。
- `tests/unit/dashboard-navigation.test.js`：模拟独立滚动宿主，窗口 scrollTo 如被调用立即失败；覆盖初始化、三视图各自位置、内容和选择保留、可访问名称、重复选择及短目的视图 clamp 后返回长视图恢复。

没有修改 `style.css`：新壳层覆盖在既有最后加载的 dashboard-navigation.css 内，保留全局及旧参考样式。所有已有 dirty 改动保留，未修改 57 个保护文件、权限、后台、词典或数据仓库。不提交、推送或发布。

## 开发者验证

环境：`/Users/tinggengyan/.nvm/versions/node/v24.15.0/bin/node`。

- 导航、语言、UI contract 相关 27 项测试通过。
- `node --test`：**290/290 通过**（基线 289，新增短视图位置恢复测试）；原始证据 `evidence/core-tests.log`。
- `node tools/check-javascript.mjs`：**54 个模块通过**；原始证据 `evidence/core-syntax.log`。
- `git diff --check`：通过。
- 与 `evidence/protected-files.json` 对照，**57 项哈希全部不变**。

## 验证边界

Node 测试不证明 CSS 实际几何、滚轮命中或窄屏布局。主会话负责将旧 Chrome 的 window 滚动断言迁移到真实内容宿主，保留实际至少 400px 及位置恢复标准，并验证底栏固定、末尾操作可用、语言切换、键盘和原有流程回归。此报告不把代码修改当作浏览器验收完成。

## Chrome 发现的语言滚动回归修复

主会话真实 Chrome 检查发现语言切换后的滚动位置不一致。首次失败日志未记录切换后的数值；后续带数值复验测得英文 460→464、中文 460→463，并未证实实测发生夹零。代码调查另发现列表清空/重建可能暂时减少高度、原导航初始化等待语言读取可能延后监听注册；这些边界由单元测试模拟验证，不能把模拟夹零写成浏览器实测。

修复保持在原文件边界：导航壳层同步创建并在后续控制器前注册语言监听，首次文字本地化仍等待语言 ready。最早监听捕获真实内容位置，app 完成自己的重绘后调用 `restoreLanguageScroll()` 消费一次快照。切换视图或用户在内容区滚轮、触碰、滚动键输入会作废待恢复快照，避免后到的异步恢复覆盖用户新位置。没有修改受保护的 i18n、记忆 UI 或其他业务文件，也没有延迟魔数或 window 滚动补丁。

新增三项测试：后注册监听模拟清空长列表导致真实宿主高度夹零，再重建后恢复 460px；切视图/用户滚动动作使快照失效；语言读取尚未完成时壳层就已注册捕获，首次文字仍在 ready 后翻译。

修复后相关 30 项通过，全量 **293/293**（`evidence/core-tests-scroll-fix.log`）、**54 模块语法**（`evidence/core-syntax-scroll-fix.log`）、diff 检查通过，57 个保护文件哈希不变。Chrome 复验由主会话执行。

主会话带数值复验发现英文 460→464、中文 460→463，超过原 ≤2px 标准。内容滚动已由应用显式管理，因此仅对 `.dashboard-content` 增加 `overflow-anchor:none`，禁止浏览器在 DOM 重绘后的锚点算法再次调整位置；不使用定时恢复或放宽断言。此 CSS 补充后 diff 检查和保护文件复核通过，JavaScript 未再修改。主会话最终 Chrome 复验英文/中文均为 **460→460**，完整日志与集成结论见 implementation.md。
