# `src/plan/`

三档 Plan 共用的纯数据层：定义 `PlanType`、`Phase`、`Task`、`TaskPlan`、`CheckRecord`，并提供依赖环检测、task 展平、完成计数、phase 状态聚合、`deriveTaskGraph` 依赖图读模型，以及由 runtime 注入 i18n 的纯 Plan reducer。

`Phase` / `Task` 的 `description` 是必填执行说明字段。Task Plan 的隐藏 phase 只是 runtime 投影约定；本模块仍保持统一 phase + task 结构，其内部 description 由 runtime 复用 goal description，外部不投影该 phase。phase 与 task 使用独立 ID namespace，二者都从 `1` 开始；task ID 在整个 Plan 内唯一，`nextId` 只分配 task。`deriveTaskGraph` 只从现有 phase/task status 与去重后的 `blockedBy` 派生 ready、waiting、phase/task 根阻塞与 ready task 完成后的立即解锁关系，不持久化图状态，也不调度执行。`reducer.ts` 只处理不可变 Plan 变更与状态/依赖守卫；runtime 提供翻译函数并负责 revision/check 失效、持久化与 UI。本模块不访问 Pi、TUI 或 session。
