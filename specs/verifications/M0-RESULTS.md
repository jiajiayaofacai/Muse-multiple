# M0 原生验证结果

日期：2026-11-23
平台：Windows；WebView2 Runtime 144.0.3719.104；Rust 1.97；Tauri 实际构建版本 2.11.5；`tauri-build` 2.6.3。

## 自动检查

| 检查 | 结果 |
| --- | --- |
| `npm --prefix app run typecheck` | PASS |
| `npm --prefix app run lint` | PASS |
| `npm --prefix app run build` | PASS |
| `npm --prefix app run test` | PASS：34/34 TypeScript 测试，含握手、busy重试和亚像素布局复现 |
| `npm --prefix app run test:sites` | PASS：7/7 合成 HTTP 站点测试 |
| `cargo fmt --check` | PASS |
| `cargo clippy --locked --all-targets -- -D warnings` | PASS；MSVC 只报告 linker stdout warning |
| `cargo test --locked` | PASS：9/9 Rust 单元测试 |
| `cargo build --locked` | PASS；MSVC 只报告 linker stdout warning |
| 原生逻辑独立 rustc 测试 | PASS：4/4，子代理阶段 |
| 专用 WebView2 原生探测 | PASS：6项机制检查；同窗认证断言为明确BLOCKED，不是认证通过 |
| 原生壳页面重载 | PASS：重新握手后连接恢复，原生账号和标签数量保持 |

Rust 2.12.7 依赖在本机缓存不足且 crates.io 解析长时间等待；M0 使用本机可复现的 Tauri 2.11.5/tauri-build 2.6.3，不能把结果直接宣称为 2.12.7 结果。

## 原生运行证据

- 专用 debug 进程使用 `$env:MUSE_MULTIPLE_M0_DATA_DIR` 指向会话 scratch 的临时根目录，并设置 `$env:MUSE_MULTIPLE_M0_DEBUG=1`；没有读取用户日常浏览资料。
- 工作台壳成功启动，原生快照显示合成账号 A/B、每账号独立 runtime、原生标签 `loadState=ready`，合成父站实际加载为 `http://127.0.0.1:4317/parent`。
- 账号资料目录使用稳定 UUID：`profiles/<account-id>`；元数据和 profile 映射由 Rust 维护。第二实例锁测试通过，避免旧快照覆盖账号映射。
- 远程页面调用 `workspace_snapshot` 未获得成功；命令由本地 shell label/origin 双重校验保护。普通浏览器模式只显示“未连接原生运行时”，不伪造账号。
- 专用原生探测实际写读合成A/B：不同账号Cookie/localStorage/IndexedDB隔离，同账号标签共享正确资料，远程管理命令被拒绝；关闭最后标签后切走再回来不复活。六项检查通过。

## 技术闸门

**认证同窗标签：BLOCKED。** 当前新窗口回调明确 `Deny`，控制台记录：

> BLOCKED: 同窗认证未验证；同步 reparent 后 Create 的宿主查找不安全，异步接管与 close/宿主生命周期未获验证。window.open 已拒绝；未降级独立弹窗或系统浏览器。

这不是“认证通过”，也不是失败后的系统浏览器回退。没有真实 Muse/Meta 登录证据，不能宣称免重复登录。

## 本轮续做：接管与关闭语义复核

2026-11-23再次检查锁定依赖，并读取对应版本 docs.rs 的 `NewWindowResponse` 和 `WebviewEvent`。Context7连接失败；未以其失败结果或其他版本文档推断本机能力。

Wry 的网页自关闭 handler 直接销毁独立 WebView 子容器 HWND；reparent 不替换此句柄。宿主 `CloseRequested.prevent_close()` 不在此调用链上，不能用来清理已迁移认证标签。Tauri公开 `WebviewEvent` 没有自关闭通知。

这是源码事实与接口限制，不是已运行的认证弹窗实验。没有证明网页自关闭会同步清理 Rust tab 注册表，故不启用隐藏宿主接管路线。具体源码位置、最小复核命令和重新开闸条件见 [原生技术闸门](../../app/src-tauri/src/browser/GATE.md)。

本轮实际复跑：

- TypeScript类型检查、lint、34个测试、Vite构建全部通过；合成HTTP站点7个测试通过。
- `cargo fmt --check`、`cargo clippy --locked --all-targets -- -D warnings`、`cargo test --locked`（9个）、`cargo build --locked`全部通过。MSVC仍有已记录的linker stdout warning，退出码为0。
- 原始原生探测两次在侧栏账号选中等待处超时。失败快照显示原生已激活B但侧栏仍选中A；没有将超时当作隔离测试通过。
- 将侧栏的元素句柄JS点击改为 Playwright `locator.click()`，利用其挂载、稳定性与可交互检查，消除点击旧DOM节点的风险；没有延长等待、重试失败断言或修改产品行为。`node --check app/tests/e2e/native-probe.cjs`通过。
- 修改后使用两个互不复用的全新scratch资料目录，分别运行 `node app/tests/e2e/native-probe.cjs`，均退出0、6项机制检查通过。只包含A/B合成存储、同账号共享、远程管理拒绝、明确阻止新窗口和最后标签空态；**不包含成功认证**。
- 未运行延迟reparent/原生自关闭实验、真实Muse登录或跨站HTTPS认证。本轮没有新增Rust生产代码、unsafe、依赖或权限。

继续推进需要用户批准最小上游修复/固定依赖补丁的评估范围，或提供可验证的新版本能力。保持同窗认证、账号隔离与无自有unsafe的要求不变；M1—M6继续暂停。

## 尚未完成/未宣称

- 已修复并回归：同目录实例锁；壳重载布局序号握手；瞬态busy有界重试；DPI亚像素边界向内取整。原生壳重载及A/B探测复测通过。最小化时0×0客户区会导致显示请求拒绝，已显式恢复测试窗口；完整最小化/托盘生命周期仍未验收。
- 首轮原生探测因隐藏视图、侧栏/首页重复定位和异步写入等待条件失败；诊断后修正测试定位和结果等待，最终6项原生机制检查通过。未以超时或初始read文案冒充通过。
- 认证真实 opener/postMessage/close、A/B 真实 Muse 登录、休眠、应用/系统重启、托盘、删除、安装升级尚未通过人工验收。
- 历史查询、设置持久化、自动休眠和托盘仍属于后续里程碑。

M0 结论：**工程、前端契约、Rust 安全边界和普通原生标签已形成可构建基线；同窗认证闸门未通过，M1-M6 不得宣称全部完成。**

## 受控依赖评估（后续授权）

用户批准“只评估，不应用”。完成官方接口调查和scratch中的独立Wry实验，结果见[评估报告](../archive/spikes/SPIKE-m0-child-auth.md)。最终一轮底层矩阵8/8通过，覆盖真实opener/source/postMessage、自关闭、嵌套、空白后导航及来源先关闭；此前一次 `0x80070057` 创建失败未定位。

这是Wry实验，不是正式Tauri应用通过。没有应用补丁、升级生产依赖或变更权限；真实Muse认证与会话恢复仍未测，M1—M6仍暂停。报告建议先做固定版本Tauri副本实验，等待用户决定。
