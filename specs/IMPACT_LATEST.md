---
type: impact-assessment
context: Parallel frontend/backend flow-state corrections and isolated Tauri connector-tab verification; no production runtime patch applied
---

# Muse 原页登录与连接器授权：当前改动影响

## Target

用户再次明确：普通登录留在原标签；连接应用时在新标签授权，完成后该标签自动关闭，Muse原页显示连接成功。本轮并行开发生产前后端状态与诊断，另在scratch做Tauri连接器标签实验；不将未验证依赖补丁应用生产。

## Dependents

- `app/src-tauri/src/browser/registry.rs`、`views.rs`：启动验证状态、按发起账号/标签拒绝新窗口的诊断。生产仍Deny，未放宽权限。
- `app/src/features/`、`shell/`：原页登录说明、账号内授权/外链请求反馈；不合成原生标签或connected状态。
- `app/tests/sites/`、`tests/e2e/native-probe.cjs`：回调成功与仅关闭分离；A发起/B活跃时归属校验。
- `WorkspaceSnapshot`现有字段与IPC契约保持不变；不新增依赖。
- 独立scratch Tauri/Wry副本：精确child、来源environment、原生关闭和接管结果；结果不能直接等同正式应用支持。

## Affected Stories

按已批准执行计划属于M0现有基线修正及连接器原生验证，关联M2来源标签语义。没有创建新story目录，不宣称M1—M6完成。原页真实登录/重建/重启恢复仍待用户人工验收。

## Test Coverage

- Rust：启动不假报全局登录失败、来源账号在后台时的归属、关闭/错误来源迟到事件、状态不复活。
- TS：说明文案/账号通知选择、无事件/其他账号/空态、渲染逃逸；旧revision保持现有acceptSnapshot规则。
- 合成与原生：A/B存储隔离、同账号共享、远程IPC拒绝、最后标签空态；合法回调才报告合成成功。
- 缺口：真实连接器服务端成功、真实Muse/两步验证、HTTPS跨站/COOP、持久化真实会话。

## Risk: Medium / High

生产修正保持既有Deny与契约，风险为状态/来源通知回归；需单测、类型/构建与原生验证。隔离runtime实验风险高，禁止把编译通过或关页事件当作授权成功；不得复制URL、自有unsafe、系统浏览器或独立授权窗口降级。

## Recommended action

三个互不重叠写入泳道：前端features/shell，后端registry/views，原生代理仅scratch。主代理负责契约、合成探测、配置/文档和Git。一次收敛后做相关验证，按实际结果报告生产能力与实验能力差异。

历史底层评估保留在[spike报告](archive/spikes/SPIKE-m0-child-auth.md)，原页基线见[网页登录说明](verifications/MUSE-LOGIN-BASELINE.md)。
