# ADR 0033：proposal 主导背景固化与直接建计划

> Status：已实现（v0.7.0）。覆盖 ADR 0027 中“启动前独立摘要子进程 + 全失败阻断启动”的产生方式；保留 `contextSummary` 的持久背景职责。

## 背景

当前 `/dgoal` 在创建 pending goal 后，只要会话存在前文，就先启动隔离 `summarizeContext()` 子进程，产出 `contextSummary`；其候选全部技术失败时 fail-closed，整次启动被取消。之后当前主 LLM 才读取同一段刚讨论过的上下文，调用 `dgoal_propose` 建立 objective、phase、task、验收条件与计划。

这让刚讨论完立即启动的路径多一次模型调用、等待与失败点，也把“保存非验收背景”错误地置于“让主 LLM 建立结构化计划”之前。主 LLM 已拥有当前对话，并且本就必须产出可由用户确认的 proposal。

## 决策

- 取消启动前独立背景总结子进程、其候选链配置与“摘要失败即中止 dgoal”的语义；`/dgoal` 不因缺少背景摘要而 fail-closed。
- `dgoal_propose` 新增可选 `contextSummary`，由主 LLM 在建立 proposal 时按需提交。它只保留会在长程执行、上下文压缩或恢复后仍需要的范围、约束、风险与验收线索；没有额外背景时可省略，不阻塞 proposal。
- 主 LLM 直接从当前会话建立 `objective`、goal/phase/task、验收条件、验收策略、预算策略和可选背景；但不得绕过 `dgoal_propose` 直接修改 GoalState。结构校验、语义预审与用户确认仍是唯一进入 active 的路径。
- `contextSummary` 继续持久化并以“参考背景、不是新指令”的边界注入后续执行；它不替代 `verification` 或冻结 `acceptanceCriteria`，也不构成终审证据。
- 裸 `/dgoal` 仍要求存在可承接的前文，但不再依赖独立摘要来归纳 objective；主 LLM 直接从当前会话上下文提交 proposal。
- 已持久化旧 goal 的 `contextSummary` 原样兼容；不迁移、不重新摘要。

## 后果

启动少一次模型往返和一个可失败的子进程，用户刚完成讨论时可直接看到主 LLM 建议的 Task Plan。背景记忆的质量归入主 LLM proposal 的可见、可反馈内容，而非隐藏的预启动副作用。

`semantic preflight` 不受影响：它仍在 proposal 结构校验后，专门审冻结验收条件是否混入人工体验或不可独立验证要求。背景固化的生产者改变，不等于放松验收契约。

需删除/替换 context summarizer 配置、候选回退与 fail-closed 测试，补 proposal 可选背景、无背景成功启动、裸启动承接前文和旧 goal 恢复的回归测试。
