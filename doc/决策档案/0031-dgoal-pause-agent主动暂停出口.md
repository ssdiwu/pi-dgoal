# ADR 0031：dgoal_pause——agent 主动暂停出口

> Status：工具形态已被 ADR 0038 覆盖。`agent_blocked` 暂停语义保留，入口并入 `plan_update(target=goal,status=paused,reason=...)`。

## 背景

dgoal 的核心心智是「agent 围绕目标持续工作，直到显式完成并给出验证证据」。continuation（自动续跑）在 goal active 时每轮 agent 结束后催下一轮，假设 agent 总能通过「继续工作」推进。

但存在一类 **需要用户决策才能继续的死锁**：典型是 agent 判定「冻结的 `acceptanceCriteria` 与目标意图互斥，需用户改冻结语义」——此时 agent 既不能 `dgoal_check`（会被拒）、不能 `dgoal_done`（没完成），唯一正确动作是停下问用户。

此前 agent 没有任何主动暂停出口，只能消极地连续不调工具，靠 `no_progress` 兜底（连续 3 轮无工具 → `paused`）。但前 2 轮无进展时 continuation 仍会立即催下一轮（每轮 `iteration++` 让 marker 变化、去重失效），导致 3 轮空转在约 1 分钟内密集发生，烧掉 token 才停。真实场景（pi-dteam 0.8 session）验证了这条路径。

## 决策

### 新增 `dgoal_pause` 工具

agent 遇到「必须由用户决策才能继续」的死锁时，调用 `dgoal_pause({ reason })` 立即暂停，不等 3 轮兜底。`reason` 必填，写清死锁是什么、需要用户做什么决策。

### 新增 `agent_blocked` pauseReason + `pauseReasonDetail`

`pauseReason` 扩展为 `… | agent_blocked`；`GoalState` 加 `pauseReasonDetail?: string` 存 agent 声明的原因，供通知/状态展示。

resume 语义归入「异常中断」类：`rejectedCount` 不清零（保留审计记忆），`consecutiveNoProgressTurns` 由 `resumeGoal` 无条件清零（给 agent 完整重试预算）。

### no_progress 保留作兜底

`dgoal_pause` 与 `no_progress` 互补：`dgoal_pause` 是 agent 懂事时的显式出口；`no_progress` 仍是 agent 不懂事（闷头空转）时的兜底。两者不互斥。

### system prompt 引导防滥用

`buildSystemPrompt` 循环规则明确：仅当遇到必须由用户决策的死锁才调 `dgoal_pause`；一时困难不算死锁，要先尝试替代方案/调试/缩小范围。

## 为什么

dgoal 假设「继续工作就能完成」，但死锁态下「继续工作」本身是空转。给 agent 一个结构化、显式、带原因的出口，比让它消极空转 3 轮烧 token 更诚实、更省成本，也让用户第一时间拿到「agent 被什么卡住」的信息。

把出口做成工具（而非解析 agent 自然语言判断死锁）：结构化、确定性、可测试，不依赖脆弱的文本匹配。

## 权衡

**备选 A：降低 `MAX_NO_PROGRESS_TURNS`（3 → 1 或 2）**。治标——仍是被动漫进，且会误杀 agent 正常的纯文字总结/分析轮（agent 解释思路时也可能一轮不调工具）。不区分「主动声明死锁」与「消极空转」。

**备选 B：解析 agent 文本判断是否在表达死锁**。不可靠——自然语言多变，误判率高，且把暂停决策建立在脆弱的文本匹配上。

**本决策（新工具）的代价**：新增一个工具 + pauseReason + 字段 + system prompt 引导，且防滥用主要靠 prompt 约束而非强制。但出口是结构化、显式、可观测（`pauseReasonDetail` 进持久化与通知），滥用会在 `reason` 和日志里留痕，可追溯。值得。

## 代价

`dgoal_pause` 工具 + `agent_blocked` pauseReason + `pauseReasonDetail` 字段 + `buildSystemPrompt` 引导一条 + resume 语义（复用现有「不清零 rejected」分支，无新分支）。测试覆盖：active/rejected 可暂停、paused 不覆盖原 reason、无 goal / pending 不可暂停、resume 清零空转计数、工具注册可见。
