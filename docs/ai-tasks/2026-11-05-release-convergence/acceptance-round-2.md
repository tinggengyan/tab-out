# 第1轮正式修复后的独立复验：FAIL

`/root/release_acceptance` 只读复验，主会话据返回正文整理，结论未改。原组合故障拆组已修复；其余12项AC维持PASS，AC4仍FAIL。冻结标准不变。

组合故障证据：根Node重现退出1→0；真实adapter测试8/8；隔离Chrome修前2组失败、修后同组且预先复用页不移动。当前Node316/316、JS58、Chrome regression/projects/release重跑通过，memory/layout/i18n既有证据仍适用。

## 两项确定性P2缺陷

1. 首次A/B打开并成功组成90组，C创建失败；关闭A/B使90组和窗口消失。再次继续补开A/B/C，却继续使用groupMappings90；第二次和第三次均`No group with id 90`，三页未分组。
2. 首次页面创建为tab10但固定属性失败；关闭10后继续，新页11已成功固定，却仍传metadataFailures里的旧目标10，后续永远partial。

证据：`evidence/repro-stale-targets.cjs`、`stale-targets-before.log`，根实际执行退出1。原因是facade未清理过期groupMappings/existingGroupId以及已关闭metadata目标。必须按真实Chrome状态保留有效重试、丢弃失效目标，并让新页承担原属性恢复；不能只隐藏错误或强行complete。

## 逐项结论

| 项目 | 结果 |
| --- | --- |
| AC1、2、3 | PASS：布局、旧资产入口、免命名与保护路径未回退。 |
| AC4 | FAIL：原拆组已修复，两个过期目标重试问题仍需处理。 |
| AC5、6、7、8、9、10、11 | PASS：搜索、抽取、隐私取消、备份/销售及四语言相关代码未再改，原证据有效。 |
| AC12 | PASS：现有检查通过，追加重现失败归AC4，不能据已有套件宣称无缺陷。 |
| AC13 | PASS：facade局部修复；11保护文件/四旧包不变，61文件包与该轮源码一致。 |

该轮包SHA-256 `60f1e283f4942118984081efe2ab12d10dd61f044915f32b203e1dcd97e08ae7` 仅源码一致性通过，体验验收未通过，修复后须重打包。

进入第2轮、最后自动定点修复，补过期目标的Node与真实Chrome证据。实际provider、原生权限弹窗、全面私有站点/母语审校、跨刷新重试上下文、商用条款/联系方式/付款服务及同步的原有边界维持不变。两轮后仍不满足应如实交付未完成，不降低标准。
