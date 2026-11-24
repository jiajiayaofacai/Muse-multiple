# 正式工程：来源账号新标签接入结果

日期：2026-11-23。平台：Windows，WebView2 144.0.3719.104。集成基线为 `bf857001f86fd552771903df691caacdaa96fbd3`（正式应用代码基线 `305c823`），不是旧实验应用的整份覆盖。

## 授权与实现

用户在隔离故障报告后明确选择“批准接入正式工程”。本轮使用三个互不重叠的实现代理同时处理 vendor、browser 后端及 features/shell 前端；主代理维护 Cargo 配置/锁文件、接口收敛、原生探测、文档与 Git。没有自动发布、合并、真实凭据代操作或资料迁移/删除。

- 固定四个必要 crate 的本地源码：[维护说明](../../app/src-tauri/vendor/README.md)、[源码与许可证哈希](../../app/src-tauri/vendor/SHA256SUMS)。共245个文件、约2.16MB（含局部换行规则），不复制整个依赖树；保留原manifest、许可证。对照本机原版仅6个Rust源码不同；局部`.gitattributes`避免Windows换行转换破坏哈希。
- Tauri2.11.5 / runtime2.11.3 / runtime-wry2.11.4 / Wry0.55.1版本不变；锁文件仅移除四个 path crate 的 registry 来源/checksum，其他依赖无版本变化。
- Windows新窗口按仍存在的发起账号及来源标签创建UUID child。使用真实来源 environment、精确 window_id+不可复用标签、about:blank 由 WebView2 接管；不复制请求 URL 自行导航，不建立隐藏授权宿主。
- 普通文章与外部授权同样是来源账号内的 `normal` 标签，不根据 URL/opener 猜认证。后台A请求不切走全局B；原生接管仅更新标签生命周期，不修改未知 sessionStatus 或推断连接成功。
- 原生自关闭通知和接管结果始终延后至事件循环，精确调用单视图关闭及管理器清理，再清理账号标签。缺失/错误/关闭中来源被拒绝；关闭来源后存活 child 不会复活来源。
- 创建失败使用固定脱敏诊断；前端支持历史 `new_window_blocked` 与 `new_window_failed`，按账号选择最近事件并转义，不代表当前连接结果。未放宽远程 capabilities 或管理来源 guard。
- 没有新增自有 Rust unsafe，依赖中已有 unsafe 函数内的COM/裸指针所有权有改动：PostMessage失败时回收未投递闭包并尝试释放deferral。全部故障注入模块、环境开关和实验命令均已移除。退出后无法运行事件循环时不保证通知交付。

## 本轮实际检查

| 检查 | 观察结果 |
| --- | --- |
| `npm --prefix app run typecheck`、`run lint`、`run build` | 全部退出0 |
| `npm --prefix app test` | 53/53，5文件；前端代理先补测试使旧实现8项失败，父代理复跑全绿 |
| `npm --prefix app run test:sites` | 8/8 |
| `npm --prefix app run test:connectors` | Edge合法回调后自关闭、仅关闭不成功、错误origin/source/账号/重放三个场景通过，Node含父项4/4；非原生证据 |
| crate根 `cargo fmt --check` | 退出0 |
| `cargo clippy --offline --locked --all-targets -- -D warnings` | 退出0 |
| `cargo test --offline --locked -j 1` | PASS：27/27；新增活动标签布局回归 |
| `cargo build --locked -j 1` | 退出0；MSVC linker stdout提示仍存在 |
| vendor哈希与源码范围 | 固定vendor源码SHA19/19；6个Rust改动；依赖manifest版本不变 |
| vendor调度模块独立测试 | 3/3（顺序/重入/退出），由依赖实现代理单列执行 |
| 专用正式原生探测 | 本轮最终新scratch根16项通过，含“＋→about:blank→键入合成URL→DOM正文和原生viewport可见”，退出0 |

### 正式原生矩阵

执行工程现有 `app/tests/e2e/native-probe.cjs`，通过显式 `MUSE_M0_CDP=http://127.0.0.1:9224`、`MUSE_M0_ALLOW_TEST_WRITES=1` 及全新scratch `MUSE_MULTIPLE_M0_DATA_DIR` 连接本轮正式调试二进制。Vite1420与合成站点4317/4318由本轮单独启动；未读取真实资料或访问真实认证。

1. 普通原页登录待验收，不因连接器能力全局BLOCKED。
2. A写入固定合成标记。
3. A/B Cookie、localStorage、IndexedDB隔离。
4. 同账号标签共享正确资料。
5. 点击“＋”创建normal `about:blank` 原生标签，无网址对话框且地址栏为空；输入本地合成HTTP URL后，原生DOM正文、标题/ready、CDP target及实际viewport尺寸一致；关闭后清理标签。
6. 远程父页管理命令被拒绝。
7. B活跃时A后台真实child归A，Cookie正确、跨来源localStorage不复制；真实opener、source/origin回调、自关闭及实际CDP target和注册表清理通过；child管理访问被拒绝；不切全局B，不改变未知session。
8. B自己的child只共享B资料并回到B来源。
9. 嵌套child只回直接opener，自关闭逐层清理。
10. 仅自关闭无回调，父页保持pending而非成功。
11. 真正about:blank WindowProxy由opener后续导航，自关闭清理。
12. 普通文章请求保持来源账号normal标签；壳关闭后注册表及实际target消失。
13. 不支持的ftp协议请求被拒绝，来源A固定诊断、无新增标签，不影响B或全局登录；B不显示A提示。
14. 切A后显示A历史诊断；开启控制台，DOM通知/slot/console无重叠，原生viewport与预留区尺寸相符、无布局错误；请求前页面marker不变。
15. 来源先原生关闭，orphan确认opener失效；自身关闭后不复活来源，B存储仍在。
16. A最后标签关闭后切走再回不复活、不删除账号。

以上验证原生合成机制，不是完整HWND位置/窗口枚举、真实HTTPS或真实服务端授权结论。实际CDP target消失与注册表清理、源码中的Webview::close管理器路径共同支持清理结论；未新增广泛inventory命令。

## 失败、纠正与证据位置

- 负对照 `formal-native-red01`：旧正式二进制通过前5项后在真实WindowProxy记录处超时，退出1；新能力没有被假页面状态绕过。
- 第一次 `cargo generate-lockfile --offline` 意外降级5个无关传递依赖。主代理发现后停止该构建、精确恢复原锁定版本/checksum；最终锁文件仅8行来源/checksum删除，重新跑fmt/Clippy/26测试/build全绿。首轮结果不作为最终锁文件证据。
- 父代理将后端代理假定的 `features.environment()` 校正为固定版本真实API `features.opener().environment.clone()`；接管失败code统一为前端支持的 `new_window_failed`，均在首次正式原生验收前完成。
- 提交前定向文件检查：270文件、53本地链接、7结构文件通过；固定GitHub/AWS/OpenAI/JWT/私钥模式无命中，实验模块/命令无残留。唯一非文本资源为原版示例wasm，已逐字节核对相同；不是本轮构建产物。验证脚本首遇该资源而停止后加入严格上游一致性校验，没有泛化放行二进制。
- 全量暂存`git diff --cached --check`报告原版移动平台`Logger.swift`的12处行尾空白；该文件与同版本上游逐字节一致，保留原样。排除该单个未修改上游文件后其余全部暂存检查通过；这不是全量零警告结论。vendor暂存blob的19项SHA也与清单一致。
- 第二/三轮进程树清理出现“进程已退出”的taskkill竞态提示；原生探测本身均退出0，最终调试端口已释放。不是原生能力测试失败，也不隐藏该提示。
- 原始输出、合成资料及运行器保留在本机会话scratch的 `formal-native-red01`、`formal-native-green01`、`formal-native-green02`、`formal-native-green03`。不提交日志/资料。最终源与证据SHA清单由主代理保存在该会话scratch，vendor可复现清单在仓库内。
- 本轮新回归初期失败：隔离native-probe连接时，CDP已给出初始about:blank，但probe立即要求shell URL；修为有界等待本地shell/bridge。第一次等待仍未出现shell，是因为为避免用户浏览页HMR，Vite和4317/4318合成服务已停止；重启本机Vite及合成服务后，新scratch最终16项通过。失败探测在账号创建前退出，未碰真实资料。
- 确认Windows Cargo target由仓库Cargo配置指定为`X:/BuildCache/Cargo`，不是`app/src-tauri/target`。最初手动启动的旧位置二进制短暂显示窗口后退出；本轮使用正确target，经Tauri dev后台任务启动并观察到窗口存活。无控制台窗口证据见本轮会话，不等同真实登录验收。

- 前端“＋”调整时，Vite HMR曾触发工作台shell页面reload。随后为保护浏览页停止Vite；这使依赖Vite的测试host无法加载shell。合成回归改用停止前外的专用scratch资料，最终由Tauri dev在后台启动Vite并跑测。没有主动导航Muse页；当前Vite/合成服务为本轮测试而运行。
## 尚未验证

真实Muse登录、验证码/两步验证、真实第三方连接成功、视图重建/应用重启后的真实有效会话、退出/撤销后重新认证，仍须用户自行操作。不得把关页、Cookie存在、原生接管或合成成功等同真实成功。

HTTPS/Secure/HttpOnly、跨站Cookie、COOP/noopener/named target策略、永久COM或OS队列耗尽、事件循环停止后的恢复、长期稳定性/泄漏仍未验证。历史 `0x80070057` 未复现不等于已修复。之前8类故障注入只在隔离副本执行，详见[故障报告](CONNECTOR-FAULT-RESULTS.md)，不得冒称本轮正式程序重新注入通过。


## 2026-11-24 用户反馈回归

- 前端“＋”直接对当前账号执行新建`about:blank`标签，成功后聚焦空地址栏；不再打开填网址对话框。连接成功后隐藏指定的M0状态横幅，不显示替代成功口号。
- 源码复核发现`apply_layout`此前先hide所有子视图，再set_bounds/show active。任一非活动视图hide报错会提前返回，当前活动视图可能仍不可见，尽管title/page-load回调继续更新。调整为先展示active view、再隐藏兄弟视图；无效/不可见bounds仍隐藏所有视图。该因果链是源码缺陷与合成回归所支持的根因假设，不是对用户真实Muse事故现场的直接观测。
- 验证：TypeScript53、typecheck/lint/build；Rust fmt、Clippy和27测试；Node E2E语法检查；HTTP fixtures 8项；完整隔离原生探测16项PASS。探测真实点击＋、无弹窗、地址栏键入本地HTTP页面、确认DOM正文和title/loadState、CDP target及原生视口匹配，并清理synthetic tab。
- 早期原生探测失败原因已区分：首次CDP只暴露初始about:blank，脚本过早查找shell；修为有界等待。之后没有shell是因为保护浏览页时停了Vite；另一次测试HTTP夹具亦未监听。启动两项服务后最终新根通过。失败均发生于读写真实账号之前。
- 启动诊断：首次Tauri CLI并行构建依赖时出现E0463（darling/displaydoc），单线程重试出现E0463（phf）；检查确认Cargo target配置在`X:/BuildCache/Cargo`，早先手动启动的是另一个旧项目target二进制。之后用正确target、仅本次命令覆写空beforeDevCommand以复用已有Vite启动；当前窗口存活、响应、可见且没有可见cmd窗口。启动前端时的HMR可能刷新工作台页面；真实登录动作仍由用户执行，真实Muse页面及登录结果未检查。
- 本轮最后查询：专用测试host已结束；本地Vite1420与loopback合成服务4317/4318仍在运行；真实Muse登录/授权未测试。
M0真实认证闸门没有解除，M1—M6、安装包和自动发布未在本轮实现。手工验收见[M0清单](M0-MANUAL.md)。
