# 项目工作台实现与验证报告

日期：2026-11-01。版本：Tab Out 2.2.0。需求、视觉与架构分别见 requirements.md、design.md、development-plan.md；独立验收结论见 acceptance.md。

## 交付行为

- 同窗口多个项目：默认零选，支持跨域名选择和筛选后批量选择；更新旧项目时仅匹配已保存成员。
- 真实保存/收起/恢复/切换服务：持久化先于关闭，默认只补缺失，目标失败保留来源；保护固定页、共享目标页、未选页和其他窗口。
- 原窗口与原生组 Undo；同一撤销的并发调用共用恢复过程；部分失败只重试失败页面/组/元数据。
- 首页项目区、应用内预览、三种结果状态、失败重试、备份说明和最近发起导出时间，中英文齐全。
- 修复过期布局使用、窗口创建失败误落当前窗、部分 Undo 消耗来源数据、恢复位置异步预览、结果焦点及窄屏布局问题。
- 沿用旧工作区与完整备份，新 session 信息可通过实际下载的备份导回。

## 文件与兼容

后端：project-service、Chrome session adapter、operation service、workspace repository、backup service、manifest 及对应测试。UI：app、index、i18n、新 project-workbench 模块/样式和 UI 测试。工具：隔离 Chrome 启动器、真实鼠标/键盘客户端、新项目旅程。README、使用指南、版本、Node 要求和 ZIP 同步更新，ZIP 保留 MIT 许可。

没有换框架或新增运行时依赖。根 AGENTS.md/CLAUDE.md 未改写；基线已有 Undo 点击和自动刷新修复保留。没有提交、推送、上架、生产付款配置或操作用户日常标签。

## 新鲜验证结果

| 验证 | 结果与原始证据 |
| --- | --- |
| Node 24.15.0 全套 | **213 通过，0 失败**；`evidence/final-node-tests.log` |
| 扩展/服务/工具全部 JS 语法 | 全部通过；逐文件退出码见 `evidence/final-syntax.json` |
| Manifest/版本/差异检查 | manifest 与 package 均 2.2.0，已声明 tabGroups，`git diff --check` 通过 |
| 原有真实浏览器回归 | Chrome for Testing 151，10 条旅程通过；`evidence/final/regression/result.log` |
| 新项目真实浏览器 | 15 项旅程标签全部通过；`evidence/final-projects/projects/result.log`、`result.json` |
| 实际备份下载/导回 | 使用新 UI 按钮生成可解析文件并导回；`evidence/final-projects/projects/downloads/tab-out.config` |
| 打包完整性 | `npm run package`、`unzip -t` 通过；`evidence/final-package.log` |

权威验证清单及逐源文件 SHA-256：`evidence/verification.json`。最终项目旅程在最后一次“共享页关闭数量”显示修正后重跑；旧回归在该纯项目预览展示修正前通过，未因不相关显示修正重复运行。Node 全套、所有 JS 语法和 ZIP 为最后源码状态。

实际包：`dist/tab-out-2.2.0-store.zip`。SHA-256：`34a8e40ca108df9ae6d2bdbceb081cc95dd5dd9102d39c37000db97146292484`。

## 真实浏览器覆盖细节

独立临时配置中创建混合 Atlas/Beacon/Orion 页面、固定页、共享页和另一个窗口。实际鼠标操作完成选择、保存、收起、撤销、继续及切换。故意让目标第二页创建失败后，来源保持打开，重试只补失败页；备份导回及重载保留项目。

额外检查：同一原生组 A/B/C 只收起 A/C 后，撤销保持完整窗口网址顺序且重新加入幸存组；并发撤销不重复打开。结果页验证初始可见焦点、Tab/Shift+Tab 循环及关闭后的焦点返回；恢复位置预览等待期间禁止提交旧位置。

界面检查 1440、768、390px；新项目旅程最后一轮使用中文语言偏好，旧旅程保留英文。实际截图与视觉核验见 visual-review.md。

## 独立审查与修复

审查由未参与实现的独立 Tech Lead 依据冻结 AC-01..AC-13 执行。发现的恢复位置等待、撤销互斥、结果焦点问题均有先失败后通过的行为测试；最终截图进一步发现共享页预览数量未扣除，修正后新增真实浏览器断言并重跑受影响套件。未降低关闭安全或失败保护标准。

## 已知边界

当前仍是本地 Chrome 扩展，沿用既有免费项目额度和高级功能授权规则；未配置生产支付、云同步或公开商店发布。恢复网址和支持的标签元数据，不恢复未保存表单或网页内存。互斥保证同一服务实例，不宣称跨所有扩展页面的数据库事务隔离。本轮实测平台为本机 macOS + Chrome for Testing 151，未声称 Windows/Linux 与用户真实浏览器配置已实测。

## 使用入口

已有本地安装：在 `chrome://extensions` 重新加载 Tab Out，然后刷新新标签页。不要卸载或清空存储。详细步骤见 `docs/PROJECT_WORKBENCH_GUIDE.md`。
