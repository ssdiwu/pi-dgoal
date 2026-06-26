# 26 - Datawhale Loop Engineering 三文件循环参考

> 2026-06 调研。对象：Datawhale 公众号《刚刚，全网爆火的Loop Engineering，保姆教程来了！》（2026-06-24，筱可）。同时核对正文 3 张主图：builder/loop/checker 流程图、停止规则总览图、`.claude/` 目录结构图。结论用于判断它对 pi-dgoal 的借鉴意义，不用于照搬 Claude Code 配置。

## 1. 总体判断

**部分值得借鉴，但不是方向性新增。** 这篇推文证明了“把构建者和检查者拆开，并用停止规则约束循环”正在成为 coding agent 的大众化实践；但 dgoal 已经把核心做成更强的产品级机制：`dgoal_check` 是 phase 完成的唯一入口，终审不过进入 `rejected`，连续 3 次不过进入 `paused(audit_failed_3x)`。

真正值得吸收的不是 `.claude/agents/builder.md`、`.claude/commands/loop.md` 这些文件形态，而是两条工程纪律：**checker 报告必须原样保真传递**，以及**停止规则要识别“同一失败/无进展/回归”这类非全绿失败模式**。这两条可转化为 dgoal 的失败报告钉回和终审失败历史增强。

## 2. 核心机制速览

### 2.1 三文件闭环

推文给出的最小 Loop Engineering 由三类文件组成：

- `.claude/agents/builder.md`：实现/修复 agent，拥有 `Write` / `Edit` 等写权限。
- `.claude/agents/checker.md`：检查 agent，仅有 `Read` / `Grep` / `Glob` / `Bash`，从工具层禁写。
- `.claude/commands/loop.md`：斜杠命令编排器，循环调用 builder → checker，checker `ALL GREEN` 才停，否则把失败报告原样回传给 builder。
- `CLAUDE.md`：项目级停止规则，列出全绿、轮次用尽、同一失败连续两轮、回归、无实质进展、超出能力边界等刹车条件。

配图核对：第一张图是 `builder.md → loop.md → checker.md` 的流程，checker 失败后回环；第三张图展示 `.claude/agents/builder.md`、`.claude/agents/checker.md` 和 `.claude/commands/loop.md` 的目录放置。

### 2.2 Builder / Checker 权限隔离

推文的核心主张是“执行和验证必须拆开”：builder 只写和修，checker 只检查不改。重点不是提示词里说“不要改”，而是 checker 的 `tools` 字段没有写工具，靠工具可见性隔离降低自我判卷风险。

一手来源核实：Claude Code 官方 subagents 文档确认 custom subagent 有独立 context window、custom system prompt、specific tool access、independent permissions，并支持 `.claude/agents/` 项目级定义。因此推文里的工具隔离机制是 Claude Code 支持的真实机制，不是纯 prompt 伪造。

### 2.3 编排器只做转发，不做二手解读

推文反复强调：checker 失败后，编排器必须把完整失败报告原样转发给 builder，不要总结、过滤或意译。原因是行号、堆栈、中间输出会在“好心总结”里丢失，builder 拿到二手摘要就会瞎猜。

这也是推文实践坑位里最有价值的一条：循环效率由 checker 报告质量决定；报告模糊一轮，整个 loop 就白跑一轮。

### 2.4 停止规则不是只有 max cycle

推文的停止规则图列了 6 个条件：

1. `ALL GREEN`：全绿即停。
2. 轮次用尽：5 轮上限。
3. 同一失败两轮：builder 在猜。
4. 回归：拆东墙补西墙。
5. 无实质进展：任务太大需拆分。
6. 超出能力边界：外部依赖或环境问题。

配图核对：第二张图正是这 6 条规则的概览，其中 1 是绿色通过态，2 是黄色上限态，3-6 是红色风险态。

### 2.5 “全绿”只是代码检查，不等于目标完成

推文把 `pnpm check` 这类聚合命令作为 checker 的天然输入，覆盖 test / lint / dep-guard / deadcode / tsc / format。它解决的是“代码检查是否全绿”，不是“用户目标是否真实达成”。

外部佐证：Sonar《Loop engineering without verification is just automation》把验证分成两层：LLM verifier 适合判断意图和语义，deterministic code verification 才适合作为硬 gate。Anthropic《Building Effective AI Agents》也把 evaluator-optimizer 定义为“一个 LLM 生成，另一个 LLM 循环评估反馈”，并强调 coding agents 的优势来自可被测试验证。

## 3. 与 pi-dgoal 的关系

### 3.1 设计冲突（明确不借）

**不借 `.claude/` 三文件形态。** dgoal 是 Pi extension，不是 Claude Code 项目脚手架。把 builder/checker/loop 写进用户项目会把 dgoal 退化成每个 repo 都要维护的 prompt 文件，违背 dgoal 作为通用 goal loop 扩展的定位。

**不借 provider 配置和 `step-3.7-flash` 绑定。** 推文里的 StepFun 配置是 Claude Code 用户侧 provider 选择，不属于 dgoal 职责。dgoal 不硬编码模型、API Key 或用户订阅方案。

**不借“测试全绿即目标完成”。** dgoal 的完成口是 `verification` + phase/task evidence + 独立终审。测试全绿只能作为 evidence 的一种，不足以替代用户 goal 的端到端验收。

**不借 prompt-only 编排器。** 推文的 `/loop` 主要靠 slash command prompt 约束循环；dgoal 把 phase completed 的唯一入口锁到 `dgoal_check` 工具边界上，属于 framework enforcement，不应退回“请 agent 记得检查”的软约束。

### 3.2 同思路（已有，印证方向）

**builder/checker 分离已落成。** 推文的 builder/checker 对应 dgoal 的主 agent / `dgoal_check` 独立验收子进程。dgoal 甚至更硬：验收子进程 fresh context，只给 `read` / `grep` / `find` / `ls` / `bash` 等受限核验工具，不能修改文件。

**循环停止语义已落成。** 推文用 `CLAUDE.md` 写 stop rules；dgoal 用状态机承载：phase 建检不过回 `in_progress`，终审不过进 `rejected`，连续 3 次不过进 `paused(audit_failed_3x)`。

**停止条件必须可验证已落成。** dgoal 的 `verification` 必填（ADR 0007），task `evidence` 要求可独立复验，phase done 只能走 `dgoal_check`（ADR 0006）。这比“执行完 checker 命令”更贴近 goal mode。

**用户不应做质检员这个方向被印证。** 推文结尾说用户从质检员变回需求方；dgoal 的启动闸门 + 独立建检正是让用户确认目标和验收口，而不是逐条检查实现细节。

**图片机制与 dgoal 心智模型对齐。** 第一张流程图的失败回环对应 dgoal 的建检循环；第二张停止规则图对应 dgoal 的 rejected/paused 防烧 token 设计；第三张目录结构图在 dgoal 中对应 extension 内置工具与文档，而不是用户 repo 下的 `.claude/` 文件。

### 3.3 候选（值得吸收）

**候选 1：终审/阶段建检失败报告保真钉回。** 推文最强的工程教训是“不要总结 checker 报告，要原样转发”。dgoal 目前 rejection 工具结果会返回 audit output，但需核实后续续跑 prompt 是否真的把完整失败报告持久钉回；`buildSystemPrompt` 当前能看到的是 rejected 次数提示，未直接显示完整报告。若确认未钉回，可在 `LoopGoal` 增加轻量字段（如 `lastAuditReport` / `lastPhaseCheckReport`），由 `dgoal_check` 和 `dgoal_done` rejection 路径写入，`buildSystemPrompt` 在 `rejected` 时注入原始报告摘要或文件路径。涉及：`index.ts` 的 rejection path、`buildSystemPrompt`、持久化 schema、状态机测试。

**候选 2：失败模式从“3 次不过”细化到“同源失败/无进展/回归”。** dgoal 已有 3 次终审不过暂停，但没有区分“同一失败连续出现”“失败项数量不减少”“修复引入回归”。可以先不实现完整 diff 历史，只在 auditor 输出中要求稳定列出 failure key（文件/命令/验收项），后续再用轻量 fingerprint 判断重复失败。涉及：`buildAuditorTask` / `buildPhaseCheckTask` 输出格式、`parseAuditorDecision` 周边、可能新增 `rejectedHistory`。

**候选 3：把 deterministic check 放在 auditor 判定的最后硬 gate。** 推文和 Sonar 文章都强调客观检查不能被 LLM 意见替代。dgoal 的 auditor 已能跑 `bash`，但 task evidence 还是自由文本。未来若真实痛点出现，可把 roadmap 里的 evidence 结构化增强落成 `{ command, expected, actual? }`，让 auditor 先复跑 deterministic evidence，再做语义验收。涉及：`Task.evidence` 数据结构、`dgoal_plan` schema、`buildPhaseCheckTask`、文档与迁移兼容。

**候选 4：checker 报告质量作为独立验收项。** 推文指出模糊报告会浪费整个循环。dgoal 可在 auditor prompt 中进一步要求：失败必须带 `file:line`、命令名、关键原始输出；如果无法定位，也要明确 BLOCKER，而不是泛泛写“未通过”。这属于 prompt 级小改，可优先于结构化存储落地。涉及：`PHASE_CHECK_SYSTEM_PROMPT`、`AUDITOR_SYSTEM_PROMPT`、相关快照测试。

## 4. 可借鉴的具体文件 / 代码 / 资源

- 原文：`https://mp.weixin.qq.com/s/uIWs8NJodx-zuZEpwHNfBA`。
- Claude Code subagents 官方文档：`https://code.claude.com/docs/en/sub-agents`，确认 `.claude/agents/`、独立 context、工具限制、权限模式等机制。
- Claude Code slash commands 官方文档：`https://code.claude.com/docs/en/agent-sdk/slash-commands`，确认 `.claude/commands/` 是 legacy 但仍支持，推荐新格式偏向 skills。
- Claude Code hooks 官方文档：`https://code.claude.com/docs/en/hooks`，确认 `Stop` / `SubagentStop` hook 能阻止停止；这印证 dgoal 的“停止必须有硬门”方向。
- Claude Code memory 官方文档：`https://code.claude.com/docs/en/memory`，确认 `CLAUDE.md` 是上下文指导而非硬 enforcement；这支持 dgoal 不把 stop rules 只写进文档。
- Anthropic《Building Effective AI Agents》：`https://www.anthropic.com/research/building-effective-agents`，Evaluator-Optimizer 模式是一手来源。
- Sonar《Loop engineering without verification is just automation》：`https://www.sonarsource.com/blog/loop-engineering-without-verification-is-just-automation/`，两层验证与 deterministic hard gate 观点可作为 evidence 结构化增强的外部论据。
- Firecrawl《Loop Engineering: Should You Stop Prompting Agents and Start Designing Loops》：`https://www.firecrawl.dev/blog/loop-engineering`，闭环、停止条件、token/spend cap 是同类佐证。

## 5. 决策记录

本次不新增 ADR。

原因：推文没有改变 dgoal 的基本盘，主要是印证 ADR 0006（建检循环 + 三层结构）和 ADR 0007（verification 必填），候选项也还停留在实现增强层。只有当后续决定引入 `lastAuditReport` / `rejectedHistory` 这类持久字段，且会影响状态注入与兼容迁移时，才需要补 ADR。
