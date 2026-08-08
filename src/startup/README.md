# `src/startup/` — Pi 注册与事件 wiring

`registerDgoal` 是扩展入口，注册九个公共工具、`/dgoal` 命令及 session / input / agent / tool 事件处理器。

## 职责

- 注册 `work_list` / `execution_plan` / `goal_plan` / `staged_plan` / `work_create` / `work_read` / `work_update` / `phase_check` / `goal_check`。
- `before_agent_start` 默认注入 soft Work List guidance：普通多步工作可按需跟踪；讨论、解释和单步回答不建清单。确需 Until Done 时用 `execution_plan`，不得为形式增加 Plan Contract。
- 识别真实用户明确要求使用 dgoal 的自然语言授权并注入 Goal Check / Staged Check guidance；能力问句、引用、否定、处理中追加与 extension 注入不授权，也不能静默降级为 Execution。
- Execution 达到 `model_error` 阈值后，可由 Goal ID + 原 prompt 精确绑定的下一条真实、非流式 interactive/RPC 输入一次性恢复；extension、流式 follow-up 与 prompt 改写不能走该路径。
- `session_start` / `session_tree` / `session_compact` 只恢复 `dgoal-work-v1` 与 `dgoal-plan-history-v1`，递增 session generation 并隔离旧审核/continuation。compaction 仅为 active Plan Contract 补 continuation；soft Work List 不补。
- 每轮只在 Plan Contract active 时冻结结构化指纹、记录 activity / durable progress 并执行 3/8 双层熔断；soft Work List 不进入 no-progress 计数。
- tool / agent 事件结束后刷新 fail-soft TUI 投影；事件 wiring 不逐字段复制 Work List 或 Plan Contract 状态机。

不存在隐式 proposal、runtime budget、旧工具 alias 或旧持久态恢复。真实工具动作仍由 Pi 与对应扩展的权限边界决定。

## 文件

- `index.ts` — `registerDgoal` 与全部事件处理器 wiring

## 依赖

- `src/runtime` — 九工具、命令、状态、History 与 prompt
- `src/goal-runtime` — 可变 session Goal / continuation / liveness 状态
- 仅由仓库根 `index.ts` 调用
