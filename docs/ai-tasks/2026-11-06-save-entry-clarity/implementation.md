# 保存入口收敛：Developer实现记录

状态：最小源码已完成并冻结。Developer自检通过；根已完成L1复核、真实Chrome入口/四语言/项目回归及独立试用包，最终结论见acceptance.md。以下区分Developer与根实际执行范围。

## 实际变更

- `extension/index.html`：项目页header只保留`#projectSaveBtn`，改为quiet次级样式；实际移除`#projectParkBtn`，没有隐藏残留。
- `extension/src/ui/project-workbench.js`：`projectSaveBtn`本地化改用新key `project.createFromTabs`，移除park按钮的本地化和事件绑定。原`begin('save')`流程与焦点回到`projectSaveBtn`保持；controller及标签页调用`begin('park')`仍可用。
- `extension/i18n.js`和`extension/locales/{zh-TW,ja}.js`：新key四语分别为Create from current tabs／从当前标签页创建项目／從目前分頁建立專案／開いているタブから作成。卡片`workspaces.saveGroup`改为明确“本组到项目”的四语，`workspaces.saveSelected`保留已有明确的所选范围文案。

标签页顶部主保存/收起入口和上一轮两级样式均未改变。没有修改app、CSS、业务服务、存储、权限或模型代码，也没有新保存分支。全部extension/tests中已无`projectParkBtn`引用；根拥有的tools旧引用由根适配。

## 验证与证据

Node：`/Users/tinggengyan/.nvm/versions/node/v24.15.0/bin/node`。

- `node --test`：355/355 PASS，0失败/跳过；evidence/dev-node.log。
- `node tools/check-javascript.mjs`：60模块PASS；evidence/dev-syntax.log。
- `git diff --check`：exit0；evidence/dev-diff-check.log。
- 基线逐字节对比只有上述5个UI/locale文件变化，其余扩展文件保持原字节；完整本轮局部diff见evidence/dev-scope.log。

现有测试无需改写，未增加镜像文案测试。真实Chrome检查、指南更新及打包由根执行，未由本Developer运行或冒称通过。未动10个旧ZIP、AGENTS/CLAUDE、真实用户Chrome，未提交/推送/发布。

## 给根的接口信息

- 唯一项目页次级入口保留`#projectSaveBtn`，显示`t('project.createFromTabs')`，仍打开安全保存预览。
- `#projectParkBtn`已不存在；需要收起的E2E应从`#tabsParkBtn`进入，或在同一保存预览使用原`#projectExecuteBtn`。
- 卡片本组/所选仍使用原data-action与真实tab ID范围，只有本组按钮文案更明确。

## 视觉核对后的空态文案修正

根已完成首轮入口、四语宽度及项目15旅程Chrome检查，发现空态仍引用旧“保存项目”按钮。已仅修改`project.emptyText`四语，指引“从当前标签页创建项目→在预览中选择页面→名称可留空”，不再引用已移除的同名入口。

修正后重新执行Node355/355、syntax60及diff-check exit0；原始日志为evidence/dev-final-node.log、dev-final-syntax.log、dev-final-diff-check.log。最终仍仅5个UI/locale文件变化，dev-scope.log更新为最终源差异，先前局部差异保存在dev-scope-before-empty-copy.log。源码再次冻结；受影响最终Chrome复核由根继续，不冒称本Developer已执行。

## 根最终复核

最终入口和语言套件已在空态修正后通过；项目15条旅程在此前行为冻结版本通过。根检查实际选中ID、取消无写入/关页、焦点返回、四语三宽度与固定底栏；人工查看最终截图。5项验收均通过，另生成save-entry-clarity试用ZIP并验证62文件与源码相同、10个旧ZIP不变。详见acceptance.md及evidence/package-verification.json。
