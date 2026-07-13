# plan

Task Plan 的纯数据层：定义 `Phase`、`Task`、`TaskPlan` 类型，并提供依赖环检测、task 展平与 phase 状态聚合等无副作用函数。

状态变更与 Goal Runtime 的持久化仍由 `src/runtime/` 协调；本模块不直接访问 Pi、TUI 或 session。
