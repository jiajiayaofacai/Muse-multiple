# M0 原生模块：范围、技术闸门与集成

## 当前结论

**BLOCKED / 未通过认证闸门。** 普通原生同窗标签已完成专用WebView2合成存储隔离探测；真实Muse认证未验证。所有 `window.open` / target=_blank 请求明确返回 `NewWindowResponse::Deny`，记录固定脱敏诊断，不复制 URL 到普通 child，不独立弹窗，不调系统浏览器认证。最终检查结果以 [M0验证记录](../../../../specs/verifications/M0-RESULTS.md) 为准。

## 已核实的官方库源码事实

本轮核对 Cargo 缓存中的 `tauri-2.11.5`、`tauri-runtime-wry-2.11.4`。实际锁定并构建的版本为2.11.5/2.11.4；2.12.7候选未完成本轮构建，不能据此推断其行为。

- `tauri-2.11.5/src/webview/mod.rs:239–254`：`Create { window: WebviewWindow }`；Windows 必须共享 opener environment，不接受任意 child WebView。
- `tauri-2.11.5/src/webview/webview_window.rs:1351–1383`：安全 `window_features(features)` 在 Windows 向 builder 传递 opener environment。仅相同 data_directory 不是此关联的证明。
- `tauri-2.11.5/src/webview/mod.rs:1551–1561`：存在安全 `Webview::reparent(&Window)`；`unstable` 下可越过 WebviewWindow 类型限制。API 返回不自动证明 opener/close/宿主生命周期正确。
- `tauri-runtime-wry-2.11.4/src/lib.rs:3689–3730`：reparent 从原宿主 `webviews` 列表移除该视图，并插入目标宿主。
- 同文件 `4933–4942`：新窗口回调返回 `Create { window_id }` 后，仍用该 window_id 查宿主 `webviews.first().unwrap()`。

### 排除的路线（源码推断，不是已执行崩溃复现）

同步创建仅一个 WebView 的隐藏 `WebviewWindow` → 把其 WebView reparent 到 shell → 返回原 `Create`：原宿主列表已空，随后 `first().unwrap()` 存在 panic 风险。提前销毁隐藏宿主会使 `.get(&window_id).unwrap()` 更危险。返回 shell 本身则可能接管 shell 的首个（本地管理）WebView，不能采用。

### 尚待验证的实验路线（没有启用）

先用 `.window_features(features)` 建隐藏宿主并返回 Create，等待 runtime/WebView2 完成真正接管后再 reparent。必须证明：如何可靠得知接管完成，而不是假定 `run_on_main_thread` 的排队时序；隐藏宿主能否安全保留/销毁；`window.close()` 是否只关闭认证标签而不关闭 shell；跨来源 opener/postMessage、嵌套请求、焦点和来源页先关闭。当前没有安全、可验证的完成边界，故未启用；并非宣称 Tauri 所有安全路线都不可能。

官方文档复核入口（待主代理按实际锁版本核对）：
- https://docs.rs/tauri/2.12.7/tauri/webview/enum.NewWindowResponse.html
- https://docs.rs/tauri/2.12.7/tauri/webview/struct.WebviewWindowBuilder.html#method.window_features
- https://docs.rs/tauri/2.12.7/tauri/webview/struct.Webview.html#method.reparent

## 公开 Rust API

`browser::{Snapshot, Action, ContentBounds, AppError}` 为 camelCase serde DTO，匹配 `app/contracts/workspace.ts`。

- `install(&mut tauri::App) -> Result<(), Box<dyn std::error::Error>>`
- `snapshot(&tauri::AppHandle) -> Result<Snapshot, AppError>`
- `dispatch(&tauri::AppHandle, Action) -> Result<Snapshot, AppError>`
- `layout(&tauri::AppHandle, ContentBounds) -> Result<(), AppError>`

模块自行 manage 状态。冷启动恢复元数据，activeAccountId=null、tabs=[]，不创建远程视图。createAccount 只保存档案，不自动加载页面；首次 activateAccount 打开 Muse，后续激活不复活关闭的最后标签。同次运行多标签热保留；重启不保存 URL、标签、标题、认证状态。sessionStatus 始终 unknown。

持久化根：`app_data_dir()/m0-verification/accounts.json`；资料根：`profiles/<v4 UUID>/`，每账号 builder 独立 data_directory。UUID 不来自名称或任意前端路径。创建/保存失败不清资料，损坏元数据不静默重置。数据隔离和持久化登录有效性尚待原生实测。

页面标题仅临时 UI DTO，不进入诊断/持久化。displayUrl 为 origin（about:blank 原样），不含路径、query、fragment 或凭据。诊断最多100条、仅固定文本与稳定账号 ID。下载在 M0 拒绝。远程回调按 account/tab 归属检查，已关闭标签事件直接忽略。

loadState 只在真实 PageLoadEvent 更新（Started/Finished）；Finished 不是 HTTP 成功或登录有效的证明。同步导航/刷新错误标记 error；没有可用的通用网络失败回调接入。canGoBack/canGoForward 保持 false；back/forward 返回 history_unsupported。stop 仅提交固定 window.stop，不伪造停止完成。openProjectLink 返回 project_link_unsupported，未添加依赖。

## 主代理集成事项（本代理未改共享文件）

1. lib.rs 加 `mod browser`，setup 调 install，commands 转发上述三项 API。管理 command 同时检查调用 WebView 标签严格为 `shell` 及受信任本地来源；不能仅检查所属 window 标签。command 不允许远程内容调用。
2. dispatch 涉及 add_child，使用 async command/worker thread 避免 Windows UI-thread 同步创建死锁；不要在 UI 线程通过同步 command 调用。异步壳包装若需移动阻塞任务，请用已有 Tauri runtime，不添加依赖。
3. 保留 `tauri` 的 `unstable` feature（add_child / reparent API 所需）；现有 serde、serde_json、uuid(v4) 足够，无需新增 crate。候选 2.12.7 下载后复核方法签名，并由主代理运行 cargo fmt --check、clippy、test/build。
4. capabilities 必须限定 `webviews:["shell"]`，不能以 `windows:["shell"]` 给该窗口所有远程 child 管理能力；不配置 remote origins。当前读到的 shell.json 已符合此标签范围。
5. 所有首页/设置/本地 dialog 先提交 visible=false 并等原生完成再显示遮罩；只允许 active 标签显示。逻辑像素布局必须位于 shell inner_size 内，layoutSeq 严格递增且是 JS 安全整数。workspace_busy 为可重试，UI 需保留最新布局并重试，不能丢弃隐藏请求。
6. createAccount 只创建档案；UI 如需创建后即打开，应使用成功 snapshot 中新 UUID 显式 activateAccount。
7. 项目固定链接由主代理安全外链入口处理 unsupported，不应放开远程任意系统启动。

## 检查记录

- 先写 `logic.rs` 4 个测试及失败占位；`rustc --edition 2024 --test ...` 可编译，运行得到 0 passed / 4 failed（名称、URL、ID归属、布局）。
- 实现逻辑后同命令得到 4 passed / 0 failed。产物仅写会话 scratch，不进入仓库。
- registry 冷启动/最后标签测试、storage 合成临时目录原子覆盖/损坏测试已写，需主代理 cargo test 执行；本代理未运行 Cargo 构建以免与主代理冲突。
- 主代理已执行完整crate格式/Clippy/测试/构建及6项专用WebView2机制检查，详细通过/未测内容见上方最终验证记录；同窗认证仍未验证。
