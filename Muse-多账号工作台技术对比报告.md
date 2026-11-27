# Muse 多账号工作台技术对比报告

## 选型结论

**以 Muse Panel 为架构主参考。** 用户在各自的 WebView 内按 Muse for Meta（`muse.ai`）流程登录。Rust 为每个账号分配稳定的、本机持久化的 WebView 存储。TypeScript 负责账号列表、当前账号和布局。切换只改变显示的 WebView，释放页面时保留对应的存储。这样可以避免因工作台切换而重复登录，服务端仍可按原有规则要求重新认证。

| 项目 | 管理与切换方式 | 会话/隔离模型及限制 | 对 Rust + Tauri + TypeScript 的参考价值 |
| --- | --- | --- | --- |
| **Muse Panel** | Electron 桌面版支持分组、多列并排、隐藏与休眠；Swift iOS 版提供单页切换、预热与回收 | 桌面版按账号 ID 绑定持久化 partition；休眠卸载视图，再用同一 partition 重载。服务端仍可能要求重新认证；重启后的会话有效性不能由 README 保证 | **高。** 参考稳定账号绑定、视图生命周期和账号删除边界；Electron partition 不等于 Tauri API |
| **Muse Account Switcher** | Chromium 扩展保存 Cookie/Web Storage 快照，切换时清理目标存储、恢复快照并重载标签 | 属于同一浏览器资料内的覆盖式切换，多标签共享同一环境；IndexedDB 是可选实验，Web Storage 依赖目标 origin 和当前标签 | **中。** 用于了解存储种类、来源域和快照失败场景；不适合实现同窗并行独立账号 |
| **muse2api** | Python/FastAPI 服务把 Muse 网页能力封装成 API，含服务端账号池、调度、任务、管理面板和 Chromium/CDP 驱动 | Store 将账号 Cookie 等写入服务端 JSON；Engine 为生成操作创建并销毁 CDP BrowserContext。这个按操作上下文隔离不是桌面工作台按账号长期持有的可见 WebView/profile | **局部参考。** 可学习账号租约、并发调度、资源清理、会话诊断和失败回归测试；不照搬服务端持有Cookie、账号导入或无头浏览器架构 |
| **rust-anything** | Rust 迁移工具执行分析、桥接、记录、回放、差异比较和门槛检查；`enable/disable` 指实现切换 | 不提供 Muse 账号管理、WebView 会话隔离或登录恢复能力；回放只覆盖记录输入 | **Rust工程实践有参考价值，业务架构无参考价值。** 可借鉴职责拆分、错误边界、先写回归测试、有界外部进程和fmt/Clippy/test验证 |

本报告对照 Muse Panel、Muse Account Switcher、muse2api 三个 Muse 产品/服务项目，以及 rust-anything Rust 工程参考。CodeGraph 0.9.7 已为 `muse2api-main/muse2api-main/` 建立索引：扫描53个文件，状态统计53 files、1,587 nodes、3,365 edges，数据库3,334,144字节，`pendingChanges` 为0；索引位于被忽略的项目内`.codegraph/`。查询结果用于源码导航，不代表服务已运行或认证已实测。

下文将项目文档声明、当前源码事实和待实测假设分开。Muse最新登录链路、服务端会话寿命及Windows真实账号恢复仍未通过本次CodeGraph或静态阅读验证。目标平台以当前Windows作为首个验证环境。

2026-11-23登录流程更正：用户明确普通登录的电话/邮箱、验证码和可选两步验证都在原网页完成，完整流程未由代理实测，见[网页登录基线](specs/verifications/MUSE-LOGIN-BASELINE.md)。后续用户补充连接器新授权标签场景，并在隔离验证后批准正式接入；正式工程现已通过合成原生回调/自关闭/隔离15项，见[正式接入结果](specs/verifications/CONNECTOR-PRODUCTION-RESULTS.md)。不能将该结果当作真实登录、第三方连接成功或重启恢复已验收。

## Muse Panel：每个账号拥有自己的浏览资料

**桌面版。** 添加账号时创建本地账号 ID，用户在新列中亲自登录。账号的显示名、分组、排序等保存在 `config.json`。WebView 用 `persist:muse-<id>` 绑定自己的 Electron Session，站点数据由 Chromium 落盘。分组切换和排序使用稳定的组件实例和 CSS 顺序。账号仍在内存里时，切回来通常保留原页面和表单状态。手动休眠或达到分组自动休眠条件后，WebView 被卸载。重新打开使用相同 partition，页面重新加载，持久化且仍有效的登录数据可继续使用。应用和电脑重启属于同一类冷恢复，但进程内状态、未保存表单等不能靠 partition 保证恢复。删除分组会迁移其中的账号，删除账号则会请求清除该账号的浏览数据。 [添加、删除与休眠逻辑](X:/python-code/Muse-multiple/muse-panel-main/muse-panel-main/src/renderer/src/App.tsx:165) · [WebView 创建](X:/python-code/Muse-multiple/muse-panel-main/muse-panel-main/src/renderer/src/components/AccountColumn.tsx:116) · [Electron Session](https://www.electronjs.org/docs/latest/api/session#sessionfrompartitionpartition-options)

**参考项目的新窗口支持。** Electron主进程允许代码列出的Muse与Meta相关站点沿用来源账号partition打开弹窗，其他弹窗交系统浏览器。这是参考源码行为，不证明Muse当前普通登录会弹窗，也不代表本工作台应采用相同外链策略。仅在真实出现连接器认证或其他新窗口时，验证Cookie、回调与opener均归发起账号；普通登录按原网页流程验证。 [弹窗规则](X:/python-code/Muse-multiple/muse-panel-main/muse-panel-main/src/main/index.ts:66) · [账号清除处理](X:/python-code/Muse-multiple/muse-panel-main/muse-panel-main/src/main/index.ts:153)

**iOS 版。** 每个账号 UUID 对应一个 `WKWebsiteDataStore(forIdentifier:)`。账号切换复用仍在池中的 WKWebView。自动保留上限为 2 个（含当前页），手动常驻项有独立策略。挂起、内存回收或超出缓存时，可以卸载页面并在原数据存储中重建。冷切换使用截图过渡，截图只改善显示。源码用 Cookie 是否存在及页面回报标记账号是否登录过，这个标记无法证明服务器此刻仍接受会话。添加后未登录即切出的草稿还可能被自动丢弃。删除账号会释放视图并尝试删除对应数据存储。 [视图复用与回收](X:/python-code/Muse-multiple/muse-panel-main/muse-panel-main/ios/MusePanel/WebViewPool.swift:43) · [独立数据存储](X:/python-code/Muse-multiple/muse-panel-main/muse-panel-main/ios/MusePanel/WebViewPool.swift:121) · [切换、挂起、删除](X:/python-code/Muse-multiple/muse-panel-main/muse-panel-main/ios/MusePanel/AppModel.swift:68) · [登录过的状态标记](X:/python-code/Muse-multiple/muse-panel-main/muse-panel-main/ios/MusePanel/AccountStore.swift:95)

**何时仍需登录。** 首次添加；账号或资料被删除、清除或重建到新位置；站点的关键登录材料属于只在当前会话或页面生命周期内有效的状态，关闭或重启后又无法正常恢复；用户退出、凭据失效、服务端撤销会话或要求再次验证。README 写明重启后保留登录，这是设计预期，验收时应以页面实际身份和可用性为准。 [项目说明](X:/python-code/Muse-multiple/muse-panel-main/muse-panel-main/README.md:24)

## Muse Account Switcher：同一浏览器资料中的快照切换

**账号管理。** 首次仍按站点流程登录，用户主动保存并命名档案，可备注、改名、删除或手动更新。默认记录 `muse.ai` 域下 Cookie（包括 API 可读取的 HttpOnly Cookie），从选中的 Muse 标签页采集当前来源的 `localStorage` 和 `sessionStorage`。可选 Meta 功能需额外权限，扩展覆盖 `facebook.com`、`meta.ai` 的 Cookie，默认关闭。IndexedDB 快照及切换时清除是两个独立选项，均默认关闭。 [存储范围与开关](X:/python-code/Muse-multiple/muse-switcher-main/muse-switcher-main/README.md:36) · [保存实现](X:/python-code/Muse-multiple/muse-switcher-main/muse-switcher-main/background.js:322)

**切换与保留。** 切换先清除目标域范围的现有状态，再恢复选中的快照并重载一个标签页。其他同一资料里的标签页共享 Cookie，可能在后续请求中使用切换后的身份。代码没有在切换前自动保存离开的账号，也没有用认证结果确认登录恢复成功。续期后的最新状态需要手动覆盖旧档案。无 Muse 标签页时，代码新建标签页后提前返回，仅已恢复的 Cookie 可用。保存时记录了来源域，恢复代码将 Web Storage 写入当前找到的标签页，未比对保存的来源域。若保存和恢复落在 `muse.ai`、`auth.muse.ai` 两个不同来源，恢复的数据可能无法在预期页面使用。默认不清除 IndexedDB 也会留下前一账号的站点数据库。启用快照时仍有序列化和兼容性边界，例如 Blob 或 File 无法无损还原。 [找标签、采集来源与切换](X:/python-code/Muse-multiple/muse-switcher-main/muse-switcher-main/background.js:284) · [档案更新与清空](X:/python-code/Muse-multiple/muse-switcher-main/muse-switcher-main/background.js:441)
**何时仍需登录。** 如果快照不完整、Cookie恢复失败、站点要求重新验证，或目标标签缺失且对应origin存储无法恢复，应回到站点正常登录流程。Switcher README把设备绑定列为可能解释，这只是项目说明，并非已核实的服务端规则；快照恢复不等于认证成功。 [README说明](X:/python-code/Muse-multiple/muse-switcher-main/muse-switcher-main/README.md:62-74)

## rust-anything：Rust工程实践参考

该仓库是Rust编写的迁移工具，不是Muse账号/WebView项目。源码与规范显示可参考的做法是：按职责组织模块（`src/lib.rs:10-72`）；小改动先写旧实现会失败的回归测试，并按单元、循环/桥接、原生和全应用分层（`CONTRIBUTING.md:55-69`）；新增或收尾时运行`cargo fmt`、`cargo clippy --all-targets -- -D warnings`、`cargo test`，有行为变化时更新状态说明（`CLAUDE.md:5-7`、`CONTRIBUTING.md:110-126`）；以`Result`/上下文报告失败并给外部命令设超时、关闭stdin、限定输出（`src/process.rs:31-50,58-90`）；区分fixture测试、真实项目验证、跳过和未测试（`docs/STATUS.md:3-8`）。

`DECISIONS.md`记录设计理由和可复审取舍；`docs/pitfalls.md`记录真实踩坑，例如测试覆盖遗漏、外部命令超时及路径相对工作目录的问题。工作台应将这些转化为本地可执行测试、受信任账号ID/路径边界、明确错误和有界原生操作。rust-anything自身也有大量FFI/codegen/桥接实现；它们服务于代码迁移产品，**不是**工作台所需能力，不能因为参考工程包含就增加依赖或`unsafe`。

## muse2api：服务端API与账号池，不是桌面账号工作台

本地项目源码以Python为主，另含JavaScript扩展、HTML管理面板及Docker/systemd部署；没有Rust crate。README自述将muse.ai网页端对话、生图、生视频包装为OpenAI兼容API，并提供管理页、账号池和扩展（`muse2api-main/muse2api-main/README.md:58-94`）；这是项目文档描述，本轮没有启动服务或接入Muse验证。

- **入口与层次。** FastAPI入口`app.py`组装`Config`、`Store`和`MuseEngine`，定义API及管理路由（`app.py:51-92,1629-1630,1954-2037`）。Engine经CDP控制无头Chromium（`engine.py:313-327,364-416`）。
- **账号与并发。** Store将账号和任务JSON持久化，并原子替换文件；公共账号视图省略Cookie和代理秘密（`store.py:76-96,110-147`）。账号池管理器管理总并发槽位和每账号租约，避免同账号并发互相踩踏（`app.py:95-188`）。`_account_operation`在维护时加租约、快照账号配置，最终关闭页面、清本地代理快照并释放租约；CodeGraph显示其调用方包括代理检测、会话探测与重登（`app.py:194-234`）。可借鉴租约、资源释放和请求快照的回归测试，不直接复用全局调度实现。
- **隔离语义。** Store写入上游Cookie（`store.py:110-131`）；Engine通过`Target.createBrowserContext`创建上下文、`Target.createTarget`新建页面，操作结束调用`Target.disposeBrowserContext`（`engine.py:465-538`）。这是服务端生成操作的短生命周期隔离，不是每个用户账号持有、跨销毁/重启复用的桌面浏览资料。不得把BrowserContext隔离当作工作台稳定资料/真实登录恢复证据。
- **测试与安全提示。** 项目有代理路由、并发、会话健康、Cookie要求及媒体等Python/Node测试；例如代理测试断言秘密不进入公开响应、忙账号不能修改配置、代理失败不假报会话成功（`tests/test_account_proxy_routing.py:20-49,75-105,120-134`）。测试以隔离临时目录和合成数据为例，值得参考其“副作用不泄漏到账号状态”的断言。Cookie导入、服务器JSON存储、无头自动化、代理/云端保活和在线升级都不直接符合本工作台的最小权限与用户本地可见浏览资料模型。

## CodeGraph索引与源码查询

已实际使用CodeGraph 0.9.7为`muse2api-main/muse2api-main/`初始化并索引：53个扫描文件、1,587节点、3,365边；数据库3,334,144字节，`pendingChanges=0`。项目含Python、JavaScript和YAML，索引留在本地且被根`.gitignore`排除。查询`MuseEngine`定位`engine.py:313`、`chat_completions`定位`app.py:1629`；查询`_account_operation`得到5个调用点及5类被调资源。CodeGraph关系图用于定位与导航，结论再对照源码阅读；它不运行服务、不证明Muse登录/授权，也不自动验证行为。

可复用命令（均针对真实嵌套源码目录）：

```powershell
codegraph status --json .\muse2api-main\muse2api-main
codegraph query MuseEngine --path .\muse2api-main\muse2api-main --limit 12
codegraph callers _account_operation --path .\muse2api-main\muse2api-main --limit 20
codegraph callees _account_operation --path .\muse2api-main\muse2api-main --limit 20
codegraph files --path .\muse2api-main\muse2api-main --filter tests --format grouped
```

## Tauri 工作台的实现取舍

- **Windows。** 正式工程实际锁定Tauri 2.11.5 / tauri-runtime 2.11.3 / runtime-wry 2.11.4 / Wry 0.55.1，并对四个必要crate做固定本地补丁（来源、许可证、哈希及边界见[vendor说明](app/src-tauri/vendor/README.md)）。Rust以稳定UUID映射每账号独立`data_directory`，用可见子WebView管理页面；本地合成验证已覆盖账号存储隔离和连接器child生命周期，不等于真实Muse会话跨重启已验收。WebView2也支持一个UDF内多个原生Profile；是否改用须以工作台内存/隔离测量和当前锁版本API评估，不从Electron partition直接推导。 [Tauri 2.11.5 WebviewBuilder](https://docs.rs/tauri/2.11.5/tauri/webview/struct.WebviewBuilder.html) · [WebView2 UDF](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/user-data-folder) · [WebView2多Profile](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/multi-profile-support)
- **macOS。** 如果需要支持 macOS，在 14 及以上用 `data_store_identifier([u8; 16])` 绑定稳定的账号标识，保持非隐私模式。WKWebView 用的是系统数据存储，Electron 的 partition 目录结构不能直接套用。更早的 macOS 和 Linux 如需纳入支持范围，应分别验证隔离与持久化，再承诺支持。 [Tauri 数据存储标识](https://docs.rs/tauri/2.12.7/tauri/webview/struct.WebviewBuilder.html#method.data_store_identifier)
- **单窗切换与弹窗。** 正式工程以原生child WebView在同一shell窗口显示/隐藏账号内标签；Windows connector child复用真实来源environment及opener，新窗口归属与自关闭已作合成原生验证。文档和系统浏览器链接仍按各自固定策略处理；不能把所有新窗口猜成认证。macOS/Linux的多视图和来源配置尚未实现或本轮验证，不据Windows结果承诺支持。 [Tauri 2.11.5 NewWindowResponse](https://docs.rs/tauri/2.11.5/tauri/webview/enum.NewWindowResponse.html) · [M0正式接入结果](specs/verifications/CONNECTOR-PRODUCTION-RESULTS.md)
- **认证归属与权限。** 本地TypeScript界面持有有限账号管理指令；远程Muse/Meta页面无本地文件、系统命令或账号管理权限。Windows connector child复用来源WebView2 environment；其他平台需按对应runtime API单独评估。 [Tauri 2.11.5权限模型](https://v2.tauri.app/security/capabilities/)

## 验收清单

| 优先级 | 场景 | 通过标准 |
| --- | --- | --- |
| P0 | 两个测试账号分别在自己的Muse原网页完成电话/邮箱、验证码及适用两步验证 | A、B各自进入对话，B完成后A仍可用；不因验证步骤重建视图。若另遇真实新窗口，再单列来源关联场景，不预设普通登录必有弹窗 |
| P0 | A → B → A，先顺序切换，再测试并行加载 | 每次都显示正确身份。热切换不重载，仍有效的会话不再要求验证码。不存在短暂显示另一账号内容的情况 |
| P0 | 关闭一个 WebView 后重建，退出工作台并重新打开，重启系统，再从旧安装包升级 | 分别记录是否重载、是否仍登录和实际账号身份。能区分仅内存里的页面状态、浏览资料中的持久化状态和系统重启后的实际结果 |
| P0 | 在 A 中显式退出并另测在应用内移除 A，再添加 A | B 仍正常，A 的账号元数据与浏览资料按对应操作预期处理。退出 A 应引导正常重登，移除后重新添加 A 应视为新资料。若服务端存在联动撤销，记录实际影响 |
| P0 | 真实会话过期或站点要求重新认证；对照断网或页面加载失败 | 仅在当前账号提示需要重新验证。断网单独显示可重试的加载错误。不会覆盖、清除或替换其他账号的资料 |
| P1 | 2、5、10 个账号，分别测热切换、冷恢复、并排及长时间闲置 | 记录内存、磁盘与切换延迟，确定驻留上限。目标平台验收通过后再给出账号容量建议 |

验收先验证“每个账号只需在其本地资料里完成一次正常登录，之后有效会话可跨切换和重启继续使用”。真实账号的服务端失效、强制验证和跨运行时差异分别记录。源码静态检查可在工作区根目录运行下面的 CodeGraph 查询，确认相关符号仍存在。此检查不覆盖真实登录。

```powershell
codegraph status --json .\muse2api-main\muse2api-main
codegraph callers _account_operation --path .\muse2api-main\muse2api-main --limit 20
codegraph query WebViewPool --path .\muse-panel-main\muse-panel-main --limit 10
codegraph query doSwitch --path .\muse-switcher-main\muse-switcher-main --limit 10
codegraph query process --path .\rust-anything-main\rust-anything-main --limit 10
```
