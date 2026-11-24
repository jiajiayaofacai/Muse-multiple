# Muse-multiple 桌面工作台

这是批准执行计划后的首个原生工程，不是功能完整的第一版。当前为 Windows + Tauri 2.11.5 + TypeScript/Vite；版本已由锁文件固定。原计划的2.12.7候选在本机依赖解析未收敛，先使用已缓存且实际可构建的2.11.5；不能把此版本证据套用到其它版本。

Windows同窗新标签使用四个固定版本的必要本地crate补丁，不升级其他依赖。首次克隆无须下载或自动应用补丁；Cargo直接使用随工程保存的源码。来源、许可证、源码哈希及回滚说明见[vendor维护说明](src-tauri/vendor/README.md)。

## 本地开发

需要 Rust MSVC 工具链、VS Build Tools、Windows SDK、WebView2 Runtime、Node/npm。

```powershell
npm --prefix app ci
npm --prefix app run tauri dev
```

在普通浏览器打开 Vite 地址只显示“未连接原生运行时”的工作台壳，不提供假账号或假认证。原生应用冷启动显示首页，不预先打开所有账号网页。创建名称档案后点击账号可打开 Muse，账号登录状态保持为“未验证”。

**普通登录基线：** 用户在该账号的Muse原网页输入电话/邮箱、验证码及适用的两步验证码，再进入agent对话。工作台不另造认证表单、不代收验证码，不在步骤推进时重建WebView。本轮仅核对了官方初始登录页；完整原生流程待用户自行验收。详见[调研与登录基线](../specs/verifications/MUSE-LOGIN-BASELINE.md)。

**连接其他应用是另一条流程：** 用户点击连接后，在来源账号内的新授权标签完成授权，标签自动关闭，Muse原页显示连接结果。正式工程已接入真实child、来源environment及原生自关闭；合成原生15项通过。普通文章也使用来源账号normal标签；未判断所有新窗口都是认证。实际连接结果以Muse原页为准，真实服务仍待验收，见[正式接入报告](../specs/verifications/CONNECTOR-PRODUCTION-RESULTS.md)。

## 合成站点与测试

```powershell
npm --prefix app run test:sites:start
```

测试父站为 `http://127.0.0.1:4317/parent`，认证源为 `http://127.0.0.1:4318/popup`。必须从父站的 window.open 按钮触发，直接打开认证源不能证明 opener 关联。

```powershell
npm --prefix app run typecheck
npm --prefix app run lint
npm --prefix app run test
npm --prefix app run test:sites
npm --prefix app run test:connectors
npm --prefix app run build
Push-Location app/src-tauri
cargo fmt --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked
cargo build --locked
Pop-Location
```

`test:connectors` 使用本机Microsoft Edge的独立无头临时浏览器及合成站点，检查合法回调/关闭、仅关闭、错误来源/账号和重放。它不连接真实Muse，不代替原生授权测试；未安装Edge时需先明确测试环境，不把跳过记为通过。

## M0 明确限制

- **真实原页登录、账号隔离及重启恢复仍待验收，不等于普通登录依赖popup。** 启动已改为 `login_verification_pending`，不再全局BLOCKED。生产仍拒绝window.open；只对有效发起账号/标签记录 `new_window_blocked`，不更改全局登录状态。前端提示是该账号历史受限请求，不是授权成功或当前登录失败。详见[能力记录](src-tauri/src/browser/GATE.md)。
- 原生历史查询、完整网络失败回调、设置保存、自动休眠、托盘、删除/改名仍待后续阶段。未支持的操作明确提示，不伪造状态。
- 账号元数据由 Rust 保存到应用数据目录下 `m0-verification`；浏览资料按稳定 UUID 隔离。它不是浏览器 Cookie 快照切换。
- 同一资料目录使用进程生命周期独占文件锁，防止第二实例覆盖旧元数据。锁占用时明确拒绝启动。
- 控制台仅使用脱敏诊断，不记录完整地址、查询参数、聊天内容或凭据。界面地址在M0仅展示来源域。
- 当前验证版不可宣称真实 Muse 会话、重启恢复或免重复验证已经通过。

## 专用原生探测（仅调试）

`MUSE_MULTIPLE_M0_DATA_DIR` 仅在debug构建生效，用于指定独立临时资料根。`MUSE_MULTIPLE_M0_DEBUG=1` 显式开放本地CDP：壳端口9224、账号环境随机端口。**不要用于真实账号资料，不要带此开关日常运行，也不要开放到网络。** 正常启动和发布构建不主动设置这些调试端口。

`tests/e2e/native-probe.cjs` 只应连接自己刚启动的专用测试进程。须同时设置 `MUSE_M0_CDP`、`MUSE_M0_ALLOW_TEST_WRITES=1` 和相同临时数据根。它会创建合成A/B账号、写入合成存储并关闭测试标签；不是只读检查，不能连接用户日常实例。

实际结果见 [M0 验证记录](../specs/verifications/M0-RESULTS.md)；完整人工清单见 [M0-MANUAL](../specs/verifications/M0-MANUAL.md)。
