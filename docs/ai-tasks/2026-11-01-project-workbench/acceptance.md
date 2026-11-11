# Tab Out 2.2.0 独立验收

**结论：PASS。** 满足冻结的 AC-01～AC-13，可交付本地安装包。无遗留 FAIL 或 BLOCKED。

验收由未参与实现的独立 Forge Tech Lead 只读执行，依据原始需求、task.md、实际源码/差异、两位 Developer 报告、implementation.md、原始验证记录及真实浏览器截图。验收者未修改源码或标准，主会话保存本结果。

| 标准 | 结论 | 核对结果与证据 |
| --- | --- | --- |
| AC-01 | PASS | 候选限制于指定普通窗口，仅保存明确选择的 HTTP/HTTPS 页面；混合窗口旅程验证内页和另一窗口不受影响 |
| AC-02 | PASS | 空选择、额度不足和存储失败均在关闭前拒绝；取消不保存，不以空集合覆盖项目 |
| AC-03 | PASS | 网址、固定状态及项目内容变化触发重新确认；最终预览显示选5关3，共享页明确保留，其他受保护页面不收起 |
| AC-04 | PASS | 部分关闭按实际仍存在的标签计算结果，Undo 仅恢复实际已关闭项 |
| AC-05 | PASS | 执行前重新计算缺失网址，重复恢复不重建已有页面；复用页不移动、不改组 |
| AC-06 | PASS | original 模式恢复原窗口、位置及支持元数据；替代窗口失败不污染当前窗；实际组内部分撤销保持完整窗口顺序和幸存组 |
| AC-07 | PASS | 失败页面、组和元数据保留重试状态，成功项不重开；同一操作并发 Undo 只恢复一次 |
| AC-08 | PASS | 验证→保存来源→恢复目标→成功后收起来源；故障注入时来源保持，共享页保留且可撤销 |
| AC-09 | PASS | 重载保留项目；旧项目按 entries 恢复；条目编辑使过期 session 失效，元数据修改保留布局，回收站保持有效内容 |
| AC-10 | PASS | 实际按钮下载可解析备份并导回布局；提示准确表述发起导出，免费项目流程不依赖生产付款 |
| AC-11 | PASS | 中英文齐全，三种结果明确；键盘结果焦点、Tab/Shift+Tab循环和关闭返回焦点通过；1440、768、390px通过 |
| AC-12 | PASS | 最后源码 Node 213/213、41个JS语法、manifest/版本/ZIP校验通过；隔离Chrome旧回归和新项目旅程通过，保存原始证据 |
| AC-13 | PASS | 新建零选，旧项目匹配成员；真实 Atlas/Beacon/Orion 混合窗口保护其他项目、共享页和固定页 |

## 权威证据

- [验证清单与源码校验值](evidence/verification.json)、[全套测试](evidence/final-node-tests.log)、[语法结果](evidence/final-syntax.json)。
- [最终项目浏览器记录](evidence/final-projects/projects/result.log)、[结果 JSON](evidence/final-projects/result.json)、[原有回归](evidence/final/regression/result.log)。
- [最终切换预览](evidence/final-projects/projects/06-switch-preview.png)、[视觉核验](visual-review.md)、[包完整性](evidence/final-package.log)。

验收发现的恢复位置等待态、同操作并发撤销、结果及返回焦点、共享页预览计数均已修复复验。最后展示修正后重跑全部受影响项目旅程，旧回归不受该纯项目展示修正影响。验收者另行运行相关定向测试，并核对最终源码校验值及 ZIP 内容一致，包含 LICENSE。

## 交付包与范围

`dist/tab-out-2.2.0-store.zip`

SHA-256：`34a8e40ca108df9ae6d2bdbceb081cc95dd5dd9102d39c37000db97146292484`

覆盖本机 macOS、Chrome for Testing 151 的已列流程，不代表 Windows/Linux、用户日常 Chrome 配置或完整无障碍认证已实测。实际安装仍需重新加载扩展并刷新页面；未执行卸载、清空存储、提交、推送、公开发布或生产付款配置。
