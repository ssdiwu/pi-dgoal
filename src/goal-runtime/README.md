# src/goal-runtime — Goal Runtime（可变会话状态）

Goal Runtime 独占当前 goal、pending proposal、续跑状态、计数器、自然语言显式启动与 Task Plan `model_error` 用户恢复的一次性授权及其精确 input 绑定、终审反馈与修复账本等可变 session 状态（ADR 0025、0050）。其他模块只通过 `goalRuntimeState` 单例对象读写状态。

## 文件

- `types.ts` — `GoalState`、`PlanProposal`、审核反馈与生命周期类型；不依赖 runtime，作为状态容器和运行时的共同类型边界。
- `state.ts` — 可变会话状态单例对象与重置函数；同时持有每轮工具活动、持久进展指纹、硬/软停滞计数，以及不持久化的一次性输入授权。所有模块级 `let` 可变状态集中在此，避免分散在 runtime 各处。
- `commit.ts` — 把 `currentGoal` 的内存赋值与对应持久化调用保持相邻；不接管各路径不同的 continuation、check snapshot 或 UI 后效。

## 依赖

- `types.ts` 只依赖 `src/plan` 类型和审核 checkpoint 类型；`state.ts` 只依赖本目录类型。
- 不依赖 runtime、startup、isolated-pi 或 tui，避免与运行时编排形成循环依赖。
