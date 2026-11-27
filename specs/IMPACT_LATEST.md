---
type: impact-assessment
context: User-approved formal integration of pinned Windows connector-tab runtime patches
---

# 正式连接器标签接入影响

## Target

用户已在故障验证报告后明确批准接入正式工程。普通Muse登录仍在原页；外部应用授权使用来源账号内的新标签，保留真实opener、回调与原生自关闭。不自动发布，不读取或迁移真实资料。

## Dependents

- `app/src-tauri/src/browser/views.rs`：所有账号视图创建、导航、新窗口、关闭、原生布局。
- `app/src-tauri/src/browser/registry.rs`：来源校验、标签增删、迟到事件、账号隔离和脱敏诊断；`actions.rs`为既有调用方。
- `app/src/features/`、`app/src/shell/`：账号标签、通知、原页登录与外部授权说明。
- `app/contracts/workspace.ts`：保持现有结构及normal/authentication枚举；普通新窗口不推断为认证。
- `app/src-tauri/Cargo.toml`、`Cargo.lock`：固定四个必要crate本地补丁，保持原版本；Tauri2.11.5/runtime2.11.3/runtime-wry2.11.4/Wry0.55.1。
- 新增`app/src-tauri/vendor/`：仅四个必要crate约2.6MB及原许可证，不保存整个依赖树。保留上游归属与源码哈希清单，Cargo原生path patch，无构建期下载或补丁脚本。
- `app/tests/e2e/native-probe.cjs`及新连接器原生探测：原Deny断言需与正式行为区分；原生资料只能使用scratch合成目录。

## Affected Stories

属于已批准执行计划M0原生技术闸门，并关联M2来源标签语义。没有新的发布或M1—M6完成承诺。先前scratch成功不替代本轮生产验证。

## Test Coverage

- 现有Rust15测试：账号存储、来源诊断、状态与布局；补标签创建/关闭及迟到事件测试。
- 现有TS48测试及类型/lint/build：账号通知、HTML转义、快照和布局。
- HTTP夹具与普通Edge回调：成功回调/仅关闭/错误来源严格区分。
- 正式原生矩阵：A/B隔离、同账号共享、远程权限拒绝、真实WindowProxy与跨来源回调、自关闭清理、后台账号归属、nested/about:blank、来源先关闭、最后标签不复活。
- runtime调度辅助测试：任务保留、顺序、重入和销毁丢弃；移除所有故障注入/实验命令/日志。
- 未验证边界：真实Muse登录及第三方成功、HTTPS/COOP、永久COM失败、长期泄漏与重启会话。真实认证仅由用户操作。

## Risk: High

涉及COM已有unsafe函数内的所有权和运行时事件循环。自有应用仍禁止unsafe。使用精确window_id+不可复用UUID标签，拒绝缺失来源，不复制URL，不在COM回调内销毁controller；关闭/ready/接管结果均不合成登录或连接成功。

## Recommended action

固定方案选择仅vendoring四个必要crate，避免网络bootstrap复杂性；父代理负责依赖配置、锁文件、契约、文档及Git。三代理独立写入vendor、browser后端、features/shell前端。合并后跑全部生产质量检查与合成原生矩阵；不覆盖旧实验报告，不把历史结果冒充本轮证据。回退通过移除四项path patch和对应应用API调用，不能保留半接入状态。
