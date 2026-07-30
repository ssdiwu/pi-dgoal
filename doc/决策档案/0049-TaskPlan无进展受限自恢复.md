# ADR 0049：Task Plan 无进展受限自恢复

> Status：已接受，已实现。
> Task Plan 的 `model_error` 用户输入恢复边界后由 ADR 0050 补充；本 ADR 只规定 `no_progress` 的替换与收口例外。

## 背景

`no_progress` 是运行时活性熔断，不是用户决策暂停。Task Plan 的当前 task 已完成或 frontier 已变化时，主 agent 可能需要原子替换 Plan 或显式关闭；若与其他暂停原因同样拒绝全部写操作，会把技术熔断变成必须人工 `/dgoal resume` 的死锁。

## 决策

仅当当前 Plan 是 Task Plan 且 `pauseReason=no_progress` 时：

1. 允许 `task_plan` 原子替换并重新激活新的 Task Plan；
2. 允许已满足完成守卫的 `plan_update(target=goal,status=done)` 显式收口；
3. 不允许 `plan_create`、删除 Plan 或其他写操作。

用户暂停、`agent_blocked`、`audit_error`，以及全部 Phase/Goal Plan 的暂停，仍拒绝写入并等待用户恢复。Task Plan 的 `model_error` 不走本 ADR 的工具写入例外，其真实用户输入恢复由 ADR 0050 规定。该例外不新增 pause reason、状态、公共工具或调度器。

## 后果

- `no_progress` 继续阻止无效续跑，但不会阻止 Task Plan 的结构化重构或真实完成。
- Task Plan 不能借技术熔断逃避用户决定或静默删除已有证据。
- 运行时只依据 Plan 类型、持久 pauseReason 与结构化工具参数决定合法性，不解析 assistant 文本。
