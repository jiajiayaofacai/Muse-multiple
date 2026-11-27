# M0 原生验证结果

> 当前进度更新（2026-11-24）：处理了新建空白标签、状态横幅和原生视图空白问题；最终新scratch原生探测16/16通过，TypeScript 53项、Rust 27项通过。真实Muse登录/授权尚未由用户验证。详见[连接器正式结果](CONNECTOR-PRODUCTION-RESULTS.md)。

日期：2026-11-23
平台：Windows；WebView2 Runtime 144.0.3719.104；Rust 1.97；Tauri 实际构建版本 2.11.5；`tauri-build` 2.6.3。

## 当前优先级更正：普通原页登录

2026-11-23用户明确普通登录的验证码与可选两步验证都在原网页完成。本轮搜索Meta官方资料，并实际打开Muse未登录页面，确认电话/邮箱表单和“继续”；未发送验证码、未登录。完整证据分层见[网页登录基线](MUSE-LOGIN-BASELINE.md)。

此前把popup接管作为普通登录前置的判断已撤回。用户随后明确连接器新授权标签流程，并在隔离验证后批准正式接入；现已接入真实child、原生自关闭及回调，正式合成15项通过。真实登录/连接结果仍未验收，不宣称M0通过。最新证据见[正式接入报告](CONNECTOR-PRODUCTION-RESULTS.md)；下方历史段落按阶段保留。

## 自动检查

| 检查 | 结果 |
| --- | --- |
| `npm --prefix app run typecheck` | PASS |
| `npm --prefix app run lint` | PASS |
| `npm --prefix app run build` | PASS |
| `npm --prefix app run test` | PASS：53/53 TypeScript测试，含来源账号标签/通知、转义、不猜认证用途 |
| `npm --prefix app run test:sites` | PASS：8/8 合成HTTP站点测试 |
| `npm --prefix app run test:connectors` | PASS：3个普通Edge交互场景（Node统计含父项4/4）；不是原生或真实连接器认证 |
| `cargo fmt --check` | PASS |
| `cargo clippy --locked --all-targets -- -D warnings` | PASS；MSVC 只报告 linker stdout warning |
| `cargo test --locked -j 1` | PASS：27/27 Rust单元测试，含活动标签布局顺序回归 |
| `cargo build --locked` | PASS；MSVC 只报告 linker stdout warning |
| 原生逻辑独立 rustc 测试 | PASS：4/4，子代理阶段 |
| 专用原生探测 | PASS：此前正式15项；本轮新scratch最终16项通过，补＋空白标签、地址栏导航和正文/视口检查 |

## 当前生产能力边界

**普通登录与真实连接器成功仍待用户验收；生产Windows新窗口已正式接入。** 使用四个固定版本的必要本地crate补丁，精确child和来源environment，原生自关闭及结果回调延后到事件循环；原生接管不改unknown会话。普通新窗口保持normal，不猜认证；失败只显示来源账号的固定脱敏历史记录。

本轮三个实现泳道：vendor、browser后端、features/shell前端。共享契约、依赖配置、权限、探测与Git由主代理维护；远程能力未放宽。本轮增加的原生空白标签/导航/布局检查详见正式报告。

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

## 本轮生产集成证据与失败记录

- 前端新增当前账号受限请求提示（明确历史记录）、原页登录与外部授权分离的说明；后端启动不再全局BLOCKED，有效A来源在B活跃时仍归A，关闭/错误来源无副作用。
- 前端先红7项后绿48项；后端启动状态先红后绿，最终Rust15项。父级重新运行typecheck/lint/TS测试、站点测试、Edge交互、Vite build及fmt/Clippy/Rust测试均退出0；cargo build亦退出0。MSVC已有linker stdout warning保留。
- 合成连接状态仅在真实来源匹配回调后为connected-synthetic；NodeHTTP/source-shape不替代浏览器/原生语义。独立Edge测试实际覆盖合法回调后自关闭、仅关闭不成功、错误origin/兄弟source/账号及重放拒绝。
- 本轮专用WebView2最终新资料根8项通过：普通登录待验收不全局阻塞；A/B合成存储隔离；同账号共享；远程管理拒绝；A后台发起/B活跃归属；账号提示与控制台布局不重建原生页；最后标签不复活。未使用真实账号。
- 首次原生探测因测试服务缓存旧HTML而缺少新增connection-status探针，重启本轮服务后消除。第二次因DOM浮点边界差约0.000008像素使严格比较超时；实读几何确认无重叠，将探测容差改为0.01像素，不改产品CSS。第三个全新资料根完整通过，未把失败轮当通过。
- 生产依赖版本、锁文件、权限及IPC契约未改。真实Muse登录、两步验证、第三方连接成功、真实会话恢复仍未测。

## 隔离Tauri副本结果（不计作生产授权通过）

原生代理完成固定四层依赖副本接线，两轮新合成资料各8/8通过，包含实际opener/environment、COM接管结果、跨来源回调、原生自关闭与tab/manager清理、嵌套/空白导航/来源先关闭，最终只剩shell+B且单窗口。主代理核对原始报告、两轮PASS计数、最终退出码及全量哈希；未亲自重跑该隔离矩阵。完整[实验报告](../archive/spikes/SPIKE-tauri-connector.md)。

正式工程仍Deny，未应用这些补丁。COM失败/目标缺失/队列失败注入、更早deferral错误恢复、真实连接器和长期稳定性未验证，不能把两轮合成通过当作可直接发布。

独立复核指出的探测盲点已修正：通知前设置marker，并比较实际原生视口尺寸与壳预留区、检查无布局错误提示；第四个新资料根8项复测通过，未再次扩大审查。

## 隔离异常恢复续测（生产未改动）

后续在新scratch副本完成8类一次性异常及同进程正常重试，最终均通过；通知丢失先红后绿，正常8项也回归通过。延后调度模块3项独立测试、副本app旧基线9项及fmt/Clippy通过。未修改正式app，因此本轮没有重跑生产48/15测试并冒称新证据。旧候选另做3轮冷启动各8项通过，历史HRESULT未复现但未证明修复。

完整限制与失败记录见[异常恢复报告](CONNECTOR-FAULT-RESULTS.md)。正式新窗口仍Deny，依赖补丁尚待明确批准；真实登录、真实连接器与永久COM/系统队列故障不在本轮已验证范围。
