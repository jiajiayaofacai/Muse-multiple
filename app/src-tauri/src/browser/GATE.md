# M0 原生模块：范围、技术闸门与集成

## 当前结论

**当前优先验收：普通原页登录、账号隔离与会话恢复；未通过不等于依赖popup补丁。** 2026-11-23按用户澄清及官方初始页核对，电话/邮箱→验证码→可选两步验证以原账号现有网页为基线。完整流程尚未由代理实测；详见[网页登录基线](../../../../specs/verifications/MUSE-LOGIN-BASELINE.md)。此前“先做popup接管才能验证普通登录”的前提撤回，底层补丁研究暂停，不宣称M0已通过。

生产代码未改变：普通原生同窗标签已做合成存储隔离探测，真实Muse登录/恢复待验收；所有 `window.open` / target=_blank 仍返回 `NewWindowResponse::Deny`。该限制单列为新窗口能力缺口，不能再直接等同普通登录不可用。程序内旧gateStatus文案也未在这次文档更正中修改，不能将其视为新发现的登录故障。

## 历史：新窗口能力限制与隔离实验（不是普通登录前提）

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

先用 `.window_features(features)` 建隐藏宿主并返回 Create，等待接管后再 reparent。若 builder 自行加载目标 URL，其 page-load 不能证明接管完成；空白 builder 的后续目标导航只是候选边界。`about:blank`、接管失败及嵌套请求仍需验证。本轮未启用此实验。

### 2026-11-23：关闭语义复核

以下是锁定依赖的源码事实，不是已执行的认证实验：

- `wry-0.55.1/src/webview2/mod.rs:109–117,224–265`：为每个 WebView 创建独立 child 容器 HWND。
- 同文件 `615–619`：网页 `window.close()` 的 `WindowCloseRequested` handler 直接执行 `DestroyWindow(hwnd)`；捕获的是该容器，不是 Tauri 宿主窗口。
- 同文件 `1691–1709`：reparent 使用 `SetParent(self.hwnd, ...)`，不替换容器 HWND 或关闭 handler。
- `tao-0.35.3/src/platform_impl/windows/event_loop.rs:1061–1078`：宿主 `CloseRequested` 由宿主 WM_CLOSE 产生。销毁 WebView 子容器不经过此关闭路径。
- `tauri-2.11.5/src/app.rs` 的 `WebviewEvent` 仅公开 DragDrop；没有网页自关闭事件。已与该版本官方文档核对。
- `tauri-2.11.5/src/webview/webview_window.rs:425–432,2216–2223`：page-load 包装对象按 Webview 当前归属重建；reparent 后其窗口可能已是 shell。不得对该包装对象调用窗口级 close/destroy 来关闭认证标签。
- `tauri-2.11.5/src/webview/mod.rs:1501–1505`：明确的 `Webview::close()` 走单视图关闭与管理器清理，不能假定 Wry 自行销毁容器等价于调用此方法。

因此，“隐藏宿主 `CloseRequested.prevent_close()` 拦截网页关闭，再清理 tab”不成立。源码支持迁移后网页 close 的直接目标仍是独立子容器，但没有证明 Rust 注册表会自动清理，也没有原生实测证明完整生命周期安全。不能把这两件事混为一谈。

最小调用链复核（源码检查，不是崩溃复现；在依赖已下载的本机执行）：

```powershell
$cargoHome = if ($env:CARGO_HOME) { $env:CARGO_HOME } else { Join-Path $HOME '.cargo' }
$registry = Get-ChildItem (Join-Path $cargoHome 'registry\src') -Directory |
  Where-Object { Test-Path (Join-Path $_.FullName 'wry-0.55.1\src\webview2\mod.rs') } |
  Select-Object -First 1 -ExpandProperty FullName
if (-not $registry) { throw '缺少锁定依赖源码，不能复核' }
Select-String (Join-Path $registry 'wry-0.55.1\src\webview2\mod.rs') `
  -Pattern 'add_WindowCloseRequested|DestroyWindow\(hwnd\)|SetNewWindow|SetParent\(self.hwnd' -Context 1,2
Select-String (Join-Path $registry 'tauri-2.11.5\src\app.rs') `
  -Pattern 'enum WebviewEvent' -Context 0,8
```

重新开闸至少需要可观测的接管边界，以及网页自关闭到单标签清理的可靠原生通知。需另外批准评估最小上游修复/固定依赖补丁，或验证确实提供这些能力的新版本；不能仅凭升级版本号判断已解决。当前不新增自有 unsafe，不覆盖网页 `window.close`，不放开远程 IPC，不降级独立弹窗或系统浏览器。M1—M6继续暂停。

已按实际锁版本复核的官方文档：
- https://docs.rs/tauri/2.11.5/tauri/webview/enum.NewWindowResponse.html
- https://docs.rs/tauri/2.11.5/tauri/enum.WebviewEvent.html

源码复核入口：
- https://docs.rs/tauri/2.11.5/tauri/webview/struct.WebviewWindowBuilder.html#method.window_features
- https://docs.rs/tauri/2.11.5/tauri/webview/struct.Webview.html#method.reparent

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

## 受控评估更新（2026-11-23）

用户随后批准只评估、不应用的受控实验。官方最新稳定与已核查开发分支未发现完整接口组合。scratch内Wry直接child接管＋最小原生关闭hook的最终合成矩阵8/8通过，但曾出现未定位的 `0x80070057` 创建失败，Tauri层适配和接管失败回报仍未实现。

详见[隔离评估报告](../../../../specs/archive/spikes/SPIKE-m0-child-auth.md)。该证据只证明底层路线值得继续实验，**不解除本模块M0闸门**。本轮没有应用依赖补丁或改变生产Deny行为；下一步由用户决定是否开展固定版本Tauri副本实验。
