---
type: impact-assessment
context: M0 controlled child authentication evaluation; no production patch authorized
---

# M0 受控认证评估影响范围

## Target

用户已批准受控评估，未批准应用。调查 Wry 0.55.1 原生 child 新窗口接管及网页关闭 handler 的最小扩展；实验仅在 scratch，正式工程依赖、锁文件、权限和 `window.open` Deny 保持不变。

## Dependents

若以后集成，将影响：
- `app/src-tauri/src/browser/views.rs`：来源环境继承、新窗口接管与原生事件。
- `app/src-tauri/src/browser/actions.rs`、`registry.rs`：账号/tab归属、关闭和迟到事件。
- `app/src-tauri/src/browser/mod.rs`：操作序列化与布局。
- `app/contracts/workspace.ts`、`app/src/bridge/`、`app/src/shell/`：快照、选中标签和布局。
- Tauri / tauri-runtime / tauri-runtime-wry / Wry：如采用补丁，需固定来源和校验，不能仅替换一个回调就视为集成完成。

## Affected Stories

项目使用 `specs/EXECUTION_PLAN.md`，没有 release-plan/story capsule。直接关联 M0 技术闸门；后续 M2 标签、M4 休眠保护、M5 删除与迟到事件均受认证生命周期约束，仍暂停。

## Test Coverage

- 现有原生探测覆盖 A/B 合成资料隔离、同账号共享、远程管理拒绝、最后标签空态以及显式认证阻止。
- 双来源站点已有实际 `WindowProxy`、来源与 source 校验、嵌套、自关闭夹具。
- 缺口：成功同窗接管、原生关闭通知清理、about:blank、来源先关闭、嵌套、错误路径和真实跨站HTTPS认证。
- 本次底层实验不替代 Tauri 权限测试、账号隔离矩阵或真实 Muse 手动验收。

## Risk: High

认证与视图生命周期属于共享原生边界；潜在补丁跨多层运行时，当前缺少成功路径集成测试。风险仅在隔离实验中评估，不应用于正式工程。

## Recommended action

先验证已有 Wry child 接管能力及最小 Windows 关闭 handler 扩展；记录成功、失败与未测项，报告后由用户决定是否批准下一轮 Tauri 层实验或正式集成。不得新增应用自有 unsafe，不复制认证 URL 冒充关联，不改为独立弹窗或系统浏览器。

评估结果：[隔离实验报告](archive/spikes/SPIKE-m0-child-auth.md)。Wry底层最终矩阵8/8通过，但曾有未定位原生创建失败；Tauri层未实现，不批准直接集成。
