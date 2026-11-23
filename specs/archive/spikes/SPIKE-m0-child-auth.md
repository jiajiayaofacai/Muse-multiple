---
type: spike-report
context: User-approved evaluation only; Windows same-host authentication; no production dependency patch applied
status: partially-answered-not-ready-for-integration
---

# Spike: M0 同宿主 child 认证与原生关闭

**后续更正（2026-11-23）：本报告只记录通用新窗口实验，不能证明Muse普通登录依赖popup。** 用户已说明电话/邮箱、验证码及可选两步验证都在原网页；本代理核对了官方初始页，完整流程未实测。底层补丁研究暂停，以[当前登录基线](../../verifications/MUSE-LOGIN-BASELINE.md)为准；下文原实验结果与失败记录保留。

## Question

能否用 Wry 已有的真实新窗口接管机制，直接创建同一宿主的 child 并继承来源环境，通过最小安全关闭回调扩展完成单标签清理，避开隐藏窗口及延迟 reparent？

用户批准范围：只评估、可制作隔离合成实验，报告后再决定是否应用。正式工程依赖、锁文件、权限、自有 unsafe 禁令和 `window.open` Deny 不变。

## Result

**部分回答：底层机制有成功运行证据，但不适合直接集成。** 最终全新资料根的一轮 Wry 合成矩阵 8/8 通过；此前一次原生创建返回 `0x80070057`，根因未定位。没有运行 Tauri 补丁，没有真实 Muse 认证证据，M0 闸门仍未通过。

实验预算约30分钟；源码副本创建至最终矩阵结果为本机15:15:42—15:46:54，约31分钟。此后停止运行实验，仅整理文档和静态质量检查；未继续扩大运行实验范围。

## Official API findings

调查日期：2026-11-23。只读代理下载官方源码，主代理核对当前锁定源码与底层调用链。没有下载或安装候选依赖。

| 范围 | 官方源码结果 |
| --- | --- |
| 最新稳定 Tauri 2.12.7 / runtime-wry 2.12.5 | Create仍接收WebviewWindow，经window_id查首个视图，不能指定已有child |
| 最新稳定 Wry 0.57.3 | 底层Create可接收ICoreWebView2，但网页关闭仍直接DestroyWindow；接管COM结果仍被忽略 |
| Tauri 3.0.0-alpha.6 | 相同窗口级Create限制，没有本任务需要的完整接口组合 |
| 固定开发分支 | Tauri `e6281849e559cc0ba76435f264d6a03801f3e5b8`、Wry `5a969d5b3ff17ead8ea495bfff5b869be4e604d1`；核查点仍未补齐 |

官方来源：
- [Tauri 2.12.7 Create定义](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.7/crates/tauri/src/webview/mod.rs#L243-L258)
- [runtime-wry 首个视图查找](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.7/crates/tauri-runtime-wry/src/lib.rs#L4862-L4887)
- [Wry 0.57.3 原生Create](https://github.com/tauri-apps/wry/blob/wry-v0.57.3/src/lib.rs#L459-L485)
- [Wry 网页关闭实现](https://github.com/tauri-apps/wry/blob/wry-v0.57.3/src/webview2/mod.rs#L720-L724)
- [Wry 接管调用结果处理](https://github.com/tauri-apps/wry/blob/wry-v0.57.3/src/webview2/mod.rs#L867-L885)
- [Tauri 预发布](https://github.com/tauri-apps/tauri/blob/tauri-v3.0.0-alpha.6/crates/tauri/src/webview/mod.rs#L205-L220)

版本来自crates.io包元数据；仓库默认分支为dev，不是main。请求main提交曾返回422，改查dev后成功。源码调查不等于候选版本编译或运行验证，不能以单纯升级作为解除闸门的方案。

## Experiment boundary

- 复制缓存Wry 0.55.1到会话scratch，未修改Cargo缓存。宿主依赖Tao 0.35.3、webview2-com 0.38.2；离线独立锁定。
- 宿主源文件含 `#![forbid(unsafe_code)]`，仅创建一个Tao Window、两个独立资料环境；child通过 `features.opener.environment` 继承实际发起环境。
- 新child不自行导航目标URL：以无URL的builder创建，再返回 `NewWindowResponse::Create { webview: child.webview() }`，由WebView2真实接管。
- 不创建隐藏宿主，不调用reparent，不复制URL冒充认证关联。不授予合成网页本地管理IPC，不访问Muse。
- Wry副本两个文件增加Windows可选关闭handler；配置时投递事件循环，稍后移除对应tab并Drop controller。未配置时仍执行上游DestroyWindow默认行为。
- 另在副本三个创建阶段增加固定错误诊断。没有新增unsafe块或原生函数调用；但修改了上游已有unsafe函数内的逻辑，仍须按依赖原生代码审查，不能宣传为没有原生风险。

实验扩展核心（仅说明已测试修改，不是可直接应用的补丁）：

```rust
// Wry Windows native callback, replacing only the default close dispatch:
if let Some(handler) = &close_requested_handler {
    handler(); // owner queues an event; must not destroy the view here
    Ok(())
} else {
    DestroyWindow(hwnd)
}
```

## Evidence

执行：`cargo build --offline --manifest-path <scratch>/wry-child-spike/Cargo.toml`，退出0；阶段诊断后执行 `cargo build --offline --locked ...`，退出0。运行独立二进制，`SPIKE_DATA_ROOT`每次指向不存在的绝对scratch路径。

后续静态检查：scratch宿主格式检查通过；Clippy首次因 `collapsible_if` 失败，等价合并条件后 `cargo clippy --offline --locked --all-targets -- -D warnings` 通过。`cargo test --offline --locked`退出0，但包含0个单元测试，不能作为机制验证。此后未重新执行原生矩阵；下方main.rs哈希对应实际运行时版本，格式及等价条件整理后的哈希为 `DEA2E00F5A4911C1AA0D0512B2A471B97EDCA7E1A1757C7BD1C8683E316B54CB`。

合成站点沿用 `npm --prefix app run test:sites:start`（4317/4318）。Playwright连接专用WebView2的9335/9336端口；最终 `node <scratch>/wry-child-spike/probe.cjs` 退出0。

最终矩阵：
1. A/B独立环境写入不同合成身份。
2. A真实child继承本资料Cookie，跨端口localStorage隔离；opener存在、消息origin/source匹配，网页自关闭。
3. B同场景独立通过，未使用A的环境。
4. 原生关闭事件对应child ID，计数回落至2，两个父页都存活。
5. 嵌套child仅回直接opener，祖先记录仍pending，随后各自关闭。
6. `about:blank`关联存在，来源脚本随后导航到第二源，网页自关闭且来源观察closed。
7. 来源先关闭，原生移除来源视图；剩余child的opener被引擎置null（missing），child可独立关闭，B仍存活。
8. 创建日志始终同一个宿主ID，无隐藏宿主/reparent路径；最终计数1，无错误或宿主关闭日志。

原生日志关键顺序：
```text
READY count=2
CREATED id=3 account=0 opener=1 count=3
CLOSE_REQUEST id=3 account=0
CLOSED id=3 account=0 count=2
CREATED id=5 account=0 opener=1 count=3
CREATED id=6 account=0 opener=5 count=4
CLOSED id=6 account=0 count=3
CLOSED id=5 account=0 count=2
CLOSED id=1 account=0 count=2
CLOSED id=8 account=0 count=1
```

完整尝试记录，不能只保留最后通过：
- 第1轮：child实际加载成功，但已有CDP连接未自动发现新目标，探测超时；通过端口目标列表和重新连接确认opener存在。
- 第2轮：原生创建报 `WebView2 error HRESULT(0x80070057)`；没有child目标。未定位根因，后续阶段诊断未再捕获此错，不能称已修复。
- 第3轮：child成功，夹具首次定时采样前opener文案unknown；改为等待明确present后断言。
- 第4轮：前6项通过，来源关闭后引擎清空opener，不是closed引用，旧预期超时。读取实际状态为missing。
- 第5轮：新资料根，最终8项全部通过；来源不可用接受null或closed并报告实际missing。不宣称所有冷启动稳定通过。

最终证据SHA-256（原件仅在会话scratch，不提交二进制、日志或资料）：
- `src/main.rs`: `BB911F163474B83F957FB37D12423F1F70068CC3DE4F39A72072846C55D8A630`
- `probe.cjs`: `E8A214B1592B99AA82052F78B1AB54A095B9A91FD9739B74ED146EA4C56EC6DB`
- 独立Cargo.lock: `757DDFB6B133F00FF366F5261EE30D92E5E648404D1FD1F82D30A81730D49488`
- Wry `src/lib.rs`: `D5D84B91943A0D92987CAE65E73883F7E652860261F14D9939046E5422A203FB`
- Wry `src/webview2/mod.rs`: `3710DF5772E99FF67884F70338921E4C8CEDEACCFF3D376954972AEF789A07DA`
- 最终探测输出: `187BC2EDBE6A0CCE0626BBEDD72144DB0A0204ED3E620BDC13F866C807E7B3B3`
- 最终原生日志: `7A0648480ACD9566D6B2EE2E29C1073BBA7D494020619482A7282DABEABF70D0`

## Implications for the plan

建议的最小候选不是延迟reparent，而是精确child接管。若用户批准下一轮隔离评估，至少涉及四层：
1. Tauri：新增可指定Webview的Create分支；按真实来源传递environment，不能返回shell首个视图。
2. tauri-runtime：传递稳定window_id和webview_id，或等价精确身份；缺失目标必须返回拒绝，不unwrap。
3. runtime-wry：按精确child查找，将原生关闭通知传回受信任端；异步单视图关闭必须同步清理Tauri管理器与应用注册表，迟到事件幂等。
4. Wry：安全的关闭接管hook，以及SetHandled/SetNewWindow/deferral.Complete的结果回报与失败清理。直接child方案无需依赖page-load猜测reparent时机，但仍需失败回报，不能提前标认证成功。

这是范围建议，未实现上述Tauri层补丁。当前锁定版本可作为首个复现实验基线；维护的固定来源、校验、许可、上游跟踪与更新策略需要另外设计，不应把大份vendor源码直接上传项目。

## What was NOT explored

- `0x80070057`根因、失败后的容器资源回收、接管COM失败注入、反复压力/长时间测试。
- Tauri多视图/ACL/管理器集成；Rust锁、主线程重入和删除/休眠交错。
- 真实账号、跨站HTTPS、第三方Cookie、COOP、noopener/noreferrer、named target复用、外链文章完整行为。
- 工作台标签视觉/焦点/DPI切换、热切换认证保护、持久化重启、崩溃恢复、安装升级。
- 原生接管完成通知没有在本实验扩展，不能由页面ready或合成成功推断该API已经存在。

## Recommendation

**不应用当前实验补丁，不解除M0闸门。** 建议用户批准下一轮“固定版本Tauri副本实验”：先定位创建失败，补齐精确child、关闭通知和接管失败回报，再跑集成矩阵。报告通过后再单独批准正式集成。

本轮scratch代码不进入生产或版本库，实验进程和合成站点已停止。真实资料未访问；正式app保持原提交的生产行为。

verify: `git diff 633c229 -- app/src-tauri/Cargo.toml app/src-tauri/Cargo.lock ':(glob)app/src-tauri/src/**/*.rs' app/src-tauri/capabilities app/src-tauri/tauri.conf.json` 应为空。

正式工程回归：本轮再次执行typecheck、lint、TS测试（34）、合成站点测试（7）、Vite build，均退出0；crate的fmt、Clippy、Rust测试（9）、build均退出0。MSVC已有linker stdout warning仍存在。未重跑正式app的原生探测，因为生产代码未变；不要将scratch的8项计入其原有6项。

文档本地链接存在，生产边界差异为空，`git diff --check`通过。另经客户端成功获取 [Tauri 2.12.7 NewWindowResponse文档](https://docs.rs/tauri/2.12.7/tauri/webview/enum.NewWindowResponse.html)，确认Create仍接收WebviewWindow，与本轮下载的官方固定标签源码一致。
