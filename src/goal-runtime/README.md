# `src/goal-runtime/` — Goal Runtime（可变 session 状态）

Goal Runtime 独占 current Goal / Work List / Plan Contract、pending proposal、Plan Run History、continuation、结构化活性计数、审核 workspace/check snapshot、自然语言显式授权与 Execution `model_error` 精确用户输入恢复 token。其他模块只通过 `goalRuntimeState` 单例读写这些 session 事实。

## 文件

- `types.ts` — `GoalState`、`PlanContract`、`PlanProposal`、Plan Run History、审核反馈与生命周期类型；依赖 Work List 纯类型，不依赖 runtime。
- `state.ts` — 可变 session 状态单例与重置；持有每轮 activity / durable progress、3/8 停滞计数及不持久化的一次性授权。
- `commit.ts` — 保持 `currentGoal` 内存赋值与持久化调用相邻；不接管 continuation、check snapshot 或 UI after-effect。

## 依赖

- `types.ts` 只依赖 `src/work-list` 类型与审核 checkpoint 类型；`state.ts` 只依赖本目录类型。
- 不依赖 runtime、startup、isolated-pi 或 tui，避免与运行时编排形成循环依赖。
- 不依赖 runtime、startup、isolated-pi 或 tui，避免与运行时编排形成循环依赖。
