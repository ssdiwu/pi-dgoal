# src

pi-dgoal 运行时代码，按 Work List 数据、Goal Runtime、Pi 启动 wiring、审核、隔离子进程与 TUI helper 分层。

## 模块地图

| 目录 | 职责 | 边界 |
|---|---|---|
| `work-list/` | Work List / Work Item / WorkPhase / CheckRecord 类型、soft/planned 校验、依赖与 reducer | 无 Pi、TUI、session 或持久化副作用 |
| `runtime/` | 九工具、命令、prompt、frontier、Plan Contract 活性、审核编排、双持久键、History 与 TUI 组合 | 主协调层；check 只记录，`work_update` 写完成；不把 TUI 当状态源 |
| `startup/` | Pi 扩展注册、工具/命令注册、session/input/agent/tool 事件 wiring | 由根 `index.ts` 间接调用 `registerDgoal` |
| `goal-runtime/` | 当前 session 的 Goal、Plan Contract、proposal、History、continuation 与审核运行态容器 | 不负责公共工具或 UI 编排 |
| `audit/` | 审核结论、进度摘要、用户复核建议、脱敏 checkpoint 与 usage ledger | 不启动 child，不推进 Goal 状态 |
| `isolated-pi/` | 隔离 Pi 参数、进程监督与 JSON line stream | 不决定审核策略或完成语义 |
| `tui/` | 无状态滚动、宽度、耗时、截断与文本样式 helper | 不持有 Goal；UI 异常由上层 fail-soft |

## 入口与关系

- 根 `index.ts` 是 composition root（组装根），导出 runtime API 并暴露 `registerDgoal`。
- `startup/index.ts` 注册九工具、`/dgoal` 命令和生命周期事件。
- `runtime/index.ts` 编排跨边界事务；`runtime/proposal.ts` 处理 proposal 结构；`runtime/liveness.ts` 处理 Plan Contract 活性。
- 数据规则归 `work-list/`，可变 session 事实归 `goal-runtime/state.ts`；审核子进程、TUI 和 reducer 都不能绕过公共状态边界。

各子目录的文件级说明见对应 `README.md`。