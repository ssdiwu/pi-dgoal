# src/startup — 启动与 Pi 注册（ADR 0024）

启动模块承载 Pi 扩展注册、事件订阅 wiring、命令路由与启动闸门逻辑。`registerDgoal` 是 Pi 扩展入口，注册工具、命令与事件处理器；`session_start`、`session_tree`、`session_compact` 统一恢复持久化 goal，工具入口还提供内存状态丢失时的惰性恢复。`input` 只从空闲的 `interactive` / `rpc` 来源识别祈使式自然语言 dgoal 指令，拒绝问句、引用/讨论、否定、标识符后缀及处理中追加输入；`before_agent_start` 要求 prompt 与 dgoal handler 观察到的文本完全一致并注入工具指导，`agent_settled` 清理未消费授权（ADR 0036）。Pi 不提供不可变 input 原文，早于 dgoal 的受信任 transform 属于扩展全权限信任边界。

## 文件

- `index.ts` — `registerDgoal`（Pi 扩展入口：注册工具/命令/事件）+ 事件处理器 wiring

## 依赖

- `src/runtime` — 工具定义、命令处理、事件处理函数、状态管理
- `src/goal-runtime` — 可变会话状态
- 不被其他模块依赖（仅 `index.ts` 调用 `registerDgoal`）