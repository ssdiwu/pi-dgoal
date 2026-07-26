# ADR 0047：Task Plan 任务耗尽后显式收口

> Status：已接受，已实现。

## 背景

Task Plan 的末任务自动收口把“当前已知 task 全部完成”误作“goal 已完成”。当 task 是基于当前证据逐步生成的最小行动时，最后一个 task done 只说明当前候选任务已经耗尽；主 agent 仍须根据该 task 的结果决定继续新增 task、替换 Plan，或确认目标可以关闭。

## 决策

1. 最后一个 Task Plan task 进入 `done` 后，Plan 保持 `active`；工具结果、frontier 和 prompt 明确要求主 agent 做下一步决策。
2. 主 agent 的合法出口是：`plan_create` 新增由新证据支持的 task；`task_plan` 整份替换目标已重新理解的 Task Plan；或在回读全部 task Description 与显式交付物后，调用 `plan_update(target=goal,status=done)`，以 `summary` 和 `verification` 显式关闭。
3. Task Plan 继续无独立审核。其显式关闭仍要求所有 task 有可复验证据、声明交付物有逐项证据，并由主 agent 的完成总结与验证说明承担原末任务自检职责。
4. `Task Plan` 的隐藏 phase 仍不可直接更新；不增加 Plan 类型、状态、公共工具、调度器或 Git 动作。

## 后果

- Task Plan 的 task 耗尽成为候选—观察—比较—学习内循环的决策边界，而不是外层建检循环的自动终点。
- `N/N tasks` 时 goal 可继续保持 active，主 agent 能依据最新 evidence 继续定义 task；真实用户改变目标时仍使用原子 `task_plan` 替换。
- ADR 0041 的自动收口结论及 ADR 0046 的末任务自检位置被本决策覆盖；交付物逐项证据和压缩后 Plan 优先的边界保留。
