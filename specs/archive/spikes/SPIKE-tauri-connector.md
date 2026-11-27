---
type: spike-report
context: Isolated Tauri connector-tab adaptation; pinned dependency copies only; not applied to production
status: two-native-rounds-passed-failure-paths-and-production-integration-pending
---

# 隔离 Tauri 连接器授权标签实验

日期：2026-11-23。实验从 `dcb6b42` 的 app git archive 建立，全部代码、四层依赖副本、构建与合成资料位于本会话scratch的 `tauri-connector-spike`；未写入生产工程或修改共享Cargo源码缓存。

## 结论

**两轮全新合成资料的Tauri原生矩阵均8/8通过。** 已不只是Wry单独宿主实验：在Tauri同一个shell内建立精确child、保持真实opener与环境、接收回调、原生自关闭并清理tab及Tauri manager。真实Muse登录和第三方服务连接仍未测，生产仍Deny，不据此解除M0闸门。

原生实验代理运行区间20:16:38—20:50:22，结束后已清理自有进程和9234端口。主代理另行读取REPORT、最终探测、清理与哈希记录；没有重新运行此隔离矩阵，不能把代理执行说成父级重跑。

## 最小候选实际改动面

固定副本：Tauri2.11.5 / tauri-runtime2.11.3 / runtime-wry2.11.4 / Wry0.55.1，仅修改其中5个源码文件。

1. Tauri新增Windows opt-in `CreateWebview { webview, on_complete }` 和安全的关闭builder hook。
2. generic runtime传递精确window_id加唯一UUID-based webview_label。**不是numeric webview_id**：DetachedWebview不公开数字ID。标签在该生命周期不复用，正式设计仍需考虑并发/ABA。
3. runtime-wry按精确目标查找，缺失返回Deny和target_missing回报，不新增unwrap。关闭/完成事件均通过runtime proxy的Task无条件排队，不能用可能同步执行的run_on_main_thread在COM回调里析构controller。
4. Wry新增可选关闭handler及CreateWithResult分支，检查SetHandled、SetNewWindow、Complete的实际结果；前序失败仍释放deferral。旧Create及未配置hook的默认行为保留。
5. scratch app用继承来源environment的about:blank builder建立child，不自己导航请求URL，由WebView2接管；原生关闭走Webview::close清manager，再清来源tab并回仍存在的opener。仅scratch增加shell-only inventory命令、独立shell资料和9234调试端口。

新增依赖字段/分支cfg(windows)，未做其他平台编译。没有独立授权宿主、系统浏览器、reparent时序猜测、JS覆盖window.close或新自有unsafe块；但修改了依赖已有unsafe函数内部逻辑，仍需作为原生依赖代码严格审查。

## 鲜活结果

- `cargo check/build --offline --locked`通过。
- 最终fmt、Clippy all-targets -D warnings、test、build退出码均0；Rust单测9项（隔离副本基于旧基线，不是生产本轮15项）。已有MSVC linker stdout warning保留。
- `probe-3.log`、`probe-4.log`各退出0、8/8。后者在Clippy等价条件整理并重建后执行，与最终候选源码对应。
- 每轮6次SPIKE_TAKEOVER_OK来自3个原生COM步骤的成功返回，而非page-ready；最终tabs=1、manager=2（shell+B）、windows=1。

每轮场景：
1. A/B合成身份独立，使用各自来源环境。
2. A远程管理调用实际denied。
3. A跨来源真实child：opener存在、Cookie属于A，第二origin localStorage初始为空，manager标识精确，同一shell。
4. 消息origin/source匹配，native self-close后tab/manager消失并回A，B和壳仍在。
5. B同样使用B环境并关闭，不复用A资料。
6. 嵌套只回直接opener，祖先仍pending，两层分别清理。
7. about:blank保留WindowProxy，由来源脚本随后跨来源导航，再原生自关闭。
8. 来源先关闭后其tab/manager清理，剩余child的opener变null，child仍可独立关闭，B/壳存活。

生存断言限于矩阵结束、CDP teardown之前。断开之后额外端口检查曾因拒绝连接退出1，原始矩阵已EXIT=0；不把该事后检查当矩阵失败，也不宣称断开调试器后的进程寿命已验证。

## 失败与未测

保留失败：首次构建使用不存在的WebviewId类型而退出101，改为window_id+唯一label后通过；初次Clippy两处collapsible_if，等价修正后通过；前两次原生探测因inventory未登记command manifest而中止，补齐仅scratch登记后两轮完整通过，没有把中止轮计作成功。

**首轮边界（历史记录）：当时未做COM/目标缺失/队列失败注入。** 后续已在另一个副本完成8类一次性异常与恢复检查，并修正通知丢失，详见[异常恢复续测](../../verifications/CONNECTOR-FAULT-RESULTS.md)。不代表真实COM永久失败或系统队列耗尽已经验证。过去0x80070057续测3轮冷启动未复现，根因仍未知。

真实账号、连接器服务端成功、HTTPS/第三方Cookie/COOP/noopener/named target、DPI焦点与视觉、休眠/删除交错、压力长期运行、重启会话恢复均未验证。

## 证据定位与SHA-256

原始REPORT、自动生成的候选审查差异、源码和日志仅在scratch，不提交vendor、浏览资料、日志或可直接应用的补丁。差异585行，仅用于审查，不曾自动应用生产。

- Tauri webview源码：`9f1f37083cca1c99c416c127784f70476048a87a972e23f4323120c3412796a5`
- runtime webview源码：`2914653ebf2488accfec85e8cdb74ef19f4bbefabf105cd1fd26a56a776a4061`
- runtime-wry源码：`5b74f11c4c4edc66628dec237436bf192d50ac0a0fd3b77c95a4a76fa898606f`
- Wry lib源码：`e1d6f18459843dbd4cc5bc4fb0f27efe68cda2d171f2310ea3baee1bd9eb73e5`
- Wry webview2源码：`5d6c96809e4a8c1aac787d2590da72974f2d9c51202f5d70a75eaf1f538eb955`
- 最终probe-4.log：`73cc0d895ef3c94bd487f7744d8d5a25f593b0cffa7e47653eade35a87112067`
- validation-final.exit：`85d1421573903ecbf0c946a900e6a9a9a894b8842a16c2bdfbc711e31db0efc1`

## 下一步边界

正式接入仍需单独确定固定补丁维护/许可与更新方式、审查原生所有权变化及生命周期/ACL，再由用户自行做真实连接器授权。一次性异常模型与恢复续测已补充，不能等同所有故障恢复。不可整体搬入生产或默认解除Deny。

verify: [生产本轮结果](../../verifications/CONNECTOR-FLOW-RESULTS.md)仍须明确生产与隔离能力不同；不能将本报告写成真实连接器通过。
