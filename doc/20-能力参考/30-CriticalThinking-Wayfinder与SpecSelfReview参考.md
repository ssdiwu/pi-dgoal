# 30 - Critical Thinking、Wayfinder 与 Spec Self-review 参考

> 本轮调研对象：`KimYx0207/meta-skill-creator` 的 `Critical Thinking → Fetch → Deep Thinking → Review → Loop`、`mattpocock/skills` 的 `wayfinder`、`obra/superpowers` 的 `Spec Self-review`。源码快照分别为 `acc7b80`、`9603c1c`、`d884ae0`。结论用于判断：`pi-dgoal` 是否缺少路由认知、探索策略、减法机制或建检结构。

## 1. 总体判断

**三个概念都有启发，但对齐后不再把它们解释成 dgoal 缺少一套显式路由模型：Agent 本来就能基于用户意图主动使用 Task Plan 探路，再根据结果决定继续用 Task Plan 做完，还是向用户推荐授权 Phase/Goal Plan。真正可吸收的是两条轻规则——把 Task Plan 明确视为当前 frontier 的轻载体，以及在生成 Plan/task 时提醒 LLM 做软性自检。**

四个维度的结论：

| 维度 | 当前判断 | 核心原因 |
|---|---|---|
| 路由认知 | **不缺新状态，agent guidance 可更明确** | 路由是 Agent 的内部责任，不让用户先学习“准备度分级”；Agent 默认先判断是否需要 Task Plan 探索，只有保障需求上升时才推荐 `/dgoal` |
| 探索策略 | **Task Plan 可承担有界 AFK 探路** | Task Plan 可新增 task、整份替换 objective/tasks，适合承载当前 frontier；完整历史与跨会话 map 仍不进入 dgoal |
| 减法机制 | **已有结构减法，可补软提示** | 不需要固定 Spec Self-review 阶段；生成 Plan/task 时提醒 LLM 检查目标相关性、未知假设、范围和可复验证据即可 |
| 建检结构 | **核心不缺** | task evidence、fresh-context phase/goal check、revision 失效和 check/update 分离已完整；软自检不成为新 check 或 hard gate |

对齐后的两个候选是：

1. **探索型 Task Plan guidance**：稳定用户意图 / 最终效果，Task Plan 只承载当前可验证 frontier；AFK、有界、低风险探索可由 Agent 自动建立。
2. **Plan/task 生成时的软性 self-review 提示**：边生成边删错、收窄和核对，不增加独立模型、确认 UI、持久状态或强制步骤。

本轮不主张立即改 runtime；先把对齐结果记录清楚，再决定是否落成 prompt/guidance 级小改。

## 2. 核心机制速览

### 2.1 Critical Thinking → Fetch → Deep Thinking → Review → Loop：阶段不是口号，要有证据合同

`meta-skill-creator` 的 README 用五段式表达：

```text
Critical Thinking → Fetch → Deep Thinking → Review → Loop
```

其真实 `SKILL.md` 执行流程还显式包含 `Build`，即六步：

```text
Critical Thinking → Fetch → Deep Thinking → Build → Review → Loop
```

每段的关键不是名字，而是明确回答：

- **Critical Thinking**：这是什么类型的请求，用户结果、范围、非目标、风险和第一证据路线是什么；
- **Fetch**：只读取会改变决策的证据，同时记录反证和不可得路径；
- **Deep Thinking**：把证据收敛成产物链、工具路线、验收计划和写入位置；
- **Build**：只触碰当前目标必需的最小文件集；
- **Review**：区分结构证据、产物证据、运行证据、基线证据和人工确认，不能用一层通过冒充全部通过；
- **Loop**：明确 `writeback / proposal / none-with-reason / blocked`，不把聊天总结冒充闭环。

**对 dgoal 的启发**不是照搬六阶段状态机，也不是把路由分类展示给用户；而是要求 Agent 在内部先识别当前产出是“获得认知”还是“完成交付”，再选择一个能写清 objective、task 和 evidence 的最轻载体。

边界：该流程服务于可复用 Skill 包创建与治理；它不是所有软件任务的通用事实，也不能直接替换 dgoal 的 goal/phase/task 状态机。该独立仓库已声明合并进 Kim Service、不再单独发布，本调研只把固定 commit 当作机制快照，不把它视为持续更新的当前产品权威。

### 2.2 Wayfinder：未知不是待办，只有可精确表述的问题才进入 frontier

Wayfinder 面向“超过一次 agent session、目标方向存在大面积迷雾”的工作：

1. 先命名 **Destination**，用终点固定探索范围；
2. 建一个共享 map，map 只做索引，不重复存储每个决策正文；
3. 把现在已经能精确表述的问题建成 decision ticket；
4. 还不能精确表述的未知留在 `Not yet specified`，不提前伪造成 ticket；
5. 用 blocking 关系得到当前可推进的 frontier；
6. ticket 分为 Research / Prototype / Grilling / Task，并区分 HITL 与 AFK；
7. 每个 session 原则上只解决一个决策 ticket，直到路线清晰后再交给 Spec 或实施。

最有价值的一条是：

> **能否建 ticket，取决于现在能否把问题说精确，而不是现在能否回答。**

这给 dgoal 一个反向约束：不能把无法表述的未知直接伪造成实现 task；但 Agent 可以把下一项已经能精确表述的认知问题写成探索型 Task Plan，例如“确认方案 A 是否满足约束 X”。稳定的是用户意图 / 最终效果，变化的是当前 Task Plan objective 与 tasks。

边界：Wayfinder 的 issue tracker、child issue、claim、跨 session frontier 和后台 research branch 都与 dgoal 的“会话内单 Plan”冲突。Task Plan 只承载当前 frontier，不保留完整探索历史；重要决定和证据另行沉淀。可借的是未知分类，不是其持久编排形态。

### 2.3 Spec Self-review：先检查写成的工件，再交给用户确认

Superpowers 当前 `brainstorming` 主流程在写完设计文档后执行一次 **inline self-review**：

1. placeholder：是否有 `TODO`、`TBD`、未完成段落或模糊要求；
2. consistency：各节是否互相矛盾，架构是否与功能描述一致；
3. scope：是否仍适合一个 implementation plan，还是需要拆分；
4. ambiguity：是否存在两种合理解释，若有则必须选定并写清。

仓库另有 `spec-document-reviewer-prompt.md`，增加 completeness、clarity、YAGNI 与阻塞校准，但当前主 checklist 明确要求的是主 agent 行内自检；它不是 dgoal 式 fresh-context 独立审核。

随后还有第二道用户门：用户审阅**最终写成的 spec 文件**，而不只是在聊天中批准设计概念。Superpowers issue #565 曾明确暴露“聊天批准不等于已审阅最终工件”，当前流程已补上该门。

对 dgoal 最有价值的不是新增一个固定步骤，而是把这组检查压缩成生成 guidance 里的软提示：Task Plan、Phase/Goal proposal 和运行中新增 task 都可边生成边自修正，强度随 Plan 类型自然变化。它和独立终审不是一回事：

- soft self-review 只提醒主 Agent 检查目标相关性、假设、范围、歧义和证据路径，不产生审核记录；
- semantic preflight 检查“完成门是否能自主闭环”；
- user confirmation 冻结 Phase/Goal 契约；
- phase/goal check 检查“冻结结果是否真的达成”。

### 2.4 替代方案与失败证据

**替代方案 1：Grilling → To-spec。** Matt 的 `grilling` 在一个 session 内沿决策树逐题对齐，`to-spec` 只综合已有共识。这比 Wayfinder 轻，适合“问题很多但仍能在一次会话问清”的任务，说明 Wayfinder 不应成为默认入口。`to-spec` 标记了 `disable-model-invocation: true`，因此它是需要用户显式交接的下游步骤，不是 agent 可自动跳转的隐式路线。

**替代方案 2：保持 dgoal 只做保障选择。** 当前主 agent 和项目 Skill 层可以在 `/dgoal` 之外完成 research / grill / prototype；dgoal 不必知道具体上游工具名，只需守住“未准备好就不冻结 Plan”的接缝。

**失败证据：**

- Superpowers issue #512 指出超详细单文件 plan 会产生重复读取和 token 成本；说明“更完整的前置流程”不自动等于更高效。
- Wayfinder discussion #484 报告了更多 babysitting、token 消耗和到 Spec 的交接困惑；issue #499 指出共享理解确认时没有先展示待创建 map。说明探索地图需要非常清楚的可见接缝，否则会把未知管理变成新的流程负担。
- Superpowers 把 Brainstorming 设为所有创意任务的强制硬门；这与 dgoal 的三档保障和 Task Plan 轻量默认直接冲突。

## 3. 与 pi-dgoal 的关系

### 3.1 设计冲突（明确不借）

**不借 Meta Skill Creator 的六阶段作为 dgoal 状态机。** 它管理 Skill 包的创建、发布和写回；dgoal 管会话内 Plan 的执行与完成。把 Fetch / Deep Thinking / Review / Loop 全部持久化会制造新的阶段、状态和工具面，违背 ADR 0038 的收敛方向。

**不借 Wayfinder 的跨会话地图与 issue 编排。** dgoal 不做多目标池、后台 agent、跨 session 任务地图或 tracker 同步。若未来需要 Wayfinder，应是独立上游 Skill，不是 `src/runtime/` 的新模式。

**不借 Superpowers 的“所有任务强制 Spec”硬门。** Task Plan 的存在就是为了让普通明确工作跳过 proposal、确认和 auditor 开销；小任务不应为形式生成 Spec。

**不把“准备度 × 保障强度”做成用户可见的新路由模型。** Agent 本来就能主动用 Task Plan 探索或执行；用户只需要表达意图，并在 Agent 推荐 Phase/Goal Plan 时决定是否授权升级。

**不把 Spec Self-review 升级为独立阶段、auditor 或 hard gate。** dgoal 已有语义预审和 phase/goal auditor。吸收时只在 Plan/task 生成 guidance 中增加轻提示，不新增模型调用、审核记录、确认 UI 或失败状态。

**不让 self-review 扩张冻结契约。** 自检只能删除歧义、矛盾和非必要内容；不能因为“更完整”而新增用户未要求的功能或完成门。最终 auditor 仍只核用户确认的 acceptance contract。

### 3.2 同思路（已有，印证方向）

**dgoal 已有 Agent 主导的保障路由。** `buildTaskPlanDefaultGuidance()` 已让 Agent 主动处理普通多步 Task Plan，并只在需要冻结契约或独立审核时推荐 `/dgoal`；Phase Plan / Goal Plan 再按 phase 是否有独立验收价值分流。对齐后的增强不是让用户选择路由，而是明确 Task Plan 也可承载 Agent 自主发起的有界 AFK 探索。

**dgoal 已有证据读取和边界声明。** `buildProposePrompt()` 要求先读相关代码/文档，理解目标、范围和风险；proposal 使用三层 Description、`nonGoals`、`guardrails`、`acceptanceCriteria` 与 `userReviewItems`，不再保留 `contextSummary`。只要 goal 与验收已明确，Phase/Goal Plan 内也可以正常加入 research、prototype 等探索 task；Plan 类型由保障需求决定，不由“有没有探索”决定。

**dgoal 已有结构减法。** Task Plan 是最轻默认；Phase Plan 避免每 phase 审核；Goal Plan 明确禁止按代码/测试/文档机械拆 phase；运行中不新增 phase，`plan_create` 只创建完成当前目标所需的 task。ADR 0038 本身也是删除策略、预算和隐式权限组合的减法决策。这种减法主要依赖“不创建”和“提交前收敛”，不是激活后删除：Task Plan 可整份替换，而 audited Plan 的 phase 冻结、公共工具不提供删除 task/phase，因此生成时的软提示比事后补删除机制更符合当前结构。

**dgoal 已有完整执行后建检。** task 必须带 evidence；phase/goal auditor 使用 fresh context 和受限工具；任何 Plan 写操作使旧批准失效；check 只写 CheckRecord，`plan_update` 才写 done。三个外部概念没有暴露这一层的结构性缺口。

**proposal 已有两种检查，但职责较窄。** `assessProposalReadiness()` 检查字段物证是否齐备，当前只在确认 UI 中展示 level/gaps，不是提交硬门；semantic preflight 只判断独立验收、用户复核和真实人工 blocker。两者都故意不承担完整的 Plan Quality / Spec Quality 审查。

### 3.3 已吸收项

#### 已吸收 1（guidance 向）：把 Task Plan 明确为当前 frontier 的轻量探路载体

Agent 接到用户想法后，不展示路由分级，而是自行判断是否先建立探索型 Task Plan：

- 稳定的是用户意图 / 最终效果，Task Plan objective 表达当前可验证的认知或交付结果；
- 只有 AFK、有界、低风险、能写清停止条件的探索可自动建 Plan；
- 需要用户意图、偏好或范围取舍的问题留在正常讨论 / grill，不伪装成 task；
- 随证据变化可新增 task，或调用 `task_plan` 整份替换 objective/tasks；
- 替换时不保留旧 Plan 历史，重要决定与证据按项目既有出口另行沉淀；
- 探索后若 Task Plan 足以做完就继续；只有保障需求上升时才向用户推荐 Phase/Goal Plan；
- 已冻结结果和验收的 Phase/Goal Plan 仍可在现有 phase 下按需新增探索 task。

具体落点：

- `src/startup/index.ts::buildTaskPlanDefaultGuidance()` — 把“普通、明确多步”扩展为“明确执行或有界 AFK 探索”；
- `src/runtime/index.ts::taskPlanTool.promptGuidelines` — 约束探索 objective 必须有界、可验证，不替用户作决定；
- `src/runtime/index.ts::planCreateTool.promptGuidelines` — 明确新增探索 task 仍须服务当前 objective；
- `test/activation-boundary.test.ts`、`test/three-plan-runtime.test.ts` — 回归默认授权边界、整份替换和末 task 自动收口不变；
- `README.md` / `README-zh.md` 与 `doc/10-架构与运行/13-启动闸门与TUI浮层.md` — 只解释 Agent 可用 Task Plan 探路，不给用户新增路由操作。

价值：吸收 Wayfinder 的 frontier 思想，但复用现有 Task Plan，不新增 map、状态、工具或跨会话历史。

#### 已吸收 2（prompt 向）：在 Plan/task 生成 guidance 中加入软性 self-review 提示

不新增固定步骤；只提醒 LLM 在生成或新增 task 时边写边核对：

1. 当前 objective 是否直接服务用户意图 / 最终效果；
2. 每个 task 是否必要，能否删掉 phase、task、验收门或顺手重构；
3. 是否把未核实事实当成结论，或把用户决策伪装成执行 task；
4. task 顺序与依赖是否成立；
5. 完成后是否有可复验证据；Phase/Goal proposal 还要核对 objective、verification、acceptanceCriteria 与 phase 是否一致。

边界：

- 这是生成提示，不是自检报告、独立阶段、hard gate 或新的 CheckRecord；
- 不要求用户审阅自检过程，不把工作流教学转交给用户；
- 不新增模型调用、确认 UI、持久字段或失败状态；
- 不修改 `buildProposalSemanticReviewPrompt()` 的人工依赖三分流职责；
- 发现可自行修正的问题就直接修正后继续，只有真实用户 blocker 才正常询问。

具体落点：

- `src/startup/index.ts::buildTaskPlanDefaultGuidance()`；
- `src/runtime/index.ts::taskPlanTool.promptGuidelines`；
- `src/runtime/index.ts::planCreateTool.promptGuidelines`；
- `src/runtime/index.ts::buildProposePrompt()`；
- 回归：`test/activation-boundary.test.ts`、`test/startup-gate.test.ts`、`test/command-aliases.test.ts`。

价值：以最低成本吸收 Critical Thinking 的证据意识、Wayfinder 的未知边界和 Spec Self-review 的减法检查，同时保持 Task Plan 轻量、Phase/Goal 显式授权和现有建检结构不变。

### 3.4 观察项（尚不够格成为候选）

**用户可见的准备度路由。** 对齐后已明确这是伪命题：路由是 Agent 的内部责任，用户不需要先选择“探索 / 执行 / 高保障”。除非出现无法靠 Agent guidance 修正的误路由证据，不新增 readiness route UI 或工具。

**完整探索历史与显式 Exploration Handoff。** Task Plan 当前整份替换、不保留旧历史；这正是轻载体边界。若未来出现跨压缩丢失关键决定，或显式 `/dgoal` 被模糊目标反复卡住的真实样例，再分别评估精简 Decisions-so-far 或 `not_ready` 启动结果；当前不提前设计。

**完成后的自动 writeback。** Meta 流程的 Loop 强调把可复用学习写回 Skill 包；dgoal 的 rejected 修复 loop 已完整，但不应自动修改项目规范或经验文档。可复用经验仍由宿主工作流按 `doc/经验笔记.md` 门槛判断，不进入 goal done 守卫。

## 4. 可借鉴的具体文件、代码与资源

### 外部一手源

- Meta Skill Creator README（五段方法）：`https://github.com/KimYx0207/meta-skill-creator/blob/acc7b8003ee4ea2304c2a70a4630c6d633dc5855/README.en.md`
- Meta Skill Creator SKILL（含 Build 的六步执行契约）：`https://github.com/KimYx0207/meta-skill-creator/blob/acc7b8003ee4ea2304c2a70a4630c6d633dc5855/skills/meta-skill-creator/SKILL.md`
- Matt Pocock Wayfinder SKILL：`https://github.com/mattpocock/skills/blob/9603c1cc8118d08bc1b3bf34cf714f62178dea3b/skills/engineering/wayfinder/SKILL.md`
- Matt Pocock Grilling（轻量替代）：`https://github.com/mattpocock/skills/blob/9603c1cc8118d08bc1b3bf34cf714f62178dea3b/skills/productivity/grilling/SKILL.md`
- Matt Pocock To-spec：`https://github.com/mattpocock/skills/blob/9603c1cc8118d08bc1b3bf34cf714f62178dea3b/skills/engineering/to-spec/SKILL.md`
- Superpowers Brainstorming：`https://github.com/obra/superpowers/blob/d884ae04edebef577e82ff7c4e143debd0bbec99/skills/brainstorming/SKILL.md`
- Superpowers Spec reviewer 模板：`https://github.com/obra/superpowers/blob/d884ae04edebef577e82ff7c4e143debd0bbec99/skills/brainstorming/spec-document-reviewer-prompt.md`

### 反例与失败反馈

- Superpowers #565（最终 Spec 未获用户复核的回归，当前已修复）：`https://github.com/obra/superpowers/issues/565`
- Superpowers #512（单体详细 plan 的 token 成本）：`https://github.com/obra/superpowers/issues/512`
- Wayfinder discussion #484（babysitting、token 与交接摩擦）：`https://github.com/mattpocock/skills/discussions/484`
- Wayfinder #499（确认 map 前缺少可见预览）：`https://github.com/mattpocock/skills/issues/499`

### 当前项目落点

- `src/startup/index.ts::buildTaskPlanDefaultGuidance()` — 明确 Agent 可为有界 AFK 探索主动建立 Task Plan，并加入最轻自检提示；
- `src/runtime/index.ts::taskPlanTool.promptGuidelines` — 约束探索 objective、用户决策边界与 task 最小性；
- `src/runtime/index.ts::planCreateTool.promptGuidelines` — 提醒新增 task 直接服务当前 objective 且可复验；
- `src/runtime/index.ts::buildProposePrompt()` — 给 Phase/Goal proposal 增加同类但更完整的软提示；
- `src/runtime/index.ts::assessProposalReadiness()` — 继续只做结构就绪度展示，不升级成语义路由硬门；
- `src/runtime/index.ts::buildProposalSemanticReviewPrompt()` — 保持“人工依赖三分流”的窄职责，不扩成 plan reviewer；
- `src/runtime/index.ts::PHASE_CHECK_SYSTEM_PROMPT` / `AUDITOR_SYSTEM_PROMPT` — 当前执行后独立建检基本盘；
- `test/activation-boundary.test.ts`、`test/three-plan-runtime.test.ts`、`test/startup-gate.test.ts`、`test/command-aliases.test.ts` — guidance 落地后的定向回归。

## 5. 决策记录

本轮 `507-grill` 的前三个分支收敛为 prompt/guidance 级可逆增强，不单独新增 ADR：

- 撤回“准备度 × 保障强度”用户可见路由候选；路由属于 Agent 内部责任；
- Task Plan 可作为当前 frontier 的轻量探路载体，不保存完整历史；
- Agent 可自动启动 AFK、有界、低风险探索，HITL 决策仍走正常讨论；
- 探索后继续 Task Plan 或推荐 Phase/Goal Plan，由保障需求决定；
- self-review 只作为 Plan/task 生成时的软提示，不成为新阶段、硬门或审核器；
- 完整 Wayfinder map、`not_ready` 启动结果和自动 writeback 继续留作有证据后再评估的观察项。

讨论随后延伸出一个满足“难逆转 + 无上下文会困惑 + 有真实权衡”的独立决策，已记入 ADR 0042：goal、用户可见 phase/task 的 Description 改为必填执行说明；`contextSummary` 直接删除且不兼容；持续浮层保持简洁，`/dgoal s` 改为 goal 全量说明的列表页与 phase/task 全量说明的详情页。该决策不把 Description 变成第二套审核完成门。

ADR 0042 与上述两个 guidance 项已按数据模型、上下文注入、工具投影和 Modal 垂直切片实施；当前回归覆盖见 `test/README.md`。
