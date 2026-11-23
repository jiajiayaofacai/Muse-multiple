# Muse 多账号工作台技术对比报告

## 选型结论

**以 Muse Panel 为架构主参考。** 用户在各自的 WebView 内按 Muse for Meta（`muse.ai`）流程登录。Rust 为每个账号分配稳定的、本机持久化的 WebView 存储。TypeScript 负责账号列表、当前账号和布局。切换只改变显示的 WebView，释放页面时保留对应的存储。这样可以避免因工作台切换而重复登录，服务端仍可按原有规则要求重新认证。

| 项目 | 管理与切换方式 | 切回及重启后的登录状态 | 对 Rust + Tauri + TypeScript 的参考价值 |
| --- | --- | --- | --- |
| **Muse Panel** | Electron 桌面版支持分组、多列并排、隐藏和休眠。Swift iOS 版提供单页账号切换、预热与回收 | 每个账号保留独立的持久化存储。已加载页面可直接切回，回收或重启后可在原存储中重载，前提是必要的登录材料仍在且有效 | **高。** 借鉴账号与存储的稳定绑定、页面生命周期、弹窗归属和删除行为 |
| **Muse Account Switcher** | Chromium 扩展保存多份档案，切换时清除并替换同一浏览器资料里的站点状态，再刷新目标标签页 | 有效且完整的快照可免重复验证。跨重启保存的是扩展档案，原浏览器会话和快照恢复效果分别取决于浏览器与站点 | **中。** 用来了解登录涉及的存储、来源域与失败场景。共享资料内覆盖状态不适用于同窗独立并行 |
| **rust-anything** | 通过记录、回放和差异比对逐步替换代码单元。工具中的切换指原实现与 Rust 实现之间切换 | 本次检查的项目入口和文档没有提供 Muse 账号管理、WebView 会话隔离或登录恢复能力 | **工程方法中等，会话设计低。** 借鉴回归测试与分步迁移，尤其适合本地可控、可重复执行的逻辑 |

本报告依据三个本地项目的 CodeGraph 索引、关键源码和官方 API 文档。Muse 最新的登录链路、服务端会话寿命和 Windows 安装包行为尚未使用真实账号验证。目标平台未指定，以下将当前 Windows 环境作为首个验证平台。

## Muse Panel：每个账号拥有自己的浏览资料

**桌面版。** 添加账号时创建本地账号 ID，用户在新列中亲自登录。账号的显示名、分组、排序等保存在 `config.json`。WebView 用 `persist:muse-<id>` 绑定自己的 Electron Session，站点数据由 Chromium 落盘。分组切换和排序使用稳定的组件实例和 CSS 顺序。账号仍在内存里时，切回来通常保留原页面和表单状态。手动休眠或达到分组自动休眠条件后，WebView 被卸载。重新打开使用相同 partition，页面重新加载，持久化且仍有效的登录数据可继续使用。应用和电脑重启属于同一类冷恢复，但进程内状态、未保存表单等不能靠 partition 保证恢复。删除分组会迁移其中的账号，删除账号则会请求清除该账号的浏览数据。 [添加、删除与休眠逻辑](X:/python-code/Muse-multiple/muse-panel-main/muse-panel-main/src/renderer/src/App.tsx:165) · [WebView 创建](X:/python-code/Muse-multiple/muse-panel-main/muse-panel-main/src/renderer/src/components/AccountColumn.tsx:116) · [Electron Session](https://www.electronjs.org/docs/latest/api/session#sessionfrompartitionpartition-options)

**登录弹窗。** Electron 主进程允许代码中列出的 Muse 与 Meta 相关站点打开弹窗，并让它们沿用来源账号的 partition。其他弹窗交给系统浏览器处理。工作台移植时，首先验证真实认证弹窗的 Cookie、回调和 `opener` 行为都归属于发起登录的账号。认证弹窗误开到默认资料时，可能出现登录完成后原页面仍提示登录，或弹窗选中了另一个账号。 [弹窗规则](X:/python-code/Muse-multiple/muse-panel-main/muse-panel-main/src/main/index.ts:66) · [账号清除处理](X:/python-code/Muse-multiple/muse-panel-main/muse-panel-main/src/main/index.ts:153)

**iOS 版。** 每个账号 UUID 对应一个 `WKWebsiteDataStore(forIdentifier:)`。账号切换复用仍在池中的 WKWebView。自动保留上限为 2 个（含当前页），手动常驻项有独立策略。挂起、内存回收或超出缓存时，可以卸载页面并在原数据存储中重建。冷切换使用截图过渡，截图只改善显示。源码用 Cookie 是否存在及页面回报标记账号是否登录过，这个标记无法证明服务器此刻仍接受会话。添加后未登录即切出的草稿还可能被自动丢弃。删除账号会释放视图并尝试删除对应数据存储。 [视图复用与回收](X:/python-code/Muse-multiple/muse-panel-main/muse-panel-main/ios/MusePanel/WebViewPool.swift:43) · [独立数据存储](X:/python-code/Muse-multiple/muse-panel-main/muse-panel-main/ios/MusePanel/WebViewPool.swift:121) · [切换、挂起、删除](X:/python-code/Muse-multiple/muse-panel-main/muse-panel-main/ios/MusePanel/AppModel.swift:68) · [登录过的状态标记](X:/python-code/Muse-multiple/muse-panel-main/muse-panel-main/ios/MusePanel/AccountStore.swift:95)

**何时仍需登录。** 首次添加；账号或资料被删除、清除或重建到新位置；站点的关键登录材料属于只在当前会话或页面生命周期内有效的状态，关闭或重启后又无法正常恢复；用户退出、凭据失效、服务端撤销会话或要求再次验证。README 写明重启后保留登录，这是设计预期，验收时应以页面实际身份和可用性为准。 [项目说明](X:/python-code/Muse-multiple/muse-panel-main/muse-panel-main/README.md:24)

## Muse Account Switcher：同一浏览器资料中的快照切换

**账号管理。** 首次仍按站点流程登录，用户主动保存并命名档案，可备注、改名、删除或手动更新。默认记录 `muse.ai` 域下 Cookie（包括 API 可读取的 HttpOnly Cookie），从选中的 Muse 标签页采集当前来源的 `localStorage` 和 `sessionStorage`。可选 Meta 功能需额外权限，扩展覆盖 `facebook.com`、`meta.ai` 的 Cookie，默认关闭。IndexedDB 快照及切换时清除是两个独立选项，均默认关闭。 [存储范围与开关](X:/python-code/Muse-multiple/muse-switcher-main/muse-switcher-main/README.md:36) · [保存实现](X:/python-code/Muse-multiple/muse-switcher-main/muse-switcher-main/background.js:322)

**切换与保留。** 切换先清除目标域范围的现有状态，再恢复选中的快照并重载一个标签页。其他同一资料里的标签页共享 Cookie，可能在后续请求中使用切换后的身份。代码没有在切换前自动保存离开的账号，也没有用认证结果确认登录恢复成功。续期后的最新状态需要手动覆盖旧档案。无 Muse 标签页时，代码新建标签页后提前返回，仅已恢复的 Cookie 可用。保存时记录了来源域，恢复代码将 Web Storage 写入当前找到的标签页，未比对保存的来源域。若保存和恢复落在 `muse.ai`、`auth.muse.ai` 两个不同来源，恢复的数据可能无法在预期页面使用。默认不清除 IndexedDB 也会留下前一账号的站点数据库。启用快照时仍有序列化和兼容性边界，例如 Blob 或 File 无法无损还原。 [找标签、采集来源与切换](X:/python-code/Muse-multiple/muse-switcher-main/muse-switcher-main/background.js:284) · [档案更新与清空](X:/python-code/Muse-multiple/muse-switcher-main/muse-switcher-main/background.js:441)

**何时仍需登录。** 如果只是目标标签页缺失且站点仍接受原快照，重新切换可能补齐 Web Storage。若没有完整的快照，Cookie 恢复失败、快照过期、缺少当前登录链路依赖的来源数据，或站点明确要求验证码、二次验证或重登，则回到正常登录流程。README 将设备绑定列为可能原因，实际规则尚未核实。快照和导出 JSON 含可用的会话凭据。工作台可借鉴它检查存储范围和错误分支的方式，产品的数据模型应让 WebView 引擎管理登录材料，避免复制到工作台配置、日志或导出文件。 [快照限制与凭据处理说明](X:/python-code/Muse-multiple/muse-switcher-main/muse-switcher-main/README.md:45)

## rust-anything：借鉴迁移验证方法

该项目是 Rust 渐进迁移工具，主要流程是记录原实现行为、实现 Rust 单元、回放并比较，再根据门槛决定启用或回退。仓库中的 ESLint 和 Prettier 等属于迁移案例。CLI 入口和项目文档没有呈现 Muse 账号列表、独立浏览资料或认证流程。因此，账号切换是否保留登录、何时要求重登，在这个项目里均不适用。 [项目流程](X:/python-code/Muse-multiple/rust-anything-main/rust-anything-main/README.md:44) · [CLI 的实现切换](X:/python-code/Muse-multiple/rust-anything-main/rust-anything-main/src/main.rs:297)

可将同样的方法用于比较迁移前后的行为，例如记录切换顺序、窗口显示、账号身份核对和删除结果。用本地测试站点和合成测试数据复现存储及失效场景，真实 Muse 登录另做手动验收。真实验证码、Cookie 和回调凭据不进入回放文件。回放覆盖的是已记录的输入，无法单独证明 Muse 或 Meta 的登录链路在真实环境中可用。 [回放覆盖边界](X:/python-code/Muse-multiple/rust-anything-main/rust-anything-main/docs/how-it-works.md:176)

## Tauri 工作台的实现取舍

- **Windows。** 以 Rust 端生成并持久化的账号 UUID 为键，为每个账号创建使用独立绝对数据目录的 WebView2。重启时用相同 UUID 找回同一目录。采用 `WebviewBuilder::data_directory` 并验证运行时实际隔离。微软还支持同一 UDF 下的多个原生 Profile，后续只有在内存或磁盘数据表明需要时，再评估所选 Tauri 版本的接入成本。多个不同 UDF 同时运行会增加浏览器进程的内存与磁盘开销。 [Tauri 数据目录](https://docs.rs/tauri/2.12.7/tauri/webview/struct.WebviewBuilder.html#method.data_directory) · [WebView2 数据目录](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/user-data-folder) · [WebView2 多 Profile](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/multi-profile-support)
- **macOS。** 如果需要支持 macOS，在 14 及以上用 `data_store_identifier([u8; 16])` 绑定稳定的账号标识，保持非隐私模式。WKWebView 用的是系统数据存储，Electron 的 partition 目录结构不能直接套用。更早的 macOS 和 Linux 如需纳入支持范围，应分别验证隔离与持久化，再承诺支持。 [Tauri 数据存储标识](https://docs.rs/tauri/2.12.7/tauri/webview/struct.WebviewBuilder.html#method.data_store_identifier)
- **单窗切换。** 先实现账号列表加一个可见区域，缓存少量已打开的原生 WebView。切换时显示目标视图并隐藏原视图。闲置回收只关闭视图，重新打开复用同一存储。按列并排可在后续体验验证中比较。Tauri 2.12.7 的 `Window::add_child` 需要桌面端 `unstable` Cargo feature，固定依赖版本并验证原生视图的位置、缩放、输入焦点及遮挡。 [单窗口子 WebView](https://docs.rs/tauri/2.12.7/tauri/window/struct.Window.html#method.add_child) · [WebView 显隐](https://docs.rs/tauri/2.12.7/tauri/webview/struct.Webview.html#method.show)
- **认证归属与权限。** 本地 TypeScript 界面持有有限的账号管理指令。远程 Muse、Meta 页面和认证弹窗不分配本地文件、系统命令或账号管理权限。自建认证弹窗时，Tauri 文档要求 Windows 复用来源 WebView2 environment，macOS 使用来源 WebView configuration。登录失败时在原账号上下文提示用户重新验证，保留其分组及显示名。 [弹窗环境约束](https://docs.rs/tauri/2.12.7/tauri/webview/enum.NewWindowResponse.html#variant.Create) · [Tauri 权限模型](https://v2.tauri.app/security/capabilities/)

## 验收清单

| 优先级 | 场景 | 通过标准 |
| --- | --- | --- |
| P0 | 两个测试账号分别完成首次登录，包括真实重定向和弹窗 | A、B 各自显示正确账号。B 的登录完成后 A 仍可用。弹窗回到发起登录的账号 |
| P0 | A → B → A，先顺序切换，再测试并行加载 | 每次都显示正确身份。热切换不重载，仍有效的会话不再要求验证码。不存在短暂显示另一账号内容的情况 |
| P0 | 关闭一个 WebView 后重建，退出工作台并重新打开，重启系统，再从旧安装包升级 | 分别记录是否重载、是否仍登录和实际账号身份。能区分仅内存里的页面状态、浏览资料中的持久化状态和系统重启后的实际结果 |
| P0 | 在 A 中显式退出并另测在应用内移除 A，再添加 A | B 仍正常，A 的账号元数据与浏览资料按对应操作预期处理。退出 A 应引导正常重登，移除后重新添加 A 应视为新资料。若服务端存在联动撤销，记录实际影响 |
| P0 | 真实会话过期或站点要求重新认证；对照断网或页面加载失败 | 仅在当前账号提示需要重新验证。断网单独显示可重试的加载错误。不会覆盖、清除或替换其他账号的资料 |
| P1 | 2、5、10 个账号，分别测热切换、冷恢复、并排及长时间闲置 | 记录内存、磁盘与切换延迟，确定驻留上限。目标平台验收通过后再给出账号容量建议 |

验收先验证“每个账号只需在其本地资料里完成一次正常登录，之后有效会话可跨切换和重启继续使用”。真实账号的服务端失效、强制验证和跨运行时差异分别记录。源码静态检查可在工作区根目录运行下面的 CodeGraph 查询，确认相关符号仍存在。此检查不覆盖真实登录。

```powershell
codegraph query WebViewPool -p .\muse-panel-main -l 1
codegraph query doSwitch -p .\muse-switcher-main -l 2
codegraph query diff -p .\rust-anything-main -l 1
```
