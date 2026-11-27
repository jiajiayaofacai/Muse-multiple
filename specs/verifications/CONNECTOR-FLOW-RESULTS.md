---
type: verification-report
context: Parallel production flow-state corrections; connector authorization tabs remain unsupported in the unpatched production runtime
status: production-boundary-slice-verified-connector-feature-incomplete
---

# Muse 登录与连接器授权：本轮开发结果

日期：2026-11-23；起始提交：`dcb6b42`；分支：`feat/m0-desktop`。

## 两条真实需求

- 普通Muse登录：电话/邮箱 → 原标签验证码 → 适用的原标签两步验证 → agent对话。
- 连接其他应用：来源账号打开新授权标签 → 用户授权 → 授权标签自动关闭 → Muse原页显示实际连接结果。

这两条流程来自用户说明。不得把新窗口能力缺口当作普通登录已经失败；也不得把页面ready或标签关闭当作连接成功。

## 本轮生产代码交付

前端与后端由不同子代理同时开发，主代理维护共享契约、配置、测试与Git，未并发写同一文件。

- 后端启动诊断改为 `login_verification_pending`，全局状态不再以popup缺口标BLOCKED，sessionStatus仍unknown。
- `record_new_window_blocked`按实际发起账号和仍存在的来源标签校验。B正在使用时A发起的请求仍归A；关闭、错误或缺失来源不记录迟到事件、不改变revision、不复活标签。
- 有效拒绝只追加固定脱敏诊断，不更改全局gateStatus、活跃账号、会话状态或已有标签；诊断继续限量100条，不带请求URL。
- 前端在网页区域外显示当前账号最近一次受限请求，明确它是历史记录，可能是外部授权或普通外链，不凭URL猜测。账号名和消息经HTML转义；不显示其他账号事件，不合成原生标签或connected状态。
- 首页、仪表盘、空态区分原页登录与外部授权；现有authentication目的标签可显示“外部授权”。控制台保持独立，提示和控制台变化不重建远程页。
- 合成站点新增当前请求connection-status。只有origin/source/请求ID/合成账号均匹配的回调才标connected-synthetic；仅关页、发送回调或被拦截不视作成功。

**生产 `window.open` 仍Deny。授权新标签接管、自关闭和真实连接成功尚未交付。** 独立Tauri副本实验不等于正式工程已经支持；本轮没有更改依赖版本、锁文件、权限或IPC契约。

## 已执行检查

| 检查 | 本轮结果 |
| --- | --- |
| typecheck / lint / Vite build | 全部退出0 |
| Vitest | 48/48通过，新增来源通知、转义、流程说明与快照回归 |
| `npm --prefix app run test:sites` | 8/8通过；HTTP/source-shape检查，不执行浏览器语义 |
| `npm --prefix app run test:connectors` | 专用Edge临时浏览器3个交互场景通过，含父测试Node报告4/4 |
| cargo fmt --check / Clippy all-targets -D warnings | 通过 |
| cargo test --locked | 15/15通过 |
| cargo build --locked | 退出0；已有MSVC linker stdout warning保留 |
| 专用WebView2生产探测 | 最终8项通过；授权新窗口仍明确受限，不是假认证通过 |

Edge实际交互覆盖：合法回调后父页合成连接状态更新、child自关闭；只关闭不报告成功；错误origin、兄弟窗口source、错误账号和重放被拒绝。使用独立临时浏览器和合成A/B，不接触真实凭据。

WebView2探测覆盖：启动待验收不全局阻塞；A/B合成Cookie/localStorage/IDB隔离；同账号共享；远程管理拒绝；A后台发起/B活跃时来源归属；账号提示不跨账号；通知出现前设置的页面marker在通知/控制台变化后仍保留；最后标签不复活。

布局检查包含壳DOM提示/网页区/控制台不重叠，以及实际远程WebView视口宽高跟随预留区域（1逻辑像素内舍入差）；同时要求无原生布局错误提示。没有读取原生HWND位置或声称截图视觉验收通过。

## 红绿与失败保留

- 前端代理先观察新增7项失败、原34项通过，再实现至48项通过；后端启动状态测试先红，最终Rust15项通过。
- 主代理先加连接状态HTTP测试，观察因探针缺失而失败，再补夹具至8项通过。
- 首次生产原生探测前5项通过后缺少connection-status：站点服务启动时缓存了旧HTML，确认源码缓存行为后仅重启本轮服务，不改产品。
- 第二次前6项通过后布局严格比较超时：读取几何发现提示底部与网页顶部相差约0.000008像素，无实际重叠。把探测舍入容差改为0.01像素，未改产品CSS；第三个全新资料根8项通过。
- 一轮只读审查无生产状态/来源代码阻断发现，指出marker设置过晚、仅DOM矩形可能漏掉原生布局问题。父代理将marker移到通知出现前，并增加真实原生视口尺寸及无错误提示检查；第四个全新资料根8项再次通过。

## 仍需完成

- 独立原生接管实验结果要单独记录；生产接入需要明确固定依赖范围、失败清理与完整原生验收，不能直接复制scratch副本。
- 真实Muse登录/两步验证、真实第三方服务连接成功、有效会话在视图重建/应用重启后恢复均未测试。
- HTTPS跨站、COOP/noopener、并发授权/取消、来源/账号删除、资源泄漏和长期稳定性仍需针对性验证。

verify: 按[app检查说明](../../app/README.md)运行质量检查；专用原生探测只连自己显式启动的scratch资料实例，不连接日常账号。不得将本报告标为完整连接器功能通过。

## 隔离实验补充

独立Tauri副本首轮原生矩阵两轮各8/8通过，详见[原生报告](../archive/spikes/SPIKE-tauri-connector.md)。随后在新副本完成8类一次性异常与后续重试，补上通知丢失后的延后处理及早期拒绝/deferral释放；正常8项也回归通过，见[异常恢复续测](CONNECTOR-FAULT-RESULTS.md)。正式依赖仍未应用候选，真实服务连接与永久系统故障未验收。
