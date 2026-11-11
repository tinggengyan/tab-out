# 多语言支持实现与集成验证

状态：实现、集成验证及独立验收完成，AC1–AC12 全部 PASS（见 acceptance.md）。用户原始需求为“增加多语言支持”，按 task.md 的冻结标准执行。

## 已实现

- 设置 → 语言提供跟随浏览器、English、简体中文、繁體中文、日本語。选择以 interfaceLanguageV1 保存在本地，即时更新页面，不重新加载。
- 统一语言状态、初始化与变化通知；按浏览器偏好顺序、中文脚本和地区自动匹配，回退英文。日期、复数、无障碍名称与搜索平台设置统一语言。
- 四语言各 578 个完整词条，两个新语言使用独立本地脚本，新增对应 Chrome 扩展说明。
- 保留当前视图、查询、结果、勾选、模型摘要、模型地址/密钥/排除项草稿及项目/平台编辑草稿。保存失败保留原语言并提示，可重试。
- 独立审查发现并修复已有项目失败提示、升级状态漏译及结果复选框无障碍键缺失；增加调用端缺词扫描和不重复业务的状态行为测试。
- README / CHANGELOG 已说明语言入口、自动匹配、原文保留及 Chrome 元数据语言边界。新增 npm run e2e:i18n。

## 文件与证据

核心实现见 core-implementation.md；两个新词典的开发验证见 ja-implementation.md、zh-tw-implementation.md。主会话新增 tools/chrome-i18n-e2e.mjs，并为隔离 runner 增加 --i18n-only。

执行环境 Node 24.15.0、Chrome for Testing 151.0.7922.77，使用临时浏览器资料，不访问个人浏览数据。

| 实际检查 | 结果与原始证据 |
| --- | --- |
| node --test | 289/289 通过（基线 277）；evidence/final-node-tests.log |
| node tools/check-javascript.mjs | 54 模块通过；evidence/final-syntax.log |
| git diff --check | 通过 |
| --i18n-only | 通过；evidence/i18n/result.json、i18n/result.log、measurements.json 及截图 |
| 原标签页/搜索/备份/项目回归 | 通过；evidence/regression/result.json 及各子目录 result.log |
| --memory-only | 通过；evidence/memory/result.json、memory/result.log |
| 保护文件 | AGENTS.md、CLAUDE.md、manifest、后台、关键仓库/服务共 8 项哈希不变；evidence/protected-files.json |
| 安装包 | dist/tab-out-2.3.0-multilingual.zip；源文件逐字节一致、LICENSE 完整，evidence/package-verification.json |

Chrome 真实键盘输入使用原生 select 的首字符选择，避开 macOS headless 的系统弹出菜单（CDP 页面通道无法操作该菜单）。验证四语言保存、即时切换、刷新和新开页面；24 组（三视图×两宽度×四语言）布局无横向溢出，桌面首张标签卡仍在首屏。

逐语言检查记忆/历史/收纳组/项目日期、结果复选框可访问名称；模拟语言存储写失败，检查回滚、错误提示与成功重试；模拟导出失败，验证已有提示重译且不重复业务。比较切换前后存储、IndexedDB 导出记录和界面状态，确认用户原文/模型结果/草稿不变，未请求模型或权限。

首轮测试工具曾有 macOS 原生菜单输入不生效及关闭自身调试 tab 导致超时，已修测试交互并完整重跑；最终 result.json 全部通过，不以这些失败记录作为通过证据。

## 验证边界与交付

日语、繁体译文未经母语者审校。手动语言只控制 Tab Out 内部；Chrome 管理页扩展说明由 Chrome 自身语言决定。其他已打开的 Tab Out 页面重新加载后读取选择，本轮不强制跨窗口即时切换。语言偏好暂不进入便携备份。

记忆回归使用可控模型服务和登录模拟站点；原生可选权限提示及用户实际模型服务、真实私有页面仍未实测（延续既有验证边界）。本轮不改变其业务、权限或模型设置。

未修改 AGENTS.md / CLAUDE.md，未提交、推送或发布；旧 store.zip 与 layout-fix.zip 哈希保持原值。安装包沿用 2.3.0，使用独立文件名保留旧包。
