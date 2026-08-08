# `src/runtime/`

单一 Work List 运行时承载层：九个公共工具、`/dgoal` 命令、Plan Contract 生命周期、proposal 语义预审、独立审核编排、双持久键、prompt 与 TUI 投影。

## 模块边界

- `proposal.ts`：proposal 结构归一、readiness 与确定性校验。
- `liveness.ts`：Plan Contract 的结构化 activity / durable progress 指纹、3/8 no-progress 判定与计数迁移。
- `index.ts`：九工具、命令、启动确认、状态/History 持久化、审核、continuation 与 TUI 组合；不再保留旧 Plan 域或 `plan-view.ts`。
- `src/work-list/`：Work List 纯数据、planned/soft 校验与 reducer；runtime 不复制其状态规则。

## 公共工具

- 建立 / 升级：`work_list` / `execution_plan` / `goal_plan` / `staged_plan`
- 管理 / 读取：`work_create` / `work_read` / `work_update`
- 独立建检：`phase_check` / `goal_check`

soft Work List 跨 turn 保留但不自动续跑；全部 Work Item terminal 且真实 Phase done 时自动收口。Execution 增加 Until Done 与固定熔断但不审核。Goal Check 只冻结 goal contract；Staged Check 至少一个真实 Phase，并冻结 Phase + goal contract。Profile 只允许单向升级。

`phase_check` / `goal_check` 只写 revision-bound CheckRecord；`work_update` 是 Work Item / Phase / Goal 状态、完成与主动暂停的唯一 agent 写入口。Phase 成员耗尽不自动 done；local facts 改变会失效 phase check，done Phase 不再改写。Staged 仍有 open Phase 时不能新增 root Work Item；全部 Phase done 后可追加由 goal 终审覆盖、可恢复的 goal-level follow-up。planned Work Item 要求 Description / evidence / deliverableEvidence；soft Work Item 可保持轻量。`work_read` 和审核 prompt 投影完整 Description、deliverables 与逐项证据。

## Proposal 与审核

Goal Check / Staged Check 必须有显式用户授权。结构与语义预审成功后进入确认 UI；失败、拒绝、session 变化或 UI throw 不修改现有 Work List。语义预审负责独立验收 / user review / blocker 分流，拒绝未来审核器无法取得的历史证据。

phase / goal check 复用 `src/audit/` 与 `src/isolated-pi/`。业务 rejection 保持 active；技术候选耗尽进入 `paused(audit_error)`；迟到结果按 session generation + Goal ID + relevant revision 丢弃。

## 持久化、History 与关闭

当前态写 `dgoal-work-v1`，History 写 `dgoal-plan-history-v1`；v0.8.1 之前的活动状态不读取、不迁移。load guard 严格复验 Goal / Work List / Contract / proposal 组合。History 按 Plan Run ID 去重，保留结构化完成证据与 check 结论，删除 auditor report、feedback、thinking 与 transcript。

所有 Profile 关闭收敛到同一事务：可选归档 → Goal done → null tombstone → continuation / proposal / liveness / check snapshot / authorization 清理 → UI after-effect → 返回 `dgoal 完成信号`。UI 错误不得阻断前述事实。

`session_compact` 只为 active Plan Contract 重新投递 continuation（Pi 未自行 retry 时）；soft Work List 只恢复状态。`work_read` 与 `/dgoal s` 共享纯派生 frontier；Current / History Modal 不写状态。done Phase 的执行 prompt 投影只留标题，持久态与 TUI 仍保留完整信息。
