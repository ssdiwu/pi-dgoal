# ADR 0041：Task Plan 末任务自动收口

> Status：已实现，待下一版本发布。

## 背景

Task Plan 是不含独立审核的轻量执行路径。此前它复用了 Phase/Goal Plan 的两步完成方式：所有 task 都进入 `done` 后，仍要求 agent 再调用一次 `plan_update(target=goal,status=done)`。

这让轻量路径多出一个不增加任何验证价值的模型记忆点：浮层已显示 `N/N tasks`，goal 却仍为 active；若 agent 在最后一个 task 后正常结束、发生 context compaction（上下文压缩）或续跑未送达，计划会停在看似完成却未关闭的状态。

同一处还使用 `activeForm` 保存与 task `subject` 重复的“正在……”文案。它会增加模型填参和持久化字段，却不能提供额外状态事实。

## 决策

1. **Task Plan 的最后一个 task 自动收口。** 当 `plan_update(target=task,status=done)` 成功写入 evidence 后，运行时检查隐藏 phase 中所有 task；若全部 `done` 且都有 evidence，则在同一工具调用中持久化 goal `done`、清空活动 Plan、取消 continuation（续跑）并展示完成快照。
2. **Task Plan 不再要求或提示额外的 goal done 调用。** `plan_update(target=goal,status=done)` 仍是 Phase/Goal Plan 的显式完成入口；Task Plan 的正常收口不依赖模型再次记忆该调用。
3. **移除 `activeForm`。** 它从 Task 数据模型、公开工具 schema、proposal、持久化规范化与展示中删除；加载旧 Plan 时丢弃残留字段。
4. **进行中状态由投影表达。** 持续显示浮层在 `in_progress` task 的原 `subject` 后按秒循环追加 `. / .. / ...`；这不是持久化状态，也不改变详细查询 Modal 的静态内容。

## 后果

- `N/N tasks` 与 goal 关闭成为同一原子完成动作，Task Plan 不再因遗漏的二次工具调用滞留 active。
- UI 抛错仍不能阻断收口：`finalizeGoal` 先持久化 done/null，再尽力展示完成快照。
- Phase/Goal Plan 的 `goal_check → plan_update(target=goal,status=done)` 保障链不变。
- 旧会话可读取，但旧 `activeForm` 不再显示或写回。

## 覆盖关系

本决策细化 ADR 0038 中 Task Plan 的完成路径，替代“task 全部完成后仍可显式更新 goal”的实现细节；不改变三档 Plan、check/update 职责边界，或 Phase/Goal Plan 的审核完成链。
