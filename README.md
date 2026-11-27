# Muse-multiple Muse多账号管理工作台

使用 **Rust + Tauri + TypeScript** 开发的 Muse for Meta（muse.ai）多账号图形化工作台项目。

**当前阶段：M1–M6 功能已实现；本轮按“仅 MSI”范围审查并复测通过。** 前端、合成站点、Rust 全套测试/Clippy/格式检查、Release 构建和 MSI 生成通过。MSI 尚未实际安装启动；真实 Muse A/B 隔离、会话恢复及连接器服务仍待人工验收。

## 项目入口

- [已批准执行计划](specs/EXECUTION_PLAN.md)：开发顺序、并行子代理职责、技术闸门与验收条件。
- [项目级开发约定](AGENTS.md)：参考项目分工、Rust/Tauri 规范、会话安全和 Git 同步规则。
- [原型入口](prototype/index.html) / [体验说明](prototype/README.md)：直接用浏览器打开；无需安装依赖。
- [技术对比报告](Muse-多账号工作台技术对比报告.md)：基于本地参考源码的分析，链接中的参考源码不随新仓库发布。
- [M0 正式工程](app/README.md)：原生运行、合成测试站及当前限制。
- [Muse 网页登录基线](specs/verifications/MUSE-LOGIN-BASELINE.md)：官方来源、实见页面、用户确认的验证码/两步验证流程与待验收边界。

## 已确认方向

- 冷启动进入首页；左侧折叠账号列表，标注当前账号。
- 顶部为「仪表盘」「控制台」「使用文档」「GitHub」，仪表盘和控制台分离。
- 添加时先填写名称；每账号独立持久化浏览资料，自由新建、导航和关闭标签。
- Muse普通登录留在该账号的原网页，真正出现的新窗口/普通外链按所属账号标签组处理；工作台文档和GitHub使用系统浏览器。
- 默认 15 分钟后台自动休眠；不清除登录资料；认证或未完成工作需要保护。
- 退出/系统托盘行为可设置；会话过期或服务端要求验证时允许正常重新登录。

## 当前可执行检查

在仓库根目录：

```powershell
node --check .\prototype\app.js
node .\prototype\state.test.cjs
```

这些只验证模拟原型。正式应用的构建、测试及运行方法见 [app/README.md](app/README.md)，实际结果见 [M0验证记录](specs/verifications/M0-RESULTS.md)；普通浏览器壳测试不等于原生登录验收。

## 版本管理

公开仓库：<https://github.com/jiajiayaofacai/Muse-multiple>。

每完成一轮明确范围的改动并验证后，立即提交并推送当前功能分支；通过 PR 合入 `main`。主代理统一协调多个子代理，子代理不自行提交或推送。

本地三个参考项目不纳入本仓库：两个 Muse 项目用于学习业务和会话，rust-anything 用于学习 Rust 写法、标准与规范。不提交真实浏览资料、凭据、日志、索引或构建产物。

项目为独立第三方工作台，不代表 Muse 或 Meta 官方产品。
