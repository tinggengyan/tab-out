# 打开与已保存：UI实现记录

状态：根真实Chrome首轮联调后修正已完成，源码再次冻结，等待根最终复核及独立验收。本记录仅声明Developer实际运行的检查。

## 实际变更

- `extension/index.html`、`app.js`：移除顶部三个项目快捷按钮及卡片重复保存按钮。选择后出现统一保存操作栏，支持跨卡片选择；更多菜单负责选择本组、选择全部可保存页面及批量关闭。不可保存网页选择按钮禁用，不进入保存数量。选择集合在重绘后仍保留，并剪除已关闭页面。
- `src/ui/project-workbench.js`：保存入口不提前切换到项目视图，弹窗仍在三视图之外。记录来源视图、内容滚动及触发按钮，取消和完成回来源；主动“查看已保存”才导航并进入详情。保留原保存/收起/继续/切换、结果重试和撤销接线。
- 保存目标已有ID默认append。改变目标保留刚选的新页面；仅显式replace或高级switch来源选择预选已开成员。替换显示新增/保留/移除的完整列表及数量。将数据层新API接入控制器；刷新预览保留操作模式。
- 已保存卡片名称可进入详情，显示完整页面列表；单页打开优先激活已有页面，缺失时才新开，不关闭其他页面。卡片只保留主要补开操作，管理放进原生details更多菜单。详情支持添加打开页面、显式替换、移出保存项；移出前确认不关闭网页，最后一页引导回列表删除整个分组。
- `i18n.js`、`locales/{zh-TW,ja}.js`同步四语，导航为打开的标签页／已保存／浏览记忆。保留现有项目及数据ID，不引入新的保存类型。
- `dashboard-navigation.css`、`project-workbench.css`沿用纸色、绿色、卡片和固定底栏；缩小保存区宣传标题，新增统一选择栏、详情及次级菜单样式，窄屏允许换行。

## 公开给根的选择器

- 选择栏：`#tabsSelectionToolbar`、`#tabsSelectionSummary`、`#tabsSelectionSaveBtn`、`#tabsSelectionClearBtn`。
- 卡片更多：`details.tabs-card-menu > summary`，选择本组`data-action=select-domain-tabs`。
- 页更多：`#tabsBulkMenu > summary`，`data-action=select-all-saveable`选择所有非隐身可保存页面；`close-all-open-tabs`批量关闭。旧collect按钮已实际移除，测试应通过选择→统一保存→预览收起。
- 已保存名称：`[data-project-action=detail][data-project-id]`；更多`details.project-card-menu > summary`，保留rename/delete/switch/update，update现在为安全追加，replace独立。
- 详情：`#projectDetail`、`#projectDetailBackBtn`、`#projectDetailAddBtn`、`#projectDetailReplaceBtn`、`#projectDetailResumeBtn`、`#projectDetailMore`。
- 链接动作：`[data-detail-action=open/remove][data-entry-url]`；替换影响：`#projectUpdateImpact`下`[data-impact-kind=added/retained/removed]`。

## Developer验证

使用Node24.15.0：`/Users/tinggengyan/.nvm/versions/node/v24.15.0/bin/node`。

- `node --test`：369/369 PASS，0失败/跳过；原始日志`evidence/ui-node.log`。其中包含并行数据实现的测试，但其实现报告由数据Developer单独提供。
- `node tools/check-javascript.mjs`：61模块PASS；`evidence/ui-syntax.log`。
- `git diff --check`：exit0。
- 新增控制器测试：向已有分组添加保留当前选择并传递append；显式replace只预选原成员且刷新后保持replace模式与用户选择。
- `dashboard-refresh.test.js`为真实新增依赖补齐harness，不降低既有恢复页刷新断言。

首轮全量测试的3个失败保留于`evidence/ui-node-first.log`：旧dashboard harness缺少新依赖2项，翻译扫描将动态字符串前缀误认为完整key1项。已补齐harness并改用完整key映射，最终全部通过。

## 边界

未改服务/存储、权限、模型配置、AGENTS/CLAUDE、tools或发布操作。未运行真实浏览器、未操作个人Chrome；浏览器走查、打包和独立验收由根执行，不能将本记录当作已通过完整验收。

## 首轮联调修正与最终自检

根首轮Chrome主故事通过后提供了视觉与回归发现，已修正：

- 详情状态保存翻译key，语言切换重新翻译成功/错误说明。
- 全部已开时四语显示“已全部打开”，保留进入安全预览能力。
- 导航模块通过ResizeObserver跟随固定底栏高度，toast位于底栏上方12px，避免窄屏翻译换行后遮住工具。销毁导航时清理observer及resize监听。
- 焦点可见性增加getClientRects及关闭的details检查；从菜单发起的动作关闭后可回到原summary或重绘后的同卡summary，避免落入隐藏按钮。
- 跨窗口显式replace只自动预选当前窗口的原成员；其他窗口同URL副本仍列候选，不自动认为属于本次来源。
- begin基于展示的workspaces冻结目标版本，之后选择变化不会自动接受另一个文档已更新的目标版本。只有显式刷新预览才更新内容及版本；避免替换影响展示旧内容而提交新版本。
- 替换清单在外层有最大高度、可滚动的对话框内，提交按钮位于清单后方，无额外内层裁切。

新增2个控制器回归：第二文档修改目标后选择变化保持原版本、显式刷新才更新；跨窗口替换不自动预选其他窗口同URL。

最终命令：`node --test`，371/371 PASS，0失败/跳过（`evidence/ui-node-final.log`）；`node tools/check-javascript.mjs`，61模块PASS（`evidence/ui-syntax-final.log`）；`git diff --check` exit0。浏览器最终结果由根记录，不在这里冒称Developer已执行。

## 更多菜单的键盘收敛

按根追加的冻结验收要求，新增本轮四类更多菜单Escape关闭和返回自身summary的行为。优先关闭当前焦点所在菜单，否则只关闭可见的展开菜单；弹窗焦点、输入法组合键与其他按键不介入，不改变原overlay Escape。未增加详情页Escape返回，避免和弹窗处理冲突。

针对性真实函数测试3/3 PASS，见`evidence/ui-menu-escape.log`；语法61模块PASS，见`evidence/ui-syntax-menu.log`。本次仅改app.js、新增saved-menu-escape.test.js及本报告，其他实现保持冻结。根负责最终集成Node和Chrome复核。

## 后台重绘保留更多菜单

根迁移Chrome回归发现重命名后的异步刷新可能关闭刚打开的更多菜单。已在保存列表实际替换DOM之前捕获展开菜单对应的项目ID，在重绘后按ID恢复open状态。捕获位于异步数据读取之后，能包含等待读取时用户刚打开的菜单；用户主动关闭后不会从过时快照重新打开。正常、存储事件及四语刷新共用该路径。

同轮最终审查同时补齐菜单内焦点保存：捕获projectId及summary/action，重绘后恢复同一动作，不存在则summary。仅在实际焦点位于展开菜单内时恢复，不干扰弹窗或列表外焦点。

另补齐保存并收起全部所选后选择栏消失的边界：优先恢复原保存按钮；该按钮已隐藏时，回到可见“打开的标签页”导航，最后可退到内容区域，避免焦点留在隐藏弹窗或body。

新增有意义回归覆盖DOM身份及顺序改变、删除/新建分组、保留展开与尊重主动关闭、动作焦点恢复与summary后备、选择栏消失时返回可见导航。`node --test tests/unit/project-workbench-ui.test.js` 32/32 PASS（`evidence/ui-menu-refresh.log`）；语法61模块PASS（`evidence/ui-syntax-menu-refresh.log`）。仅改project-workbench.js、对应UI测试及本报告，其他源码保持冻结，真实Chrome复核由根继续。
