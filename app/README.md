# Muse-multiple 桌面工作台

Windows 优先的 Muse 多账号工作台。使用 Rust、Tauri 2.11.5、TypeScript 和 Vite；所有依赖以锁文件固定。普通登录在对应账号的 Muse 页面中完成，工作台不收集密码或验证码。不同账号使用稳定 UUID 对应独立 WebView2 资料目录。

## 开发启动

需要 Rust MSVC 工具链、VS Build Tools、Windows SDK、WebView2 Runtime 和 Node/npm。

```powershell
npm --prefix app ci
npm --prefix app run dev
```

然后在另一个终端启动桌面壳：

```powershell
Set-Location app/src-tauri
cargo run --locked
```

开发版必须保持 Vite 在 `127.0.0.1:1420` 运行。若此端口不可达，窗口会显示本地连接错误。Debug 构建可能同时显示控制台窗口。

冷启动进入首页，不自动打开所有账号页面。点击账号时，首次启动该账号的 Muse 页面；之后使用该账号的原生页面和标签。账号名称仅用于本机辨认；改名或备注不改变 UUID/profile 路径。

## Windows 安装包

本项目只生成 Windows MSI 安装包。构建需在 Windows 上使用已配置 Rust/Cargo 工具链：

```powershell
npm --prefix app ci
Push-Location app
npm run tauri -- build --bundles msi
Pop-Location
```

生成的 MSI 位置与构建成功与否以命令输出为准。MSI 已能构建；实际安装和启动仍须验收。

## 当前功能

- 创建本地账号档案；支持改名、备注、名称/备注搜索。
- 每账号独立原生网页标签；新建、单个关闭、关闭该账号全部标签、地址导航、后退/前进、刷新与停止。
- 仪表盘与独立诊断控制台；诊断不记录网页输入、凭据或聊天内容。
- 本机偏好保存：主题、界面/网页缩放、关闭行为和后台自动休眠分钟数。
- 固定 GitHub/使用文档链接由本地壳通过 Windows 固定系统 URL 处理器打开，不接受远程网页提供的任意 URL；进程启动成功不代表浏览器导航已完成。

关闭行为默认退出；选择托盘后隐藏主窗，可从托盘恢复或退出。若托盘初始化失败，本次运行回退为关闭退出并记录诊断。托盘点击/恢复仍需在目标 Windows 桌面环境验收。

自动休眠默认15分钟：仅回收后台且没有打开标签的账号；有网页、空白页、来源关联标签或加载中内容时均保留。暂不推断页面是否有草稿、生成或上传任务，不自动回收非空网页。手动休眠需先在其他账号页面，确认后关闭该后台账号全部标签。休眠不删除浏览资料。


账号删除按单个 UUID 执行：先关闭其标签，再暂存并清理该 profile；元数据保存失败时恢复暂存目录。文件占用导致清理失败时保留待清理资料，在设置页可按提交后的账号元数据重试，后续启动也会重试。请勿手动删除 WebView2 资料目录。

用户已报告在 Muse 原页输入邮箱和验证码后看到登录成功；该报告记为单账号登录的人工观察，不代表代理读取或验证了网页内容。A/B 独立登录、A→B→A、账号视图重建/应用重启后的恢复、失效会话重新认证仍需分项验收。网页显示、标题、HTTP 页面就绪或凭据存在均不能替代实际登录状态。

第三方应用授权与普通登录是两条流程。授权弹窗如果实际由来源网页打开，才由来源账号原生窗口接管；弹窗关闭或页面就绪都不代表授权成功，最终结果以 Muse 原页面为准。真实第三方服务仍待用户验收。

## 合成站点与统一验证

> 本轮 MSI-only 审查/复测结果（2026-11-25）：typecheck、lint、前端55项单测、HTTP站点8项、连接器夹具4项、前端build通过；cargo fmt --check、Clippy、cargo test --locked（31项通过、main/doc各0项）、cargo build --locked通过；MSI-only bundle成功。MSI尚未安装启动。真实Muse A/B、会话恢复和真实连接器验收未测。
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
cargo test --locked -j 1
cargo build --locked -j 1
Pop-Location
```

本地 HTTP 合成站点通过 `npm --prefix app run test:sites:start` 启动，父站为 `http://127.0.0.1:4317/parent`，第二来源为 `http://127.0.0.1:4318/popup`。Edge 交互测试是合成测试，不证明 WebView2 原生行为或真实 Muse 授权。

专用 `tests/e2e/native-probe.cjs` 会创建合成 A/B 账号、写入合成存储并关闭标签，只能连接新建的 scratch profile 与明确启用的专用 Debug/CDP 进程；绝不连接真实日常 profile。

## 已知限制

- Windows 是首发验证平台；macOS/Linux 尚未验证。
- 窗口托盘、关闭策略、休眠、删除恢复及固定外链的实际桌面行为需在统一验收中验证。
- Debug/Release 编译与 MSI 生成通过；MSI 尚未实际安装启动，完整 `cargo test` 的 main harness 受 Windows 链接器文件访问错误阻断。
- 真实 Muse 双账号隔离、重启恢复、注销/删除影响及第三方授权仍需用户手动验收。
- 四个 Windows 同窗连接器依赖的固定版本本地 Cargo 补丁、许可证、来源哈希和回滚方式见 [vendor 维护说明](src-tauri/vendor/README.md)。
