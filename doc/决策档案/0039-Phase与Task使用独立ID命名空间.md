# ADR 0039：Phase 与 Task 使用独立 ID 命名空间

> Status：已实现，待下一版本发布。

## 背景

ADR 0038 让三档 Plan 共享 phase + task 数据结构，并要求所有公共工具显式区分 `target=phase|task`、`phaseId` 与 task `id`。此前实现仍让 phase 和 task 共用同一个数字 ID 序列：Phase/Goal Plan 先占用 phase ID，再从 phase 数量之后分配 task ID；Task Plan 的隐藏 phase 也会占用第一个 ID。

这造成公开编号不符合用户直觉：Task Plan 的第一个 task 曾从 `#2` 开始；即使后来用隐藏 phase `#0` 绕开，仍引入了只为共享序列服务的内部特殊值。共享序列本身没有消除真实歧义，因为调用方始终需要先说明对象类型；`blockedBy` 也只引用 task。

## 决策

1. **phase 与 task 使用两个独立 ID namespace。** 新建 Plan 的 phase 按 `1..N` 连续编号；task 也从 `1` 开始，并在整个 Plan 内全局唯一、持续递增。
2. **task 不按 phase 重新编号。** `blockedBy` 可引用同 phase 或更早 phase 的 task，因此 task ID 必须在整个 Plan 内唯一；不能在每个 phase 内重复从 `1` 开始。
3. **`TaskPlan.nextId` 只表示下一个 task ID。** 为兼容现有 `dgoal-plan-v1` 数据形态，本次不重命名字段；新 Plan 不再把 phase 数量计入 `nextId`。
4. **同号 phase/task 由类型化入口消歧。** `plan_read` / `plan_update` 使用 `target`，`plan_create` 使用 phase 定位，`phase_check` 只接收 phase；工具结果与诊断必须明确写 phase 或 task。不得新增不带对象类型的通用数字 ID 入口。
5. **旧持久态原样兼容。** 已存在的 `dgoal-plan-v1` 不迁移、不重写 ID；其较大的 `nextId` 继续作为安全的后续 task ID。新建或整份替换 Plan 才使用双 namespace。
6. **Task Plan 不再需要特殊 phase ID。** 隐藏 phase 可正常使用 `#1`，公开 task 同时从 `#1` 开始；工具、prompt 与 TUI 继续隐藏该 phase。

## 后果

- phase `#1` 与 task `#1` 可以同时存在；所有调用、日志和错误必须带对象类型。
- Task Plan、Phase Plan、Goal Plan 的首个公开 task 都从 `#1` 开始，phase 也保持直观的 `#1..#N`。
- `blockedBy`、环检测、跨 phase 依赖与 `plan_create` 只处理 plan-global task ID，不受 phase ID 重叠影响。
- 旧 Plan 可能继续保留 phase/task 不重叠且 task 从较大数字开始的编号；这是兼容事实，不作为新建 Plan 的规范。
- 若未来引入跨类型通用节点引用，必须使用带类型的复合引用，而不能重新依赖数字全局唯一。

## 覆盖关系

本决策扩展 ADR 0038 的共享数据结构与八工具职责边界，替代其实现中 phase/task 共用数字序列的细节；不改变三档 Plan、隐藏 phase、状态机、revision、check/update 分离或持久化键。
