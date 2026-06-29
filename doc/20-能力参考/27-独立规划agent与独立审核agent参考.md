# 27 - 独立规划 agent 与独立审核 agent 参考

> 2026-06 调研。对象：当前 `pi-dgoal` 启动闸门 / 独立建检实现、`/Users/diwu/.pi/agent/prompts/review.md`、Claude Code subagents / skills、OpenAI Codex subagents / auto-review、Google Jules critic、Google ADK 多 agent（代理）模式、Aider architect/editor。结论用于判断：`pi-dgoal` 是否需要继续强化独立审核 agent，以及是否值得新增独立规划 agent。

## 1. 总体判断

**独立审核 agent 值得继续加深，但独立规划 agent 目前只是候选，不是立即必要。**

更具体地说：

- `pi-dgoal` **已经有独立审核**：`dgoal_check` / `dgoal_done` 走 fresh context（新上下文）+ 受限工具 + 独立子进程，这个基本盘和外部主流实践一致，方向没错。
- 真正值得优先吸收的不是“再造一个审核器”，而是两条增强：**审核模型可单独切换**，以及**审核契约从“找到一个不过理由就拒绝”升级成“在预算内一次尽量提全问题”**。
- **独立规划 agent 暂不建议先做成默认链路。** 外部资料普遍支持“plan first（先计划）”，也支持把计划研究放到独立上下文；但同样明确提醒：当 planning（规划）/ implementation（实现）/ testing（测试）共享大量上下文时，硬拆 agent 会增加 token 成本、延迟和信息折损。对 dgoal 来说，启动闸门只发生一次，现阶段痛点主要不在“没人专门规划”，而在“独立审核会反复、一次提不全”。

一句话结论：**先把独立审核做深，再决定要不要把规划也独立成 agent；顺序不要反。**

## 2. 核心机制速览

### 2.1 `pi-dgoal` 当前已经是“执行者 + 独立审核者”

当前实现里，主 agent 负责推进 task（任务）、写代码、跑验证；phase（阶段）完成时必须调用 `dgoal_check`，goal（目标）完成时必须调用 `dgoal_done`。两条路径都进入 `runIsolatedCheck()`：

- 子进程启动参数固定为 `--no-session --no-extensions --no-skills --mode json`
- 工具白名单固定为 `read,grep,find,ls,bash`
- auditor（审核器）system prompt（系统提示词）明确要求“只检查与验收，不做探索、不做方案、不做实现、不做收口”

这说明 dgoal 已经不是“主 agent 自己说完成就完成”，而是**把完成判定外包给隔离审核子进程**。

### 2.2 审核模型已支持独立配置，但默认仍继承主模型

当前 `index.ts` 已把 `runIsolatedCheck()` 的选模入口改为 `resolveAuditorModelId(ctx)`：

- 默认仍回退到 `ctx.model`（主线程模型）
- 可通过 `~/.pi/agent/pi-dgoal.json` 或项目 `.pi/pi-dgoal.json` 的 `auditorModel` 为审核子进程单独选模
- 项目级配置只在 `ctx.isProjectTrusted()` 为真时生效

所以 dgoal 现在已经从“独立审核上下文”进一步升级到了**“默认继承主模型、可按配置切换审核模型”**。这和 Claude Code / Codex 的 per-agent model（按 agent 单独指定模型）能力对齐得更近，但仍保持了最小边界：先只拆 `auditorModel`，不把 planner / executor / summarizer 一起做成多模型全家桶。

### 2.3 Claude Code：subagent（子代理）支持独立模型、独立工具、独立 memory（记忆）

Claude Code 官方 subagents 文档给出的机制非常直接：

- 每个 subagent 运行在独立 context window（上下文窗口）里
- 可自定义 system prompt、tools、permissions、model
- 内置有 `Explore`、`Plan` 等只读 agent
- 示例里专门演示了 read-only code-reviewer（只读代码审查者）
- 文档还明确说：**主对话适用于 planning / implementation / testing 共享大量上下文的任务；subagent 更适合自包含、输出可摘要的工作**

这对 dgoal 有两个启发：

1. **独立审核 agent 可单独选模型**是主流能力，不是过度设计。
2. **独立规划 agent 不是默认正义**——只有在“规划任务本身是可独立摘要的工作”时才值得拆。

### 2.4 OpenAI Codex：reviewer swap（审核者替换）与 custom reviewer（自定义审核者）已经是正式能力

Codex 有两条很贴近 dgoal：

- `auto-review`：当主 agent 想越过 sandbox（沙箱）边界时，不是直接找人，而是把审批请求路由给一个**独立 reviewer agent**。官方定义非常清楚：**这是 reviewer swap，不是 permission grant（权限放宽）**。
- subagents / custom agents：可以给 `reviewer` 单独配模型、推理强度、sandbox mode（沙箱模式）和 developer instructions（开发者指令）。官方示例就有高推理、只读的 `reviewer`。

这说明“独立审核”在更成熟的 coding agent（编码代理）系统里，已经被做成：

- 角色独立
- 权限边界独立
- 模型独立
- 失败理由带 rationale（理由）返回

并且 Codex 还额外做了 **rejection circuit breaker（拒绝熔断器）**：连续 denial（拒绝）太多会中断当轮，避免 agent 死循环升级请求。

### 2.5 Google Jules：critic（批评者）不是修代码，而是提前找茬

Jules 的 critic 功能是很强的一手参照：

- critic 不修代码，只 flag（标出问题）
- patch（补丁）先生成，再由 critic 做 adversarial review（对抗式审查）
- 若 critic 仍然 flag，Jules 会继续 replan（重计划）和改，再被 critic 复查
- 目标是把 review 前置到“提交给用户之前”

Jules 还明确说，第一版 critic 是 one-shot（单次）评估，但会多次回环直到不再 flag。这个设计很像你现在担心的点的反面：**审核器不是只给一次否决，而是要尽量在内部回环里提前暴露问题。**

### 2.6 Google ADK：Generator/Critic（生成者/批评者）与 Parallel Review（并行审查）是标准模式

ADK 文档把两个模式讲得很清楚：

- **Generator + Critic + Loop**：生成、批评、修正，直到 `PASS`
- **Parallel Review Swarm（并行审查群）**：安全、样式、性能等多个 reviewer 并行跑，再由 synthesizer（综合者）汇总

这给 dgoal 的不是“必须上多 agent 编排引擎”的结论，而是更具体的一条：

> 如果你要解决“独立审核一次提不全”的问题，最自然的增强不是先引入规划 agent，而是把审核从单一 gate（闸门）改成**穷举式审查**，必要时再拆成多维 reviewer 并行汇总。

### 2.7 Aider：architect/editor（架构师/编辑器）是“规划与执行拆模型”的轻量替代

Aider 的 `/architect` 模式不是独立子会话编排，而是：

- 一个 architect model（规划模型）
- 一个 editor model（执行模型）

这说明“规划能力要不要和执行能力拆开”不只有“加一个独立规划 agent”这一种做法，还可以先做成：

- **同一工作流内的双模型分工**
- 而不是独立会话、独立线程、独立状态机

对 dgoal 来说，这意味着：如果以后真的想加强规划，不一定第一步就上 planner agent，也可以先做成“启动闸门阶段的规划模型与执行阶段模型可分离”。

### 2.8 `review.md` 对审核 agent 有帮助，但不能整份原样塞给 auditor

`/Users/diwu/.pi/agent/prompts/review.md` 的价值很高，它把 review 拆成三轴：

1. **Standards（项目规范）**
2. **Spec（需求符合度）**
3. **Code Quality（代码质量）**

而且要求输出：scope（范围）、summary（摘要）、findings（问题）、recommended next mode（建议下一模式）、verification（验证）。

这正好可以补当前 auditor prompt 的一个弱点：**现在的 auditor 更强调“判过/不过”，没有强制“尽量提全问题并结构化输出”。**

但它也不能整份原样塞给 dgoal auditor，原因是：

- `review.md` 默认面向 diff / branch / commit 的代码审查
- dgoal auditor 面向的是 phase/goal 验收，不一定有 git diff
- `review.md` 末尾带“下一模式建议”，更像工作流教练，不是硬验收 gate

所以它更适合被**吸收为 auditor 输出格式与检查维度**，而不是直接复用成当前验收器 prompt。

## 3. 与 pi-dgoal 的关系

### 3.1 设计冲突（明确不借）

**不借“默认多 agent 团队编排”这套重量级形态。** dgoal 当前定位是会话内单 goal（单目标）的轻量 Pi extension（Pi 扩展），不是通用 multi-agent workflow engine（多代理工作流引擎）。像 ADK / Codex 那种 coordinator（协调器）+ N 个 worker（执行者）+ synthesizer（综合者）的常驻团队形态，和当前项目的轻量、单文件实现、低认知负担定位冲突。

**不借“独立规划 agent 默认先于每次执行”这一强制链路。** Claude Code 官方文档明确提醒：当 planning / implementation / testing 共享大量上下文时，应优先放在 main conversation（主对话）里而不是强拆 subagent。dgoal 的规划主要发生在启动闸门阶段，只做一次；如果默认加 planner，会引入额外上下文折损、额外 token 和额外等待。

**不借“把 `review.md` 原样变成 auditor prompt”。** `review.md` 是 diff-based review（基于差异的审查）prompt，不是 acceptance gate（验收闸门）prompt。直接替换会把 auditor 的职责从“判是否达成当前 phase/goal”漂移成“泛化代码审查”。

**不借“critic 自己修代码”。** Jules、Codex reviewer、Claude Code code-reviewer 的共同点都是 reviewer 不写实现。dgoal 也不应让独立审核器顺手补代码，否则又退回“学生自己判卷并悄悄改答案”。

### 3.2 同思路（已有，印证方向）

**独立审核基本盘已落成。** dgoal 的 `runIsolatedCheck()`、fresh context、受限工具白名单，与 Jules critic、Codex reviewer swap、Claude Code read-only reviewer 在原则上完全同向：**让执行者和判卷者分离。**

**启动闸门已是“先计划再开工”。** Codex best practices 里强调复杂任务要先 plan，Google ADK 也把 human-in-the-loop（人在回路）作为标准模式。dgoal 现有的 `dgoal_propose -> 用户确认 -> active` 已经符合这个方向。

**当前最真实的痛点已被外部材料印证：审核需要更早、更全地暴露问题。** Jules critic、ADK generator/critic loop、Codex reviewer 都不是“给一句拒绝理由就完”，而是强调在交付给人之前提前找茬、尽量减少下游返工。你提到的“独立审查会反复”正是这里最值得借的部分。

### 3.3 候选（值得吸收）

**候选 1：给 auditor 单独配置模型 —— 已落地，后续看是否继续细化。**

这条增强现已通过 `pi-dgoal.json` 落地为最小实现：

- `index.ts`：`buildCheckCliArgs()`、`runIsolatedCheck()`、`runCompletionAuditor()`、`runPhaseCheck()`
- 新增配置来源：项目设置 / 扩展设置 / 环境变量（三选一或组合）
- 文档同步：`README.md`、`doc/10-架构与运行/12-工具命令与数据模型.md`

建议边界：

- 先只拆 `auditorModel`
- 不要一步拆 `plannerModel` / `executorModel` / `summarizerModel` 全家桶
- 默认仍 inherit（继承主模型），有配置时再覆盖
- 后续若继续演进，优先补文档、测试和配置校验，再讨论 phase/final 分模型

**候选 2：把 auditor 从“闸门型 reject”增强成“穷举型 review” —— 最高优先级。**

当前 prompt 只要求“逐条对照目标里的可验证要求”，并没有明确要求“在预算内尽量提全所有已发现问题，不要找到第一个 blocker（阻塞项）就停”。这会天然导致你说的反复：

- 第一次看到 A，reject
- 主线程修 A
- 第二次才看到 B
- 再修 B

建议吸收 `review.md` 的三轴框架，把 auditor 输出升级为：

- `Standards / Spec / Code Quality` 三类发现
- 每类 findings（问题发现）尽量提全
- 明确区分 `blocker / fail / warning`
- 每条带 evidence（证据）与定位

涉及改动：

- `index.ts`：`AUDITOR_SYSTEM_PROMPT`、`buildAuditorTask()` / `buildPhaseCheckTask()`（若有）
- 反馈结构：`PhaseCheckFeedback` / `FinalCheckFeedback` 可考虑从纯 `report: string` 演进到 `report + findings[]`
- 文档：`doc/10-架构与运行/14-*`（若已有 TUI 边界文档可补）与能力参考

**候选 3：给 phase / final audit 增加 issue ledger（问题账本）而不是只存原始报告 —— 中高优先级。**

Jules 和 Codex 的共同优点是 reviewer 有更稳定的“上次发现了什么”语义，而 dgoal 现在的 feedback 主要是 report 原文。可以考虑：

- 保留 report 原文不变（继续保真）
- 额外持久化结构化 findings（例如 `id/title/severity/evidence/location/status`）
- 下次重审时先核旧问题是否修复，再查新问题

这样才能把“反复审”从全文重来，变成“旧账先销，再找新账”。

涉及改动：

- `LoopGoal.phaseFeedbackById`
- `LoopGoal.finalFeedback`
- 可能新增 `findings` 数据结构与迁移兼容
- `dgoal_check` / `dgoal_done` 的反馈注入格式

**候选 4：对连续同类建检失败做 breaker（熔断）—— 中优先级。**

Codex auto-review 有 rejection circuit breaker；dgoal 目前只有：

- `auditor_error` 三次重试
- final audit（终审）连续 3 次 rejected -> `paused(audit_failed_3x)`

但 phase check（阶段建检）理论上还可能长时间反复。可以考虑：

- 若同一 phase 在短窗口内重复出现近似相同 findings
- 自动提示“当前 phase 可能需要重拆 task / 请求用户 / 转 blocked（阻塞）”
- 不一定直接强停，但至少要有更强提醒

这条不一定先做，因为它依赖候选 3 的结构化 findings，否则很难稳健判“同类失败”。

**候选 5：在启动闸门前增加轻量 plan review（计划审查）—— 候选，但不要先做默认。**

这里可以借 `review.md` 的三轴，但把对象从 diff 改成 plan：

- Standards：是否符合 dgoal 现有边界（单目标、phase 可验收、task 可验证）
- Spec：是否覆盖用户目标和 verification（验收口）
- Code Quality：这里换成 Plan Quality（计划质量），看是否水平切片、是否空话、是否缺证据路径

这可以做成 `dgoal_propose` 提交后、用户确认前的一个只读 reviewer pass（审查回合）。

但我不建议它一上来就默认启用，因为当前最痛的不是“计划没人挑刺”，而是“执行后的独立审核反复返工”。

**候选 6：独立规划 agent —— 观察项，不建议当前版本先上。**

只有当出现以下真实证据时，才建议升级：

- 裸 `/dgoal` 承接前文时，主 agent 经常提不出稳定 plan
- 主会话上下文太脏，导致启动闸门计划质量明显不稳
- 需要把“规划”和“执行”放到不同模型 / 不同 prompt（提示词）里才能明显提升启动质量

若未来真要吸收，建议边界是：

- planner 只读，不给写工具
- planner 只负责产 `objective + phases + verification`
- 不让 planner 持久运行，不让它接 execution（执行）职责
- 仍然保留用户启动闸门确认

也就是：**planner 只能是启动前助手，不能变成第二个主脑。**

## 4. 可借鉴的具体文件 / 代码 / 资源

### 当前项目内

- `index.ts:1559-1580` — `buildProposePrompt()`：当前启动闸门如何要求主 agent 读代码、整理 plan、提交 `dgoal_propose`
- `index.ts:2282-2291` — `buildCheckCliArgs()`：当前 auditor 子进程参数构造，模型继承点在这里
- `index.ts:2297-2419` — `runIsolatedCheck()`：当前独立审核 runtime（运行时）核心接缝
- `index.ts:2494-2547` — `runCompletionAuditor()` / `runPhaseCheck()`：终审与阶段建检都复用同一套隔离审核
- `index.ts:2729-2738` — `AUDITOR_SYSTEM_PROMPT`：当前 auditor 职责边界与通过/拒绝判定规则
- `/Users/diwu/.pi/agent/prompts/review.md` — 审查三轴与输出格式骨架，可吸收为 auditor 的 findings（问题发现）结构

### 外部一手源

- Claude Code subagents：`https://docs.anthropic.com/en/docs/claude-code/sub-agents`
- Claude Code skills：`https://docs.anthropic.com/en/docs/claude-code/skills`
- OpenAI Codex best practices：`https://developers.openai.com/codex/learn/best-practices`
- OpenAI Codex subagents：`https://developers.openai.com/codex/subagents`
- OpenAI Codex auto-review：`https://developers.openai.com/codex/concepts/sandboxing/auto-review`
- Google Jules critic：`https://developers.googleblog.com/en/meet-jules-sharpest-critic-and-most-valuable-ally/`
- Google ADK multi-agent patterns：`https://developers.googleblog.com/developers-guide-to-multi-agent-patterns-in-adk/`
- Aider commands（含 `/architect`）：`https://aider.chat/docs/usage/commands.html`

## 5. 决策记录

本次先不新增 ADR（架构决策记录）。

原因：

- “独立审核存在且方向正确”已经被 ADR 0006 / ADR 0012 的建检循环与闸门锁定覆盖。
- “auditor 模型可切换”与“审核一次尽量提全”目前还属于**候选增强**，尚未做出不可逆架构承诺。
- 只有当后续决定：
  - 正式引入 `auditorModel` 配置面，或
  - 把 feedback（反馈）从纯文本升级成结构化 findings，或
  - 在启动闸门中加入新的 plan reviewer（计划审查者）环节

才值得补新的 ADR。