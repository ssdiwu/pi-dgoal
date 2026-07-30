# ADR 0050：Task Plan 模型错误由真实用户输入恢复

> Status：已接受，已实现。

## 背景

主模型连续错误达到固定阈值后，运行时会进入 `paused(model_error)`，阻止后台继续重试。旧实现遇到下一次 agent turn 时直接清除暂停的 Task Plan，导致已有 task、evidence 与 revision 一并丢失；这既不是恢复，也无法区分真实用户输入与扩展注入。

Task Plan 是日常执行脚手架。模型错误应停止无人值守空转，但真实用户再次交互已提供新的执行机会，不应要求用户额外记忆 `/dgoal resume`，更不应静默丢弃原 Plan。Phase/Goal Plan 属于用户显式选择的高保障链，恢复授权仍应保持显式。

## 决策

仅当当前 Plan 是 Task Plan 且 `pauseReason=model_error` 时：

1. `interactive` / `RPC` 的真实、非流式用户输入建立一次性恢复授权；授权精确绑定当前 goal ID 与原始输入文本。
2. `before_agent_start` 仅在 goal ID、暂停原因、Plan 类型与 prompt 全部匹配时恢复同一 Plan；恢复保留 objective、description、task、evidence 与 revision，累计暂停时长并清零模型错误及两类无进展计数。
3. 当前用户 turn 本身就是恢复后的执行入口，不额外发送 synthetic continuation。
4. extension 输入、流式 follow-up、未知来源、被其他扩展改写后的 prompt 均不能触发恢复；一次性授权随后清除并保持 paused。
5. Phase/Goal Plan 的 `model_error` 仍必须由 `/dgoal resume` 显式恢复；Task Plan 的 `no_progress` 例外继续按 ADR 0049 处理。
6. 没有真实用户输入时保持 paused，不增加后台重试、daemon 或 scheduler。

## 后果

- 瞬时错误仍先按固定阈值自动重试；达到阈值后停止空转。
- 用户再次交互即可继续原 Task Plan，也可在恢复后由主 agent 根据新意图调用 `task_plan` 原子替换。
- 已完成 task 与 evidence 不再因下一 turn 被静默删除。
- 恢复授权只存在于 Goal Runtime 内存，不进入持久化，也不形成新的 Goal 状态或 pause reason。
