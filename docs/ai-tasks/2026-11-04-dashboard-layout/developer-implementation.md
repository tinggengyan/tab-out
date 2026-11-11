# UI Developer 实施记录

状态：UI实现、自测完成；真实Chrome与最终独立验收待集成执行者执行。日期2026-11-04。按已冻结task.md实施，不改验收标准。

## 本次变更

| 文件 | 实际变更 |
| --- | --- |
| extension/index.html | 新增紧凑同页导航，普通button搭配aria-controls和唯一aria-current；三个固定ID视图包装原有DOM。标签页默认可见，项目／浏览记忆在HTML即hidden。重复Tab Out提示在标签页包装内，页脚在三视图之外。新增CSS和导航脚本；导航脚本在i18n之后、业务控制器之前加载。 |
| extension/i18n.js | 中英文各新增首页视图、标签页、项目、浏览记忆四个键，保留所有原键。 |
| extension/style.css | 仅将主栏min-width:600px改为0，防止双收纳栏同时显示时撑宽。 |
| extension/src/ui/dashboard-navigation.js | 新增独立导航模块，不调用服务或存储，不创建路由；切换只修改hidden/aria-current、保存并恢复各视图scrollX/scrollY、聚焦可见导航且preventScroll。新文档始终标签页顶端，禁用浏览器自动恢复旧视图scrollY。 |
| extension/src/ui/dashboard-navigation.css | sticky导航、活动态与焦点可见样式；三栏主区缩放、长文本换行、中等屏幕换行、390px导航、footer换行和移动端收纳卡保护。非当前视图不占布局。 |
| extension/src/ui/project-workbench.js | 项目异步预览完成时若原视图已hidden则不打开弹窗；可见焦点助手跳过hidden祖先并使用preventScroll。原modal、Escape与业务流程保留。 |
| extension/src/ui/browsing-memory.js | 异步操作完成、导入预览和确认框关闭仅对可见控件恢复焦点，使用preventScroll，防止用户已离开视图时抢焦。原生dialog保留。 |
| tests/unit/dashboard-navigation.test.js | 5项行为测试：新文档默认页／滚动／本地化；按钮切换与节点状态保留；三视图独立滚动与焦点；重复／无效切换；销毁监听和不完整宿主。 |
| tests/unit/project-workbench-ui.test.js | 新增隐藏祖先焦点保护和preventScroll行为测试。 |

## 公开合同

DOM ID：dashboardNavTabs／dashboardNavProjects／dashboardNavMemory；dashboardTabsView／dashboardProjectsView／dashboardMemoryView。原memoryWorkbench、projectWorkbench及各业务节点ID保留。

浏览器全局：`tabOutDashboardNavigation`，API为`currentView`只读属性、`show('tabs'|'projects'|'memory')`、`destroy()`。构造器`TabOutCore.createDashboardNavigation`可注入document/window/translate进行独立测试。真实交互应点击导航按钮；API不代替交互验收。

切换没有重新构建或初始化业务控制器，没有自动搜索、权限申请或内容发送同意，没有导航状态持久化。

## 已执行验证

执行环境：项目根目录；Node为`/Users/tinggengyan/.nvm/versions/node/v24.15.0/bin/node`。

1. `node --test tests/unit/dashboard-navigation.test.js tests/unit/project-workbench-ui.test.js tests/unit/browsing-memory-ui.test.js tests/integration/ui-contract.test.js`：50/50通过，包含中英文键一致性、原UI节点唯一性及原记忆权限手势／拒绝测试。
2. `node --test`：271/271通过（原基线265，加本次6项），无跳过和失败。
3. `node tools/check-javascript.mjs`：51个JavaScript模块语法通过。
4. `git diff --check`：通过，无空白错误。

以上命令均实际使用上述绝对路径Node执行。未提交、推送或发布；未更改AGENTS/CLAUDE、manifest、package版本、后端、服务或存储。保留进入本任务时已有未提交修改，git diff相对HEAD含历史工作，不能把其全部归为本次修改。

## 尚未验证与边界

未自行运行真实Chrome旅程，因为tools及集成验证由主会话独占。桌面首卡top与已收纳首项、带重复提示场景、390px全部视图scrollWidth、真实坐标点击后的scrollY±2、隐藏异步完成、modal焦点闭环和原三类旅程均等待主会话集成证据。Node假DOM测试只能证明导航行为调用，不证明真实CSS布局、滚动和原生权限弹窗通过。

无设计偏差。若Chrome发现浏览器滚动锚定或具体数据引起的溢出，仍需按冻结标准修复，不能降低标准。

## 首次UI修复：原生记忆确认框焦点闭环

集成者报告的真实Chrome EN/ZH证据（evidence/layout-en/layout/result.log、layout-zh/layout/result.log）显示：首屏和三视图滚动状态均通过，记忆删除确认框中Shift+Tab后activeElement.id为空，AC6未通过。原代码keydown仅stopPropagation，没有首尾Tab循环；此外offsetParent不是原生top-layer dialog可见性的充分判断。不能将原生dialog自带的页面inert当作浏览器工具栏焦点闭环。

本轮只修改extension/src/ui/browsing-memory.js和tests/unit/browsing-memory-ui.test.js。确认框显式处理首／末控件的Tab与Shift+Tab，焦点缺失时重入；Escape不preventDefault，继续由原生cancel事件和原关闭逻辑处理。可见性改由getClientRects与hidden祖先、isConnected、disabled共同判断，所有显式focus保留preventScroll，showModal后显式聚焦No。

新增3项测试先运行看到3项失败，再完成实现：原生dialog中offsetParent=null仍可聚焦；No／Yes双向Tab边界循环；无焦点时重入且Escape保留原生cancel。实现后定向53/53通过；语法51模块通过；git diff --check通过。全量274/274通过（本轮新增3项），无跳过或失败；Chrome复验交集成执行者。没有修改tools或冻结标准。

## 第二轮UI修复：命令搜索关闭后的可见焦点

集成者新增真实Chrome证据layout-en-verified/layout/result.log及layout-complete-check/layout/result.log确认：原生记忆确认框初始No焦点、Tab／ShiftTab循环和Escape返回删除按钮已通过；三视图重载、资产正文／设置保持、三种收纳数据组合、全部目标视口无横向溢出及重复提示首卡高度也通过。唯一剩余为从导航CtrlK打开命令搜索再Escape关闭后焦点仍在隐藏commandOverlay。

根因是openCommandPalette同步执行input.focus，MutationObserver稍后才读取activeElement，于是把内部输入框误记为_returnFocus。经主会话明确扩大授权，本轮仅修改app.js中命令搜索打开和modalFocusObserver的焦点相关行：显示前保存外部触发点；observer只在当前焦点属于弹窗外时记录；关闭只恢复仍连接、未disabled、无hidden祖先且有实际矩形的外部控件；所有显式focus使用preventScroll；排队的首次focus在弹窗已关闭时不再执行。搜索、存储及其他业务逻辑不变，没有重构弹窗。

新增tests/unit/command-focus.test.js三项行为测试覆盖三个导航外部触发点、已断开／隐藏触发点以及快速关闭后的排队focus；先实际复现2项失败，再修改实现。既有tests/unit/free-command-palette.test.js假DOM补原生contains方法，未改变预期。修复后定向59/59、51模块语法、git diff --check通过；全量277/277通过，无跳过和失败；Chrome最终复验交集成执行者。未改tools或冻结标准。
