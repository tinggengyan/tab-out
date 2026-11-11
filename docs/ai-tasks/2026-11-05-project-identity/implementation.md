# 恢复 Project：实现与集成记录

依据冻结task和[产品共识](product-agreement.md)，产品经理评审与根一致后开发。详细UI文件、行为及自测见[Developer记录](ui-implementation.md)。本记录不替代独立验收。

## 结果

顶栏恢复“标签页 / 项目 / 浏览记忆”，首页快捷入口及四语言创建/保存到/继续/搜索项目来源同步恢复项目语义。项目主列表、数量和空态仅来自workspace；临时收纳和稍后查看分别在下方默认折叠，标题与各自数量可见，稍后数量明确包含归档。无项目时即使有临时记录仍显示项目空态；展开状态在刷新中保留。

原存储、名称、免命名生成、预览/固定页保护/撤销、继续/切换及安全重试都保留。没有自动转换、迁移或清空记录。浏览记忆保存所选实际生成项目，因此只同步其文案，未改行为。泛指跨类型的“已保存”仍保留，不机械替换。

## 实际验证

环境：Node24.15.0、Chrome for Testing151.0.7922.77。Chrome工具使用临时profile与合成资料。

| 检查 | 结果 | 原始证据 |
| --- | --- | --- |
| 开发前基线 | 325/325 | evidence/baseline-node-tests.log |
| Developer定向单测 | 55/55 | evidence/ui-targeted-tests.log |
| 全量Node | 328/328，新增3项实际refresh行为测试 | evidence/ui-node-tests.log |
| JavaScript语法 | 58模块通过 | evidence/ui-javascript-check.log |
| 差异检查 | 退出0 | evidence/final-diff-check.log |
| 项目与临时记录旅程 | 默认标签页、首页及顶栏项目入口、混合数据计数、零项目/旧记录、键盘Space展开、归档、刷新保留open通过；复杂恢复/过期目标/Free搜索/备份原旅程全保留通过 | evidence/chrome-release/result.json、release/result.log |
| 项目完整旅程 | 显式选页、免关闭保存、固定页保护、原窗口/nativegroup撤销、复用、安全切换、部分失败重试、备份往返与窄屏通过 | evidence/chrome-projects/result.json、projects/result.log |
| 四语言 | en/zh-CN/zh-TW/ja×三视图×三尺寸、明确项目标签/独立计数、底栏、日期、焦点、草稿和语言保存失败恢复通过 | evidence/chrome-i18n/result.json、i18n/measurements.json |
| 布局 | 三视图×1440×900/1366×768/390×844；固定底栏、滚轮/键盘、末尾操作、独立位置/草稿/数据保留通过 | evidence/chrome-layout/result.json、layout/measurements.json |

Root更新Chrome断言时保留了原恢复故障与安全断言。初次有三种工具夹具不适配：用data-project-id统计时把卡片内按钮也计入、原生summary键盘用例未显式置前且未提供字符参数、闭合details后代的几何矩形被误计为可见末尾控件。分别改为只数卡片、置前并确认summary焦点后发送带字符的Space输入、展开实际次级内容后验证末尾控件。没有修改生产代码掩盖检查，也未放宽原首屏/底栏阈值；初始日志保留在evidence/*initial*及layout-closed-details-measurement.log。

## 数据保护与本机界面

128文件基线用于区分既有改动。15项关键文件逐字节不变，包括AGENTS/CLAUDE、manifest、后台、saved-library安全继续helper、恢复adapter、项目/操作服务、仓库、记忆检索/runtime/model client/抽取及记忆UI。既有7个ZIP全部不变。见evidence/package-verification.json和current-source-diff.patch。

通过CUA切到用户已有Tab Out（没有覆盖其另一个页面），重载原扩展并打开项目页。真实界面显示独立0项目空态、临时收纳8、稍后0，两次级区折叠；未创建、恢复、关闭或删除任何真实资产，未调用模型/购买/扩大权限。最后保留项目页供试用。截图在本机独立可视化目录，证据只保存步骤及哈希，不复制私人标题/正文进仓库。

## 产物与边界

dist/tab-out-2.3.0-project-identity.zip：61文件，211918字节。SHA-256 `2d7bfd8c7287be6cfc7775cfa063fc66ee829dc27813e30bc011f83db4c259a6`。每项与冻结源码一致；不覆盖上轮收敛包。

本轮未运行真实模型联调、原生权限弹窗或新增市场调研；没有涉及这些行为变更。此前真实站点覆盖、母语审校、商用配置和跨刷新恢复任务的边界继续保留。不提交、推送、商店上传或对外发布。独立验收另行记录。
