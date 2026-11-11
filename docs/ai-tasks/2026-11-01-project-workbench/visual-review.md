# 项目工作台视觉核验

核验对象：真实扩展 2.2.0，新项目流程。视觉依据为现有代码中的暖白/墨色/绿色系统和本轮 design.md，未另起无关界面或使用生成图片替代实际实现。

## 接受的最终截图

| 步骤 | 实际截图 | 观察与状态 |
| --- | --- | --- |
| 1. 空项目入口 | [空状态](evidence/final-projects/projects/01-empty-workbench.png) | 保存入口、当前窗口说明和备份边界可见；通过 |
| 2. 跨网站选择 | [选择预览](evidence/final-projects/projects/02-selected-project-preview.png) | 名称、成员勾选、固定页保留和仅保存/收起动作分离；通过 |
| 3. 来源与目标切换 | [切换预览](evidence/final-projects/projects/06-switch-preview.png) | 来源 Atlas、目标 Beacon、缺失/复用及真实收起数清楚；目标共享页标记保留；通过 |
| 4. 失败处理 | [部分失败](evidence/final-projects/projects/08-partial-failure.png) | 暖色结果、来源保持打开说明、可理解原因与重试入口；通过 |
| 5. 桌面工作台 | [1440px](evidence/final-projects/projects/09-workbench-desktop.png) | 核心项目入口位于原标签区上部，保留旧功能；通过 |
| 6. 窄窗口 | [768px](evidence/final-projects/projects/10-workbench-768.png)、[390px](evidence/final-projects/projects/11-workbench-390.png) | 项目卡及操作自然换行，无横向溢出；通过 |

截图由真实 Chrome for Testing 页面捕获并逐张查看，使用的是一次性测试网页。候选长列表可内部滚动，确认范围与动作保持独立显示。

## 交互检查

实际鼠标命中测试避免了脚本 `.click()` 绕过样式限制。新建项目默认零选，筛选后批量选择只加入可见且可保存的候选；有明确完成、部分失败和失败状态。恢复位置正在重算时禁止提交旧预览；结果按钮在操作完成后获得可见焦点，Tab/Shift+Tab 不离开对话框，关闭后能返回已重画的项目按钮。

原生组部分撤销顺序、共享页/固定页保留、失败不收起来源、真实导出和备份导回均有浏览器行为断言。界面颜色并非唯一状态提示。

## 限制与结论

视觉和已列键盘操作检查通过，不等同完整无障碍认证或所有屏幕尺寸覆盖。系统/浏览器主题和操作系统字体可能有细微差异；本轮没有以外部设计图的逐像素一致性作为目标。

结论：所列视口和流程通过，核心操作可读且可实际执行。
