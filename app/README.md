# Muse-multiple · M0 原生验证版

这是批准执行计划后的首个原生工程，不是功能完整的第一版。当前为 Windows + Tauri 2.11.5 + TypeScript/Vite；版本已由锁文件固定。原计划的2.12.7候选在本机依赖解析未收敛，先使用已缓存且实际可构建的2.11.5；不能把此版本证据套用到其它版本。

## 本地开发

需要 Rust MSVC 工具链、VS Build Tools、Windows SDK、WebView2 Runtime、Node/npm。

```powershell
npm --prefix app ci
npm --prefix app run tauri dev
```

在普通浏览器打开 Vite 地址只显示“未连接原生运行时”的工作台壳，不提供假账号或假认证。原生应用冷启动显示首页，不预先打开所有账号网页。创建名称档案后点击账号可打开 Muse，账号登录状态保持为“未验证”。

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
npm --prefix app run build
Push-Location app/src-tauri
cargo fmt --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked
cargo build --locked
Pop-Location
```

## M0 明确限制

- **同窗认证技术闸门尚未通过。当前拒绝 window.open，并在控制台给出明确诊断，不跳系统浏览器或独立窗口，不伪造认证成功。** 参见 [闸门证据](src-tauri/src/browser/GATE.md)。
- 原生历史查询、完整网络失败回调、设置保存、自动休眠、托盘、删除/改名仍待后续阶段。未支持的操作明确提示，不伪造状态。
- 账号元数据由 Rust 保存到应用数据目录下 `m0-verification`；浏览资料按稳定 UUID 隔离。它不是浏览器 Cookie 快照切换。
- 同一资料目录使用进程生命周期独占文件锁，防止第二实例覆盖旧元数据。锁占用时明确拒绝启动。
- 控制台仅使用脱敏诊断，不记录完整地址、查询参数、聊天内容或凭据。界面地址在M0仅展示来源域。
- 当前验证版不可宣称真实 Muse 会话、重启恢复或免重复验证已经通过。

## 专用原生探测（仅调试）

`MUSE_MULTIPLE_M0_DATA_DIR` 仅在debug构建生效，用于指定独立临时资料根。`MUSE_MULTIPLE_M0_DEBUG=1` 显式开放本地CDP：壳端口9224、账号环境随机端口。**不要用于真实账号资料，不要带此开关日常运行，也不要开放到网络。** 正常启动和发布构建不主动设置这些调试端口。

`tests/e2e/native-probe.cjs` 只应连接自己刚启动的专用测试进程。须同时设置 `MUSE_M0_CDP`、`MUSE_M0_ALLOW_TEST_WRITES=1` 和相同临时数据根。它会创建合成A/B账号、写入合成存储并关闭测试标签；不是只读检查，不能连接用户日常实例。

实际结果见 [M0 验证记录](../specs/verifications/M0-RESULTS.md)；完整人工清单见 [M0-MANUAL](../specs/verifications/M0-MANUAL.md)。
