---
type: execution-plan
status: approved-m0-authentication-gate-blocked
context: Muse-multiple Windows-first application; M0 native baseline built; same-window authentication gate blocked
---

# Muse-multiple 正式应用执行计划

状态：**用户已批准；M0可构建基线及合成原生隔离机制检查已完成，同窗认证闸门仍阻塞**。M1—M6暂不推进；实际结果见 [M0验证记录](verifications/M0-RESULTS.md)。

## 1. 目标与完成定义

Windows 优先，使用 Rust + Tauri 2 + TypeScript，在一个工作台内管理多个 Muse for Meta（muse.ai）账号。

交付完成必须同时满足：界面符合已确认原型；每账号真实浏览资料独立；认证在账号内标签打开并正确返回；页面回收和重启后有效会话可恢复；失效时允许正常重新认证；相关自动检查与真实账号验收有记录。

当前只有静态交互原型。模拟认证成功、模拟消息、标签数组数量和 Node 状态测试不能作为原生能力证据。

## 2. 第一版范围

| 领域 | 要求 |
| --- | --- |
| 主框架 | 左上角图标与 Muse-multiple 名称；右上角依次为仪表盘、控制台、使用文档、GitHub；保留 Windows 窗口控制 |
| 首页 | 冷启动显示首页，添加入口、最近使用、已知待处理事项；不自动加载所有账号，不显示聊天内容 |
| 左侧导航 | 首页、可折叠的对话/账号列表、添加 Muse 账号、设置；当前账号高亮及文字标记；侧栏可收起；折叠时仍能辨认当前账号 |
| 账号档案 | 先填必填名称再创建；允许同名并提示；去首尾空白；支持改名、备注、搜索、右键菜单、刷新、休眠/唤醒、移除确认；名称不决定资料路径 |
| 浏览器区域 | 每账号独立标签组；自由新建/关闭全部标签，最后标签关闭为空态；地址输入、前后退、刷新/停止、网页标题、加载/失败；关闭标签不移除账号 |
| 认证与外链 | Muse 发起的认证、文章和参考资料在来源账号内新增标签；页面内跳转/重定向保留当前标签；认证不送系统浏览器 |
| 仪表盘 | 账号、驻留、休眠、标签数量及账号状态；基于真实运行状态，不虚构额度、在线状态或内存测量 |
| 控制台 | 与仪表盘分开；顶部按钮独立展开底部面板，跨页面保留开关；筛选、清屏、限量记录、脱敏诊断，不重建正在使用的网页 |
| 设置 | 关闭行为（默认退出，可选托盘）、主题（默认跟随系统）、界面与网页独立缩放、自动休眠（关闭/5/15/30 分钟，默认15）；保存失败要提示 |
| 生命周期 | 活跃账号不自动休眠；后台账号达到闲置时间才回收；认证、草稿、生成/上传等未完成工作需要保护；不确定时保守不回收 |
| 退出与恢复 | 真正退出再启动进入首页；托盘恢复返回隐藏前界面；第一次隐藏到托盘提示；托盘失败不静默隐藏 |
| 删除与重新登录 | 只处理选中账号；先关闭其全部视图和认证关联再清理资料；失败显示待清理/重试，不假报成功；服务端过期/撤销后在原账号重新认证 |
| 工作台外链 | GitHub 固定为 https://github.com/jiajiayaofacai/Muse-multiple；使用文档使用仓库中的公开指南；正式版均由受限原生接口打开系统浏览器 |

不包含：macOS/Linux 首发支持、账号云同步、明文凭据导入导出、统一聊天记录、批量发消息、自动收验证码、后台自动登录、完整通用浏览器扩展体系。下载和文件上传只在验证范围明确后支持，不把原型当作已有能力。

以下作为本计划待批准的默认取舍：休眠后从 Muse 重新加载，不持久化全部标签 URL/未发送内容；同一次运行中的热切换保留页面；主动关闭最后标签后保持空态，不因切换账号而复活；重启不恢复认证 URL。若希望恢复普通文章标签，另确认隐私和恢复范围后加入。

## 3. 项目布局与最小依赖

- `prototype/`：已确认的静态原型和状态测试，继续作为设计参考，不整体复制进生产。
- `app/`：批准后才创建正式应用，`app/src/` 为 TypeScript，`app/src-tauri/` 为 Rust。
- `app/contracts/`：最小接口契约说明与类型，由主代理维护；不做通用代码生成框架。
- `app/tests/sites/`：本地合成站点及认证回调测试夹具，无真实凭据。
- `specs/`：本计划、实际验证结果和关键决策；`docs/`：使用指南与故障排查。
- 三个参考项目仅本地使用，根 `.gitignore` 排除，不上传也不修改。

候选依赖（均须初始化时检查兼容性并锁定，以下不是已安装结果）：

| 依赖 | 必要性与约束 |
| --- | --- |
| [OK] Tauri 2 / tauri-build / tauri CLI / @tauri-apps/api | 应用壳、IPC、原生视图和托盘；以2.12.7已核对API为候选，锁定兼容补丁版本和锁文件 |
| [OK] TypeScript + Vite | 轻量前端构建；默认原生TS与模块化CSS，不先增加React或状态框架 |
| [OK] serde / serde_json / uuid | 元数据、DTO和稳定账号身份；登录材料仍由浏览引擎管理 |
| [OK] Vitest（开发） | 纯TS逻辑、桥接状态和组件行为回归；能用现有工具覆盖时不重复增加依赖 |
| [OK] Playwright（开发） | 浏览器壳交互和合成站点检查；不把浏览器测试称作原生WebView2测试 |
| [OK，按需] Tauri官方外链插件 | 仅给本地壳授权固定文档/GitHub链接；也可用安全原生API，不给远程页面通用外部启动权限 |

本机已发现 Rust/Cargo 1.97、Node 24、npm 11，子代理核对发现 VS Build Tools、Windows SDK 和 WebView2。**尚未构建新crate，是否可直接完成链接及原生自动化仍待M0实测。** 不从参考项目继承最低Rust版本。

## 4. 必须先过的技术闸门

Tauri `Window::add_child` 在核对版本中需要桌面端 `unstable` feature。`on_new_window` 的 `NewWindowResponse::Create` 接收 `WebviewWindow`，不是任意child WebView。Windows要求与opener共享environment；相同数据目录本身不足以证明正确关联。

安全API `WebviewWindowBuilder::window_features(features)` 可传递来源环境，但**这只证明原生窗口接管路线，不证明能把认证接管为同窗标签**。不能将网址复制到普通标签就声称保留 `opener/postMessage/close`。

M0必须用本地双来源站点验证同窗呈现、来源关联、回调、关闭、嵌套请求及焦点。跨来源和跨站场景分别测试；不同localhost端口不能代替所有第三方站点条件。再请用户自行完成一次真实Muse认证验证。

若同窗认证无法满足：停止后续原生功能扩展，提供最小复现、平台限制和可选路线，由用户决定。**不自行改为独立认证窗口、系统浏览器、Electron或新增自有unsafe。** 前端mock可以独立验证，但不得将其当成正式功能交付。

官方核对入口：
- [child WebView](https://docs.rs/tauri/2.12.7/tauri/window/struct.Window.html#method.add_child)
- [新窗口接管](https://docs.rs/tauri/2.12.7/tauri/webview/enum.NewWindowResponse.html)
- [window_features](https://docs.rs/tauri/2.12.7/tauri/webview/struct.WebviewWindowBuilder.html#method.window_features)
- [权限边界](https://v2.tauri.app/security/capabilities/)
- [WebView2资料及清理](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/user-data-folder)

## 5. 执行顺序与逐步验收

用户已批准本计划。M0 开始执行，M1—M6待技术闸门通过后推进；技术闸门失败时必须暂停并重新确认路线。

| 阶段 | 依赖/风险 | 实施与交付 | 验收方式 |
| --- | --- | --- | --- |
| M0 工程与关键验证 | 批准后；P0 | 建立最小app、工具链/权限基线、锁版本；验证两账号资料与同窗多视图、认证新窗口接管；冻结最小DTO；同时准备无真实资料的测试站点 | `npm --prefix app run build`、Rust检查；本地原生场景及用户手动真实认证记录；必须同窗标签满足要求 |
| M1 账号档案垂直切片 | M0；P0 | 创建UUID、Rust可信根目录映射、原子保存、重命名/备注/搜索、名称验证和取消不创建；重启找回同一资料 | Rust临时目录测试＋TS测试；改名排序路径不变，非法ID及任意路径拒绝，元数据损坏明确报错 |
| M2 原生自由标签 | M0契约；P0 | 原生注册表归属account/tab，创建/导航/切换/全部关闭；popup按来源处理，不能根据当前所选账号猜来源；草稿关闭确认 | A→B→A，标签数量/选中位置/网页身份正确；来源关闭回调不复活；最后标签空态；前进后退、URL协议边界 |
| M3 正式界面与仪表盘/控制台 | M0契约，可与M1/M2并行；P1 | 首页、侧栏、账号交互和标签栏、仪表盘真实状态、独立日志、加载/错误/空态；接入Rust快照而非演示ready | TS类型/单测/构建＋壳浏览器E2E；控制台不重载网页；原生视图在DPI/缩放/弹窗/侧栏布局中不遮挡本地UI |
| M4 设置、休眠与托盘 | M1/M2公共接口后；P0 | Rust后台计时、15分钟默认、认证关联链保护、未知工作保护及手动保持活动；设置保存、关闭/托盘；醒来复用浏览资料 | 可控时钟单测；原生销毁重建；托盘失败不丢窗口；退出再启动首页；真实草稿/生成/上传行为实测 |
| M5 删除、安全与恢复 | M1/M2/M4；P0 | 仅删除指定账号，清理失败可重试；登录过期与断网区分；本地壳权限、远程IPC拒绝、脱敏错误和日志 | A删除而B可用；文件占用不假报成功；恶意远程页不能管理账号/读文件；账号删除后的迟到事件不复活 |
| M6 整体交付 | M1—M5；P0 | Windows安装包、GitHub/文档系统打开、真实账号矩阵、2/5/10账号资源记录、升级路径、使用指南 | 全套质量检查＋Windows安装/启动/重启/升级；验收结果记录通过/失败/未测，不把未测视为通过 |

M1—M3按可运行切片整合，不能先做完所有UI再一次性接Rust。每个切片都有失败态、测试和对应提交。

## 6. 多子代理并行方案

主代理统一维护 `app/package.json`、锁文件、`app/contracts/`、前端入口/路由、`Cargo.toml`、Tauri配置/permissions/capabilities、原生启动注册、CI及Git。子代理不修改这些共享文件，依赖变化由主代理串行加入。

| 并行泳道 | 独占可写目录（拟建） | 职责与交付 |
| --- | --- | --- |
| A 原生浏览运行时 | `app/src-tauri/src/browser/` | 标签与账号归属、创建/销毁/激活、导航、新窗口与认证关联；提出需要的启动接线，不改根配置 |
| B 本地数据与桌面生命周期 | `app/src-tauri/src/accounts/`、`storage/`、`lifecycle/`、`desktop/` | UUID资料映射、设置、原子写、休眠、删除编排、托盘；通过A的冻结接口调用，不直接改视图注册表 |
| C TypeScript界面 | `app/src/shell/`、`features/`、`ui/`、`bridge/` | 正式UI、状态机与原生适配、焦点/布局上报、可访问性；不修改契约和Rust模块 |
| D 测试夹具（需要时） | `app/tests/sites/`、`app/tests/e2e/`、`specs/verifications/` | 合成认证/隔离站点、壳E2E、验收记录；不能替代运行时实现，不接触真实资料 |

- 第一轮：A核对同窗认证可行性；C按最小契约做壳；D准备合成站点，可同时执行。主代理创建最小工程和接口后才启动写入代理。
- M0通过后：A做原生标签，B做本地存储，C做UI接入，三路同时开发；生命周期依赖A/B接口的部分后置。
- 每轮收敛：子代理报告改动文件、已跑命令、已知限制；主代理整合并验证，再提交推送。禁止同文件并发修改、重复实现或递归委派。
- 测试代理与实现代理只有目录独立时并行。一次集成结束最多做一轮独立只读审查，具体缺陷修复复测即可，不循环扩大审查。

## 7. 最小接口契约（M0冻结）

- `AccountDto { id, name, note, lastUsedAt }`，不向前端暴露任意磁盘路径或凭据。
- `TabDto { id, accountId, openerTabId?, purpose, title, displayUrl, loadState, canGoBack, canGoForward }`；认证地址脱敏，不保存敏感回调。
- `AccountRuntime { accountId, lifecycle, sessionStatus, activeTabId?, protectionReasons }`；生命周期与会话有效性分开，未知不能报已登录。
- `SettingsDto { closeBehavior, theme, uiZoomPercent, webZoomPercent, autoSleepMinutes }`，Rust再校验合法值。
- `WorkspaceSnapshot { revision, accounts, tabs, runtimes, settings }`。先订阅后取快照，旧revision丢弃；事件不复活已删除账号或标签。
- 命令分组：快照；账号增改删；标签增关切/导航/历史/刷新；工作区显隐/布局；休眠唤醒；设置；受限文档/GitHub外链。
- 错误 `CommandError { code, safeMessage, retryable, accountId?, tabId? }`；命令已受理与真正完成必须区分。
- 事件先采用 `workspace_changed` 快照与 `diagnostic_logged`，异步失败另有明确结果；不先造复杂事件总线。
- TS报告逻辑像素边界和布局序号，Rust校验并协调原生WebView与本地弹窗/控制台。不能用CSS遮挡假设覆盖原生视图。
- 所有管理命令限制为本地壳；远程Muse/Meta/文章页默认无权限，Rust同时验证调用来源、参数及资源归属，不能只依赖前端隐藏按钮。

## 8. 检查命令与证据层级

现在已存在、可运行的检查（仓库根目录）：

```powershell
node --check .\prototype\app.js
node .\prototype\state.test.cjs
```

以下**批准并创建app之后才可运行**，M0需在实际 `app/package.json` 中创建对应脚本，不能提前称为通过：

```powershell
npm --prefix app run typecheck
npm --prefix app run lint
npm --prefix app run test
npm --prefix app run build
npm --prefix app run test:e2e:ui
Push-Location .\app\src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
Pop-Location
```

原生自动化先验证Windows/WebView2驱动链路，再决定可运行的原生检查脚本；普通Playwright页面测试不能证明原生认证。M0及M6提供操作清单、运行环境和结果，而不是编造一个不存在的原生通过命令。

真实账号人工验收由用户自己输入密码/验证码，不写入夹具、截图日志或报告。至少覆盖：A/B分别登录；A→B→A；同账号多标签；真实认证和文章新标签；关闭来源页；关闭最后标签；15分钟后台回收/认证保护；页面重建；应用/系统重启；托盘；单账号退出和删除；失效后重新认证；断网重试；升级保留资料。

可恢复错误使用Result与上下文，Rust自有代码默认禁unsafe。资料清理必须验证实际完成；WebView关闭或异步清理API返回不证明数据已落盘/删除。不得杀全局Edge/WebView2进程来强行释放一个账号。

## 9. Git提交与远程同步

公开仓库：`https://github.com/jiajiayaofacai/Muse-multiple`。默认主分支main，当前准备阶段使用 `chore/project-bootstrap`。

1. 每轮明确范围改动结束：收敛子代理、检查diff和暂存清单、扫描敏感信息、运行相关检查。
2. 使用Conventional Commits提交，立即 `git push -u origin <当前功能分支>`；这就是“每次改动完成同步”，不是等整个项目完成才推送。
3. 推送后比较本地HEAD与远程分支SHA，确认真正同步。推送失败保留本地提交并报告，不强推、不隐藏失败。
4. 完成里程碑后通过PR合入main；未批准的计划保留待审批状态，不因推送就视为批准。所有分支提交由主代理执行。
5. 不提交参考源码、真实浏览资料、凭据、日志、索引数据库、依赖及构建产物；公开仓库提交使用GitHub noreply邮箱，不改全局身份配置。

## 10. 当前审批点

用户已明确批准本计划并要求开始开发。按 M0 启动多个独立目录子代理，先交付原生可运行验证版及证据，不将浏览器壳测试冒充原生验收。

Windows优先、原生TS/Vite、同窗认证技术闸门、休眠不持久化认证/文章URL、按泳道并行和每轮提交推送作为已批准基线。若技术闸门不能通过，停止并请求变更批准。
