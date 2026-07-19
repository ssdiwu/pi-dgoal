# `src/runtime/`

三档 Plan 的运行时承载层：八个公共工具、`/dgoal` 命令、proposal 语义预审、独立审核编排、持久化、prompt 和浮层投影。

## 公共工具

- 建立：`task_plan` / `phase_plan` / `goal_plan`
- 管理：`plan_create` / `plan_read` / `plan_update`
- 审核：`phase_check` / `goal_check`

Task Plan 可直接建立和整份替换 objective、goal description 与全部 task，隐藏内部单 phase。Phase/Goal Plan 复用显式启动闸门；三层 Description 必填，goal description 随确认冻结，phase/task 可显式修订；`phase_plan` 只冻结 goal 条件，`goal_plan` 同时冻结 phase 条件。Description 进入主 agent 执行上下文，但不是独立审核完成门。新 Plan 的 phase 与 plan-global task 使用各自从 `1` 开始的 ID namespace，`nextId` 仅分配 task；v1 持久态不迁移。

`phase_check` / `goal_check` 只写带 revision 的 `CheckRecord`；`plan_update` 是 agent 可调用的 task / phase / goal 执行状态、完成和主动暂停写入口。用户命令与技术熔断仍可暂停/恢复；Plan 写操作使旧审核记录失效。

## Proposal 语义预审

只用于 Phase/Goal Plan。主 agent 在提交前先做固定的精简质量检查：核对端到端结果、适用时的对象/状态生命周期与真实调用链、失败路径，以及 Plan 结构和冻结验收契约是否一致；简单目标允许判定某项不适用，检查结果直接修正 proposal，不生成报告、模型调用、状态或 hard gate。确定性代码随后校验结构、状态、Plan 类型与用户授权；当前会话模型负责独立验收 / 用户复核 / 人工 blocker 语义分流，并拒绝依赖未来审核器不可取得证据的冻结条件，例如无可导出不可变审计记录支撑的历史否定事实。此类条件不得迁移为用户复核，而应收缩为可观察、可独立复验的主张后重新提交。提案作者提示在提交前采用同一证据边界；拒绝结果可携带逐条件 `issues`，一次列出全部发现的不可准入条件及改写方向。预审默认 60 秒 idle timeout，可配置 `proposalSemanticReviewIdleTimeoutSeconds`；终态为 approved / rewritten / rejected / technical_error。

自然语言明确要求使用 dgoal 可形成一次性显式授权，但仍经过预审与确认 UI。不存在隐式 proposal 或 runtime budget 路径。

## 独立审核

phase/goal check 复用 `src/audit/` 与 `src/isolated-pi/`。业务 rejection 保持 Plan active；技术异常候选耗尽则 paused(audit_error)。审核通过不直接完成，后续必须由 `plan_update` 通过状态守卫。

## 持久化与 UI 边界

新状态写入 `dgoal-plan-v2`；`dgoal-plan-v1` 与更早 entry 不迁移，`contextSummary` 不再属于状态或 proposal。恢复时按 Plan 类型严格复验 goal/plan 的 Description、验收契约、状态与依赖，以及 pending proposal 的完整结构；任一脏字段使整条 entry 失效。`plan_read` 与 `/dgoal s` 共享纯派生的当前 frontier 诊断，只说明直接原因和下一合法动作；二者还会组合现有 `CheckRecord`、最新 feedback、task evidence 与最新完成声明，但不展示内部历史索引，也不新增持久字段。`/dgoal s` 使用列表/详情两层 Modal，返回保留选择；持续浮层不显示 Description 或诊断。持久化必须先于 UI 更新，`setWidget` / status / notify / Modal 异常不能阻断状态机。
