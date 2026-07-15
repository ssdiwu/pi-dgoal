# src/startup — 启动与 Pi 注册（ADR 0024）

启动模块承载 Pi 扩展注册、事件订阅 wiring、命令路由与启动闸门逻辑。`registerDgoal` 是 Pi 扩展入口，注册工具、命令与事件处理器；`session_start`、`session_tree`、`session_compact` 统一恢复持久化 goal，工具入口还提供内存状态丢失时的惰性恢复。

## 文件

- `index.ts` — `registerDgoal`（Pi 扩展入口：注册工具/命令/事件）+ 事件处理器 wiring

## 依赖

- `src/runtime` — 工具定义、命令处理、事件处理函数、状态管理
- `src/goal-runtime` — 可变会话状态
- 不被其他模块依赖（仅 `index.ts` 调用 `registerDgoal`）