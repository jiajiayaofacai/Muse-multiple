# 固定版本的 Windows 连接器标签补丁

此目录仅保存四个必要 crate 的发布源码及原始归属文件，不是整个依赖树，也不是旧实验应用。正式工程通过 Cargo 原生 `[patch.crates-io]` 使用这些目录；应用 manifest 与锁文件由主工程维护，此目录不修改上游 manifest、版本号或依赖声明。没有构建期下载或应用补丁脚本。

## 版本、来源与许可证

| 目录 | crates.io 来源 | 发布包 URL | 原许可证文件 |
| --- | --- | --- | --- |
| `tauri-2.11.5` | https://crates.io/crates/tauri/2.11.5 | https://static.crates.io/crates/tauri/tauri-2.11.5.crate | `LICENSE_APACHE-2.0`、`LICENSE_MIT` |
| `tauri-runtime-2.11.3` | https://crates.io/crates/tauri-runtime/2.11.3 | https://static.crates.io/crates/tauri-runtime/tauri-runtime-2.11.3.crate | `LICENSE_APACHE-2.0`、`LICENSE_MIT` |
| `tauri-runtime-wry-2.11.4` | https://crates.io/crates/tauri-runtime-wry/2.11.4 | https://static.crates.io/crates/tauri-runtime-wry/tauri-runtime-wry-2.11.4.crate | `LICENSE_APACHE-2.0`、`LICENSE_MIT` |
| `wry-0.55.1` | https://crates.io/crates/wry/0.55.1 | https://static.crates.io/crates/wry/wry-0.55.1.crate | `LICENSE-APACHE`、`LICENSE-MIT`、`LICENSE.spdx` |

四者均为 **Apache-2.0 OR MIT**，保留源码版权头、上游 README、`Cargo.toml`、`Cargo.toml.orig` 与许可证。Tauri 系列上游为 https://github.com/tauri-apps/tauri ，Wry 上游为 https://github.com/tauri-apps/wry 。

本次从已验证的 scratch `tauri-connector-faults/patches` 四个同名目录复制，以上游本机 Cargo registry 的同版本发布内容只读比对。仅下述六个源码文件不同于原始发布包。保留 `src`、`build.rs` 及构建引用的 Tauri `scripts`、`permissions`、`mobile`；Wry `examples` 是原始 manifest 显式声明的发布目标，保留以避免悬空路径。保留移动平台发布源码不代表验证或承诺移动平台支持。未复制 registry 标记/校验文件、crate 锁文件、仓库工具配置、故障模块、调试产物或浏览资料。

## 实际修改与接口

所有新增接口均受 `#[cfg(windows)]` 限定，其他平台沿用上游行为。

- `tauri-2.11.5/src/webview/mod.rs`
  - 新增 `tauri::webview::NewWindowResponse::CreateWebview { webview: Webview<R>, on_complete: Box<dyn FnOnce(Result<(), String>) + Send> }`。
  - 新增 `WebviewBuilder::on_close_requested<F: Fn(Webview<R>) + Send + Sync + 'static>(self, f: F) -> Self`，将原生自关闭交给所有者维护标签登记与关闭；不直接销毁共享容器窗口。
  - 将目标转换为运行时 `window_id` + `webview_label`；关闭通知执行时按原标签查找仍存在的视图。应用必须使用不可复用 UUID 标签，拒绝缺失/迟到来源。
- `tauri-runtime-2.11.3/src/webview.rs`
  - 新增 `NewWindowResponse::CreateWebview { window_id: WindowId, webview_label: String, on_complete: Box<dyn FnOnce(Result<(), String>) + Send> }`，以及 `PendingWebview::close_requested_handler: Option<Arc<dyn Fn() + Send + Sync>>`。
- `tauri-runtime-wry-2.11.4/src/lib.rs`
  - 精确按窗口 ID 和标签查找子视图，不使用窗口的首个 WebView。目标缺失时拒绝请求，并异步回报 `Err("target_missing")`。
  - 接管完成与自关闭通知通过事件循环 `Message::Task` 调度；入队失败时保留任务到线程局部队列，不在 COM 回调内执行所有者清理。
  - `MainEventsCleared` 排空后备队列；`LoopDestroyed` 丢弃尚未执行的任务。
- `tauri-runtime-wry-2.11.4/src/connector_dispatch.rs`（新增）
  - 线程局部 `PENDING`/`DRAINING`、批次排空、防重入 guard 与退出丢弃。保留三项测试：等待/顺序、重入延后、退出不执行；仅整理格式，未改实验版本的调度逻辑。
- `wry-0.55.1/src/lib.rs`
  - 新增 `NewWindowResponse::CreateWithResult { webview: ICoreWebView2, on_complete: Box<dyn FnOnce(Result<(), String>)> }` 与 `WebViewBuilder::with_close_requested_handler(self, callback: impl Fn() + 'static) -> Self`。
- `wry-0.55.1/src/webview2/mod.rs`
  - 已有 `unsafe fn attach_handlers`：可选原生关闭通知；请求读取元数据/取得 deferral 前先设置 `Handled=true`，取得失败则保持拒绝。对新响应执行 `SetHandled`、`SetNewWindow`，始终尝试 `Complete`，将真实 HRESULT 阶段错误合并回报；消息发送失败也尝试释放 deferral。
  - 已有 `unsafe fn dispatch_handler<F>(hwnd: HWND, function: F) -> bool`：真实 `PostMessageW` 成功返回 `true`，失败回收双层 Box 且返回 `false`。移除只为故障注入使用的布尔参数，更新调用点；未新增 unsafe 块或 unsafe 函数。
  - 既有 `unsafe fn attach_custom_protocol_handler` 的调用恢复为 `(hwnd, handler)`；不改变协议处理策略。相较原始发布包，所有权语义变化也适用于该既有调用：发送失败不再遗失 Box，返回值仍不用于协议重试。

完成回调只表示原生接管/deferral 操作结果，不表示页面 ready、OAuth 回调成功、已登录或已连接。必须使用真实 opener 的 WebView2 environment 创建目标；此层不校验账号身份、不复制 URL、不改变权限配置，也不承担账号登记策略。

## 去仪表与验证边界

已删除两个故障模块及其注册、环境变量读取、各阶段故障分支与实验日志；生产代码没有实验开关。仅保留类似上游已有的、debug/tracing 控制的 `PostMessage failed` HRESULT 诊断，不记录 URL 或凭据。

本轮定向 `rustfmt --check`（六个修改源码，edition 2021、两空格、skip_children）通过；Wry 上游 rustfmt 配置的 nightly-only `imports_granularity` 在 stable 上会给出忽略警告。通过独立 `rustc --test` 包裹模块执行三项调度测试，无需 Cargo target。静态比对确认只有上列六个源码变化；四个 `Cargo.toml` 与上游完全一致。

主代理已在正式工程完成fmt/Clippy、26项Rust测试、build及最终15项原生合成矩阵，见[正式接入报告](../../../specs/verifications/CONNECTOR-PRODUCTION-RESULTS.md)。独立队列测试不验证COM、HWND或WebView2行为。真实Muse/第三方认证、HTTPS/COOP、永久COM失败、长时间泄漏和应用重启后的会话恢复仍未验证；不能据此宣称免重复登录已验证。

已知边界：`GetDeferral` 或最初 `PostMessageW` 失败发生在应用创建目标前，没有可调用的目标完成回调；请求保持拒绝并尝试释放已取得的 deferral。队列在退出时可能丢弃通知；成功入队后若 HWND 在消费前销毁，其闭包清理仍依赖上游消息生命周期。`Complete` 失败只能尝试释放并报告，不能承诺永久 COM 故障下的资源释放。

## SHA256 清单、维护与回滚

`SHA256SUMS` 是 vendor 相对路径的小型 SHA256 清单：六个修改/新增源码、四个原始 `Cargo.toml`、九个原许可证文件。它不递归散列自身或 README，不是整个发布包的供应链证明。更新后使用 PowerShell `Get-FileHash -Algorithm SHA256` 重算这些明确路径，并通过代码审查用 Write/Edit 更新清单；不得在构建期间自动改源码或清单。

本目录`.gitattributes`使用`-text`保留原始字节，避免Windows的Git换行转换破坏清单；仅影响此vendor目录，不更改应用源码规则。父代理同时核对工作目录与暂存blob哈希。

升级时必须同步评审四层接口，先对照对应 crates.io 发布包，再重做 Windows 的来源隔离、真实 opener、跨来源回调、自关闭、后台归属、nested/about:blank、来源先关闭与最后标签不复活等矩阵。特别审查上述已有 unsafe 函数中的 COM/Box 所有权和回调线程规则；不直接覆盖为未来上游版本，不保留实验注入。确认上游已覆盖需求后，优先移除本地补丁。

回滚必须原子进行：主工程先移除所有新增 `CreateWebview`/`on_close_requested` 调用并恢复已批准的拒绝新窗口策略，同时移除四项 `[patch.crates-io]`、重解应用锁文件；确认没有本地补丁引用后再删除此目录，运行完整质量检查与原生拒绝策略回归。不删除、迁移或覆盖账号浏览资料，不能只撤掉某一层留下半接入状态。
