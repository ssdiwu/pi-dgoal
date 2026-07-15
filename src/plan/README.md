# `src/plan/`

三档 Plan 共用的纯数据层：定义 `PlanType`、`Phase`、`Task`、`TaskPlan`、`CheckRecord`，并提供依赖环检测、task 展平、完成计数与 phase 状态聚合等无副作用函数。

Task Plan 的隐藏 phase 只是 runtime 投影约定，本模块仍保持统一 phase + task 结构。状态守卫、revision/check 失效、持久化与 UI 由 `src/runtime/` 协调；本模块不访问 Pi、TUI 或 session。
