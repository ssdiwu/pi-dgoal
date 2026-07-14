# src

pi-dgoal 的运行时代码，按职责拆分为计划数据、Goal Runtime、Pi 启动 wiring、审核、隔离子进程与 TUI 辅助模块。

## 模块地图

| 目录 | 职责 | 边界 |
|---|---|---|
| `plan/` | `Phase`、`Task`、`TaskPlan`、验收条件与纯 reducer/helper | 无 Pi、TUI、session 或持久化副作用 |
| `runtime/` | dgoal 工具、命令、prompt、审核编排、持久化与 Goal Runtime 过渡协调 | 主运行时编排层；不把 TUI 当业务状态源 |
| `startup/` | Pi 扩展注册、工具/命令注册、事件订阅与启动闸门 wiring | 由根 `index.ts` 间接调用 `registerDgoal` |
| `goal-runtime/` | 当前 session 的可变 goal、proposal、续跑与审核运行态单例 | 只提供状态容器，不负责工具或 UI 编排 |
| `audit/` | 审核结论解析、进度摘要、用户复核建议与脱敏检查点/用量账本 | 不负责启动审核子进程或推进 Goal Runtime |
| `isolated-pi/` | 隔离 Pi 参数构造与 JSON 行流辅助 | 不决定审核策略或失败语义 |
| `tui/` | 无状态滚动、耗时、截断、删除线等 TUI helper | 不持有 goal 状态；UI 异常由上层防御 |

## 入口与关系

- 根 `index.ts` 是 Pi 扩展 composition root（组装根），导出 runtime API 并暴露 `registerDgoal`。
- `startup/index.ts` 实现 `registerDgoal`，注册工具、`/dgoal` 命令和生命周期事件。
- `runtime/index.ts` 是当前最大的运行时协调模块；它调用 `plan`、`audit`、`isolated-pi`、`tui` 和 `goal-runtime`，但状态事实仍归 `goal-runtime/state.ts`。
- 审核子进程、TUI 渲染和计划 reducer 都不能绕过 Goal Runtime 的状态边界。

各子目录的文件级说明见对应目录内的 `README.md`。