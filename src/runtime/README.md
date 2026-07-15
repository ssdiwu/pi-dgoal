# `src/runtime/`

三档 Plan 的运行时承载层：八个公共工具、`/dgoal` 命令、proposal 语义预审、独立审核编排、持久化、prompt 和浮层投影。

## 公共工具

- 建立：`task_plan` / `phase_plan` / `goal_plan`
- 管理：`plan_create` / `plan_read` / `plan_update`
- 审核：`phase_check` / `goal_check`

Task Plan 可直接建立和整份替换，隐藏内部单 phase。Phase/Goal Plan 复用显式启动闸门；`phase_plan` 只冻结 goal 条件，`goal_plan` 同时冻结 phase 条件。

`phase_check` / `goal_check` 只写带 revision 的 `CheckRecord`；`plan_update` 是 agent 可调用的 task / phase / goal 执行状态、完成和主动暂停写入口。用户命令与技术熔断仍可暂停/恢复；Plan 写操作使旧审核记录失效。

## Proposal 语义预审

只用于 Phase/Goal Plan。确定性代码校验结构、状态、Plan 类型与用户授权；当前会话模型负责独立验收 / 用户复核 / 人工 blocker 语义分流。预审默认 60 秒 idle timeout，可配置 `proposalSemanticReviewIdleTimeoutSeconds`；终态为 approved / rewritten / rejected / technical_error。

自然语言明确要求使用 dgoal 可形成一次性显式授权，但仍经过预审与确认 UI。不存在隐式 proposal 或 runtime budget 路径。

## 独立审核

phase/goal check 复用 `src/audit/` 与 `src/isolated-pi/`。业务 rejection 保持 Plan active；技术异常候选耗尽则 paused(audit_error)。审核通过不直接完成，后续必须由 `plan_update` 通过状态守卫。

## 持久化与 UI 边界

新状态写入 `dgoal-plan-v1`；旧 entry 不迁移。持久化必须先于 UI 更新，`setWidget` / status / notify / Modal 异常不能阻断状态机。
