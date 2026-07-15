# src/goal-runtime — Goal Runtime（可变会话状态）

Goal Runtime 独占当前 goal、pending proposal、续跑状态、计数器、自然语言显式启动的一次性授权、终审反馈与修复账本等可变 session 状态（ADR 0025）。其他模块只通过 `goalRuntimeState` 单例对象读写状态。

## 文件

- `state.ts` — 可变会话状态单例对象与重置函数。所有模块级 `let` 可变状态集中在此，避免分散在 runtime 各处。

## 依赖

- `src/plan` — 仅类型（GoalState、PlanProposal）
- 不依赖 runtime、startup、audit、isolated-pi、tui（无循环依赖）
