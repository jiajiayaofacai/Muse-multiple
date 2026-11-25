# M0：本地合成站点与原生手工验收

> MSI-only 复审/复测（2026-11-25）：bundle 配置仅含 MSI，指定配置/文档复审通过。前端、合成站点、Rust格式/Clippy/完整cargo test（31项，main/doc各0）/build及MSI bundle均通过。安装启动、真实Muse A/B隔离、会话恢复、连接器服务仍未验收。
## 先验收普通原页登录（2026-11-23更正）
| ID | 由用户在原生工作台操作 | 判据 | 实际 |
| --- | --- | --- | --- |
| INLINE-1 | 用户报告已在 A 的原始 Muse 页面输入邮箱和验证码并看到登录成功 | 记为用户报告的单账号人工结果；代理不读取页面/凭据；不代表 A/B 隔离、A→B→A、会话恢复或重新认证已验证 | 用户报告成功；其它项待测 |
| INLINE-2 | B独立登录，A→B→A | 各自身份/页面不串号，热切换不重建登录页 | 待测 |
| INLINE-3 | 仅重建A视图；完全退出并重启应用后再打开A/B | 资料仍归稳定ID；会话是否有效如实记录，过期允许原页重新验证，B不受A影响 | 待测 |
| INLINE-4 | A单独退出或失效后重新登录 | B不受影响；仍可在A原网页验证；不将Cookie存在当作登录有效 | 待测 |

本次只修正验收顺序，没有执行上述人工项。后文旧的“popup不能接管即停止所有扩展”结论仅适用于该新窗口能力，不再用于阻止普通登录验证。

## 证据边界与当前结论

- **源码事实**：`app/tests/sites/` 提供 Node 标准库双 HTTP 服务、固定 A/B 合成存储、真实 `window.open` / `WindowProxy` / `postMessage` / `window.close` 探针；不创建原生视图，不实现原生驱动，不模拟 Muse 服务端。
- **已执行**：Node v24.13.0；先运行 `node --test .\app\tests\sites\server.test.cjs`，因尚无 `server.cjs` 报 `MODULE_NOT_FOUND`（红）；实现后同命令 7/7 通过（绿）。`node --check` 检查 server.cjs、fixture.js 通过。
- **待验证假设**：原生 WebView2 不同 profile 隔离、真实 opener 关联、同窗认证标签接管和跨生命周期持久化。以下人工结果全部为**待测**，没有原生或真实 Muse 通过结论。
- **硬边界**：4317/4318 是同主机不同端口，即 cross-origin，不是完整跨站代理。Cookie 不按端口隔离，同一 profile 的两个源可见相同测试 Cookie；localStorage、IndexedDB 按 origin 区分。不能据此推断跨站 Cookie、第三方限制、HTTPS、SameSite、真实重定向、服务端会话撤销或 Muse 认证可用。
- Node 测试只覆盖监听、HTTP 内容/配置、路由、脚本输入不反射、关闭和绑定失败清理；JS 文本断言不执行浏览器。即使另用普通浏览器验证页面，也不能替代原生 WebView2 证据。

## 启动与停止（仓库根目录，PowerShell）

```powershell
node --test .\app\tests\sites\server.test.cjs
node --check .\app\tests\sites\server.cjs
node --check .\app\tests\sites\fixture.js
# 人工操作时由主代理/操作者启动；本次子代理没有启动长存进程：
node .\app\tests\sites\server.cjs
```

- 父页：`http://127.0.0.1:4317/parent`（`/`、`/parent.html` 同页）。
- 认证页：`http://127.0.0.1:4318/popup`（`/`、`/popup.html` 同页）；应通过父页按钮打开，直接访问没有有效请求不能回传。
- 两源都有 `/fixture.js`、`/config.json`；其他路径 404，不提供源码目录、任意文件或写入 HTTP API。无访问日志，不输出 Cookie 或请求参数。
- 只绑定 `127.0.0.1`，不是 `0.0.0.0`、IPv6 或 LAN；使用原样 IP，不改成 `localhost`。端口占用时启动失败，不自动换端口假装同一资料源。
- Ctrl+C 停止，CLI 也处理 SIGTERM。原生应用的实际启动指令由主代理按已有构建脚本提供，本清单不编造驱动命令。

测试/程序接口（调用者负责 `finally` 关闭）：

```javascript
const { createTestServers } = require('./app/tests/sites/server.cjs');
const sites = await createTestServers({ ports: { parent: 0, popup: 0 } });
try {
  // sites.origins.parent / .popup 是实际动态端口；sites.servers 提供监听地址。
  // 在对应原生视图导航至 `${sites.origins.parent}/parent`。
} finally {
  await sites.close(); // 可重复调用，释放监听及连接；绑定第二源失败也清理第一源。
}
```

`ports` 可省略或只指定某一个整数端口（0 表示临时端口）；非零端口必须不同。临时端口仅供测试，不用于证明默认源重启后仍持久化。

## 环境与安全前提（执行者填写）

| 项 | 实际值 |
| --- | --- |
| 日期 / 执行者 / commit | 待填 |
| Windows 版本 / WebView2 Runtime 版本 | 待填 |
| Tauri / wry / Rust / Node 实际版本 | 待填 |
| 原生运行方式、同窗多视图及新窗口处理是否接线 | 待确认 |
| A/B 稳定档案ID、各自测试 profile 位置（仅本机记录） | 待填，不用真实账号目录 |
| 原生证据位置、异常脱敏记录 | 待填 |
| 同窗标签 driver 与自动化能力 | 已有专用debug CDP探测，限定scratch与显式写入许可；自动覆盖子集见正式报告，不将完整人工矩阵记为通过 |

1. 使用全新、独立的**测试** profile A/B。A/B 页面下拉框只是写入标记，不创建/切换原生账号；隔离必须由可信原生资料映射保证。记录视图/tab → 稳定账号ID → profile 的对应关系，不以当前所选账号猜归属。
2. 在原生账号视图内打开父站，不能只在系统浏览器打开。普通浏览器仅作页面调试对照。不得用“复制 popup URL 到另一个普通 WebView”替代 `window.open` 接管。
3. 只写固定 A/B、T1/T2/T3；不输入真实账号、密码、验证码或凭据。页面只显示白名单合成值，遇到其他值显示 `unexpected-non-synthetic`，停止并检查是否误用资料。
4. 页面清除按钮有确认，只删除当前源的测试键/IDB记录；Cookie 影响同 profile 同主机两个端口。不是原生删除档案或服务端退出。不要清理用户真实浏览资料或杀全局 WebView2 进程。
5. 弹窗可能被策略拦截；`blocked-or-unassociated`、`missing`、超时或未知都不是通过。只记录安全错误类别及合成ID，不采集真实认证 URL/回调参数、存储转储或远程页面响应。

## DOM 状态约定（供手工或未来驱动检查）

所有选择器均为 `[data-testid="..."]`；状态 output 的 `data-state` 与正文同步，值使用固定英文枚举，不依赖中文文案。

| testid | 可检查内容 |
| --- | --- |
| `parent-page` / `popup-page` | `<body>` 页面类型；`current-origin` 显示实际 origin |
| `page-status` | `loading` → `ready` 或 `error`；ready 只表示初始化完成，不表示存储/原生能力通过 |
| `account-select` / `tab-select` | 固定 A/B 与 T1/T2/T3，无任意文本输入 |
| `write-storage` / `write-session` / `read-storage` / `clear-storage` | 四类写入、只写当前标签会话、手动重读、确认后清理 |
| `storage-status` | `idle` / `busy` / `read` / `error` / `cancelled`；`read` 不表示读到预期值，仍需检查下列四项 |
| `cookie-value` / `local-value` / `indexeddb-value` | `A` / `B` / `missing` / `unexpected-non-synthetic` / `error` |
| `session-value` | `A:T1` 等固定组合，或上述 missing/unexpected/error |
| `open-tab` / `tab-open-status` | 父页真实打开同源新标签；`opened` / `blocked-or-unassociated`，不代表原生同窗成功 |
| `open-popup` / `message-status` | 每次点击发起独立真实 window.open；`waiting` / `success` / `rejected` / `blocked-or-unassociated` / `open-error` |
| `message-origin` / `rejected-count` | 最近一次成功接收的实际来源；不匹配消息计数；被拒绝消息不更新成功来源或已有记录 |
| `popup-list` 内每个 `popup-record` | `data-request-id`、`data-account`；`data-result` 为 pending/success、`data-origin`、`data-source` 为 unmatched/matched、`data-closed` 为 false/true/unknown |
| 同上 `data-state` | `pending` / `success` / `closed-after-result` / `closed-without-result`；250ms 轮询真实 WindowProxy.closed，后台可能节流。关闭后保留记录供检查 |
| `request-account` / `opener-status` | 认证页请求账号；opener 为 `unknown` / `present` / `missing` / `closed` |
| `complete-auth` / `send-status` | 用户点击后才发送给精确 targetOrigin 并调用 window.close；`sent-close-requested` / `close-not-observed` / `opener-missing-or-closed` / `invalid-request` / `send-or-close-error` |
| `close-opener` / `close-opener-status` / `close-self` | 尝试关闭直接来源：`requested` → `closed` / `not-closed`，或 `denied-or-error` / `opener-missing-or-closed`；仅关闭自己不发送结果 |
| `probe-native` / `native-status` | 只读尝试 workspace_snapshot，返回数据不显示不记录；`unavailable` / `pending` / `rejected-unclassified` / `unexpected-resolved`，后者为安全失败 |

`success` 只说明实际 message 事件的 `event.origin` 与保存的真实窗口 `event.source`、一次性请求ID、固定账号和消息类型/结果相符；不会仅按URL或当前激活账号认领结果。重放消息被拒绝。嵌套认证只回直接 opener；不替祖先转发。`closed-after-result` 仅是收到后观察到 closed，须在**没有手动关闭**的步骤中观察，才能记录“自动关闭”；它本身不证明 UI 标签移除或原生环境共享。

## 原生手工矩阵（实际结果全部待测）

每项都要记录实际/预期差异、原生账号/tab归属和必要的脱敏证据。没有原生接线或操作入口时记“阻塞/未知”，不能改为通过。

| ID | 操作与观察 | 预期 / 判据 | 实际 |
| --- | --- | --- | --- |
| ISO-1 | 原生 profile A 在父源写 A:T1；profile B 同一 URL 初始读取后写 B:T1；A→B→A，分别重读四项 | B 初始不应读到 A；各 profile 的 Cookie/localStorage/IDB 保持 A/B，热切换 session 值保持所属标签，原生映射不变 | 待测 |
| ISO-2 | A 打开第二源认证页并读存储、写 A；B 同样操作读写 B；交叉切回重读 | 每个 popup 属于发起账号 profile；Cookie 同 profile 跨端口可见是预期；localStorage/IDB 首次第二源为空，写入后在其源持久，A/B 仍隔离 | 待测 |
| TAB-1 | A父页写 A:T1，点 open-tab；新标签读后只写 A:T2；原标签重读；再用新标签“四类写入”写 B标记并让原标签重读（结束恢复 A） | 同 profile、同 origin Cookie/localStorage/IDB 共享（两标签都见 B）；session 仍分别 A:T1 / B:T2。有 opener 的新标签初始可能复制 T1，不作为共享证据 | 待测 |
| AUTH-1 | A父页点 open-popup；在第二源用户点 complete-auth；不要手动关闭；查看原生标签及父页记录 | **同工作台窗口、A标签组内**新增认证标签，而非系统浏览器/独立窗口；opener present；来源4318、source matched、result success、closed-after-result；原生认证标签自动移除，焦点回正确来源 | 待测 |
| AUTH-2 | 同一A来源连续打开两个认证页，倒序完成；再完成第二轮请求 | 两个不同请求记录逐一匹配真实 source；不能串接/覆盖窗口；关闭只影响对应标签；多轮仍成功 | 待测 |
| AUTH-3 | A发起未完成认证，切到B并从B也发起；切回各自认证页分别点击完成 | 根据来源注册表而非当前激活账号归属；结果只到各自父页；标签、焦点、四类资料无串号 | 待测 |
| AUTH-4 | A认证未完成时从原生UI关闭父标签，再点击认证页 complete-auth | opener closed/missing 或原生保守关闭关联链；不向别的账号发消息，不复活已关闭来源/已移除账号，不出现假成功 | 待测 |
| AUTH-5 | 通过 open-tab 产生可由脚本关闭的父页，再由该页打开认证；认证页点 close-opener；另测直接导航父页的同按钮 | 如实记录引擎允许/拒绝；允许时只关直接来源，拒绝时 not-closed/denied-or-error；不得误关其他账号。再完成应提示来源失效 | 待测 |
| AUTH-6 | 父P打开认证C1，C1打开C2；先在C2完成，留C1检查记录，再在C1完成 | C2只回C1并关闭；C1保存C2 matched/closed记录；C1随后只回P。所有层级同账号同窗标签，原生opener链正确、焦点正确 | 待测 |
| AUTH-7 | 嵌套C2未完成时关闭中间C1；在C2完成/关闭；另开认证点 close-self 不回传 | 无祖先冒领回调/标签复活；直接来源消失按规则处理；仅关自己时父记录 closed-without-result 而非 success | 待测 |
| AUTH-8 | 在独立测试工具/DevTools发出错误origin、同源错误source（例如兄弟popup借用另一合成请求ID）、错误账号/请求ID、已完成请求重放；仅用固定合成字段 | rejected-count 增长，不把记录改为success、不影响其他窗口。必须以真实message事件执行，手造JS状态不是原生证据；无可用工具则保留待测 | 待测 |
| SEC-1 | 父站、认证页、嵌套页分别点 probe-native；在本地壳确认同名只读命令存在且正常；核对原生拒绝诊断 | 远程不能读取工作区或调用管理/文件/系统命令；unexpected-resolved 为失败。unavailable 或命令不存在不是权限拒绝证明；rejected-unclassified 需原生确认拒绝来源/能力 | 待测 |
| SEC-2 | 使用原生测试入口对远程 origin 进一步尝试账号管理、任意文件/系统权限（无入口则阻塞）；不读取真实文件，不实际创建/删除真实账号 | capabilities 与Rust调用来源校验均拒绝；页面内只读探针覆盖不足以证明所有权限，额外受控原生验证待实现 | 待测 |
| LIFE-1 | A/B写入后，原生销毁A全部视图但保留profile，再由同稳定ID重建A；检查B | A持久Cookie/localStorage/IDB恢复，B不变；sessionStorage销毁后行为实测记录，不要求跨重建保留；不得因释放页面清空profile | 待测 |
| LIFE-2 | 使用默认固定端口写A/B，完全退出应用（不是隐藏/托盘）并重启，再打开同测试profile的同源 | 持久Cookie/localStorage/IDB保留各自值；会话存储和session型Cookie未由本夹具证明，不能承诺恢复真实登录；不自动恢复认证URL | 待测 |
| LIFE-3 | 在A/B间切换；手动休眠后台A；另等待自动休眠门限 | 源码仅允许自动回收无打开标签的后台账号；手动休眠需用户确认并关闭A全部标签、保留资料；任何休眠都不声明认证有效，也不识别草稿/生成/上传状态 | 行为待统一原生验收 |
| HIST-1 | 在合成页产生可回退/前进的导航后使用工具栏 | 固定页面历史请求仅在活动标签存在时可提交；快照不包含引擎历史可用性，按钮不证明存在历史项 | 待统一原生验收 |
| RESET-1 | 在A父页确认清除本测试键，查看A另一标签/B；再分别验证原生退出/删除A（若已实现） | 本页测试清理不是登出；同profile共享项相应消失，另一标签session值独立、B资料不变；原生删除须关关联链并确认，删除失败不可假报成功 | 待测 |
| REAL-1 | 技术闸门通过后由用户自行在真实Muse完成A/B首次认证、A→B→A、来源关闭/嵌套适用场景、重建/应用重启、单账号退出/删除及失效重新认证 | 原生同窗与关联链正确，真实有效会话是否恢复实测；过期/撤销/安全验证允许重新登录。绝不记录密码/验证码/令牌，不以合成结果替代该项 | 待测 |

## 未实现 / 未验证项

- 本轮不实现或安装 WebView2 原生驱动；原生多profile映射、environment共享、child WebView同窗popup接管、焦点和关闭传播均由原生泳道实现并实测。
- 没有执行浏览器页面交互或原生手工矩阵，没有真实账号测试；存储API实际读写、消息拒绝路径与自动关窗的浏览器行为仍待测。
- 权限按钮只尝试现有只读工作区命令，不做文件/系统调用；是否存在桥接、拒绝是否来自正确策略及完整远程权限面均未知。
- 本地HTTP没有真实跨站/第三方Cookie环境、HTTPS/Secure/HttpOnly测试、真实OAuth重定向、服务端会话、网络故障/撤销模拟；M0合成成功不通过真实认证闸门。
- 若同窗原生认证不能保留真实 opener/postMessage/close：记录最小复现与平台限制，停止后续扩展，由主代理请求路线决策；不能自行降级成独立窗口、系统浏览器或URL复制标签。
