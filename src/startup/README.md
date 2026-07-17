# `src/startup/` — Pi 注册与事件 wiring

`registerDgoal` 是扩展入口，注册八个公共工具、`/dgoal` 命令与 session / input / agent / tool 事件处理器。

## 职责

- 注册 `task_plan` / `phase_plan` / `goal_plan`、`plan_create` / `plan_read` / `plan_update`、`phase_check` / `goal_check`。
- `before_agent_start` 默认注入 Task Plan guidance：明确多步执行或 AFK、有界、低风险探索可主动建计划；当前 frontier 变化时整份替换；生成前做不新增硬门的轻量自检；讨论和单步回答不建，不得自行升级 Phase/Goal Plan。
- 识别真实用户明确要求使用 dgoal 的自然语言显式授权，并叠加 Phase/Goal Plan 启动 guidance；能力问句、引用、否定与 extension 注入不授权。
- `session_start` / `session_tree` / `session_compact` 只恢复 `dgoal-plan-v2` 状态和持续显示浮层；v1 不迁移。
- 在工具结束和 agent turn 结束时刷新状态投影与无进展熔断。

不存在隐式 proposal、runtime budget 消费或隐式动作 preflight。Task Plan 不扩大宿主权限；真实工具动作仍由 Pi 与对应扩展的权限边界决定。

## 文件

- `index.ts` — `registerDgoal` 与全部事件处理器 wiring

## 依赖

- `src/runtime` — 工具、命令、状态与 prompt
- `src/goal-runtime` — 可变会话状态
- 仅由仓库根 `index.ts` 调用
