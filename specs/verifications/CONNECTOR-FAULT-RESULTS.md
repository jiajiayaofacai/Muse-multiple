---
type: verification-report
context: Isolated connector failure-injection and recovery; production dependencies and application code unchanged
status: bounded-fault-matrix-passed-production-application-awaits-approval
---

# 连接器授权：隔离异常恢复验证

日期：2026-11-23；生产基线 `305c823`。本轮继续上一阶段，仅在新scratch副本 `tauri-connector-faults` 修改候选；未改变正式工程、依赖、锁文件或权限。

## 结果与边界

- 父代理实际执行：8类异常各1轮“异常处理＋同进程正常重试”均退出0；最后回归原8项成功路径也退出0。各轮独立新资料，最终原生视图清单恢复到shell+A+B、单窗口。
- 新增延后任务模块3个独立测试通过；副本app的fmt检查、Clippy all-targets -D warnings、cargo test均退出0。副本app仍是旧基线9个测试，不是生产前一轮15个测试；依赖新增模块测试另行执行，不混计。
- 独立测试代理对未修改的上一候选做3轮冷启动，3轮合计24项PASS、18次接管成功日志，未复现历史0x80070057。原18项源/证据哈希、报告及exe前后相同；未复现不代表已修复。
- 真实Muse登录、两步验证、真实第三方连接结果均未测试。生产仍拒绝window.open，不能将本报告标为正式连接器功能完成。

## 可重复的缺口与修正

### 完成及关闭通知发送失败

上一候选在runtime proxy投递失败时仅打印日志并丢弃任务。Windows Tao源码显示底层PostMessage失败即返回错误，不能仅解释为应用已经退出。

一次性模拟发送拒绝后，关闭通知用例实际留下tabs=3、manager=4，预期2/3，连接仍pending；这是本轮明确复现的清理缺口。完成通知用例的正确判据是最终收到接管结果，然后让用户完成合成授权，而不是立即关闭仍在等待授权的child。按该正确判据，旧候选确实丢失结果、测试失败。

修正只在新副本：保留失败投递退回的Task，于外层MainEventsCleared执行；重入时不执行嵌套任务，LoopDestroyed丢弃剩余回调。不在COM回调里析构controller，不使用随机延时或同步回调捷径。正常投递路径保持原样。

### 更早的deferral和浏览器派发失败

新副本在读取请求和取得deferral前先设置Handled，避免早期失败落到默认新窗口。GetDeferral失败时拒绝本次请求且不创建child。

Wry原dispatcher把闭包转为裸指针后，PostMessage失败未回收闭包。本副本在现有unsafe函数内部恢复所有权、Drop而不执行；新窗口调用方检查派发结果并释放保留的deferral。注入记录显示handled=true、released=true，来源页可继续正常发起下一次请求。没有新增unsafe块或新原生API；但已有unsafe函数中的所有权变化仍需正式审查，未做句柄/堆泄漏审计。

## 注入矩阵（每进程只触发一次）

| 模式 | 实际注入方式 | 观察到的结果 |
| --- | --- | --- |
| set_handled | 真实Handled调用后报告合成错误，保留Handled=true避免意外默认窗口 | 新child清理、无假成功；第二次正常授权可完成并自关闭 |
| set_new_window | 在SetNewWindow调用前返回合成错误 | 空白child和注册表清理；来源/B保留，后续请求恢复 |
| complete | 真实Complete释放后报告合成错误 | 错误路径清理，不报告连接成功；后续请求恢复 |
| target_missing | 精确查找被替换为None，不删除兄弟目标 | 返回拒绝及target_missing，清理本次child；后续请求恢复 |
| completion_queue | 模拟一次runtime任务投递拒绝 | 延后安全边界仍收到实际接管结果；手动合成授权后正常回调/关闭，再次请求可用 |
| close_queue | child真实window.close时模拟一次通知拒绝 | 延后任务清理tab/manager，不误关父页/B；再次请求可用 |
| get_deferral | 在GetDeferral前模拟失败，不生成deferral | 明确拒绝，不创建child，不阻塞父页；下一次请求可用 |
| dispatch_queue | 在原生PostMessage前模拟一次拒绝 | 回收闭包，真实拒绝/释放deferral；下一次请求可用 |

最终矩阵为scratch `final-matrix.json` 的q01—q08，各2条PASS；q09原成功矩阵8条PASS。这里的数量不等于每个断言或真实服务认证测试。

## 红绿与其他失败保留

- 未加故障开关的负对照先失败：正常SPIKE_TAKEOVER_OK不能满足“实际注入过一次”的断言。
- 第一版注入显示4类接管/目标异常可恢复，2类通知丢失不恢复；修正后的完成通知判据也在旧逻辑上明确失败，然后才接入延后队列。
- 初次新副本构建在第三方displaydoc宏加载处E0463失败，产物实际存在；不改代码的串行构建成功。根因未确认，不解释为认证错误或声称修复。
- 原生探针有数次初始存储等待超时，甚至超时后读取到state=read。改为Node侧有界直接DOM轮询，保留8秒级上限和原断言；最终完整矩阵通过。路径长度假设没有确证，不作为根因结论。
- 新调度模块最初直接作为crate root测试因pub(super)失败，改为模块wrapper编译后3项通过；这只是测试入口修正。
- 原生失败、测试准备失败和汇总脚本的非零输出均保留在scratch，不用重复运行覆盖原始日志。

## 可复核证据

- 最终矩阵SHA-256：`edb4be73061583ceeafac401eb741185e47d7b0c79febadc7738e43eb99f4489`。
- Wry Windows候选：`54b6a03e6354f4259d376105aa0e01112e89b76df52f772990288159e8e25959`。
- runtime-wry候选：`37c6789f917454f16dbee8aaa8823bdfab6491cb1566d11a7c2484fe2088bd46`。
- 延后任务模块：`f60e8ba4927183bdebbda6d38b44f7aa7281d19eafdcc58980395ec19b5f31fb`。
- 注入探针：`a26c3d90e099964fdc0f4be15d2d82410129d369c460054e9fe59ed84966b5cb`。

原始源码、脚本、合成资料和日志仅在scratch，不上传vendor或浏览资料。每轮9236释放；旧候选复现的9234也已释放。

## 仍不能宣称的能力

这些是受控的一次性错误模型，不是真实OS队列耗尽或真实COM永久不可用。尤其Complete用例已实际释放，不能证明真正Complete持续失败时仍可释放；线程/事件循环无法继续运行时也不承诺任务恢复。组合故障、长期压力、平台关闭边界、真实HTTPS/COOP和服务端结果尚未验收。早期拒绝目前只固定日志，尚未扩为完整来源账号业务错误通知协议。

下一步涉及正式固定依赖补丁的维护/许可、原生代码审查与生产接线；此前只评估不应用的边界仍有效，须用户确认后再进入正式工程。真实认证由用户自行输入敏感信息。

verify: `git diff 305c823 -- app` 本轮应为空；另查[生产与隔离能力边界](CONNECTOR-FLOW-RESULTS.md)，不得把这些合成结果标为正式授权完成。
