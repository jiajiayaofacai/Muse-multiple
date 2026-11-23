---
type: scoped-security-and-code-self-review
context: Formal connector-tab integration on bf857001; no additional independent review pass
---

# 来源账号新标签：提交前自检

范围：本轮browser/actions/registry/views、features/shell、原生探测、四个固定版本vendor的6个源码修改点；Git基线`bf857001`。由主代理自检，不冒称独立审查、SAST或全仓库审计。上轮已有一次独立审查，本轮不重新启动广泛审查。

| 检查 | 结论与依据 |
| --- | --- |
| 正确性 | ✓ UUID来源登记、pending/closing、错误账号拒绝、迟到完成不覆盖新选择、来源先关闭无复活；Rust26与最终原生15项通过。父代理统一environment真实API及失败code。 |
| 安全/IDOR | ✓ `tab`/`owned_tab`校验account+UUID；`forget_tab`先确认归属。原生child沿真实来源environment，精确window_id+标签查找；不取当前激活账号，不取宿主首个WebView。 |
| 权限/认证 | ✓ capabilities仍仅webviews shell，无remote；lib的label+origin双guard不变。正式父页及child调用管理command被拒绝；session始终unknown，不将接管/关页当作授权。 |
| 注入/XSS/泄露 | ✓ 账号名/标题/诊断/标签ID经HTML转义；无新增eval内容拼接。URL先限制协议、主机及无凭据；仅origin展示，不保存认证URL/原始COM错误，不导出存储。 |
| COM/线程所有权 | ✓ 沿真实opener；close/completion总是排队、拒绝任务留待外层排空，避免COM回调内析构。PostMessage失败回收Box并尝试释放deferral。已有unsafe函数变化显式记录；无新增unsafe块/自有unsafe。 |
| 性能 | ✓ 仍有100标签和100诊断上限；无新后台轮询服务、依赖下载或全账号页面预加载。fallback队列仅原生投递失败使用；事件循环停止与长期资源边界未保证。 |
| 清晰度/类型 | ✓ 沿既有DTO、purpose枚举与Result；未引入any、忽略类型检查或猜测connected；前端纯渲染辅助有直接测试。 |
| 范围/供应链 | ✓ 用户明确批准四层固定补丁；原版本/manifest/许可证保留、19项SHA校验、只6个Rust源码变化，无无关依赖升级。局部字节规则使清单可跨Windows克隆复核。 |
| 测试 | ✓ TS53、Rust26、HTTP8、普通Edge3场景(含父4)、最终原生15；旧正式二进制原生负对照失败；无跳过冒充通过。vendor调度3测试由依赖代理单列。 |

## 未执行或不适用项

项目没有CONVENTIONS.md、bigpowers的churn/slopcheck/校验脚本，本轮未安装工具或伪造执行。沿本项目AGENTS规范。人工优先检查高改动的views/registry、原生底层和标签渲染，不做为满足通用行数规则的无关拆文件。上游crate及原有长文件保持结构；不为单一实现加接口或额外架构。

未运行CodeQL/Semgrep/全仓库安全审计；定向敏感扫描由主代理提交前执行。没有数据库SQL/反序列化执行/新增系统命令入口；无相应攻击面扩展。

未发现本轮改动中高置信度、未处理的HIGH安全缺陷。此结论不代表对全部上游代码或永久COM失败给出安全保证：成功投递后HWND先销毁的闭包所有权依赖上游，退出可丢弃通知、永久Complete/close失败和历史HRESULT仍待后续验证。真实认证/HTTPS/COOP/跨站Cookie/重启会话及长期泄漏未测，不能由合成结果替代。
