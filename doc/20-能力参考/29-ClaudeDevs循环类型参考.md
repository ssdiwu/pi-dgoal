# 29 - ClaudeDevs 循环类型参考

> 2026-07 调研。对象：ClaudeDevs X article《Getting started with loops》（X 原文页需 JS；可抓到 tweet 摘要，正文参考宝玉翻译）+ Claude Code 官方 docs（`/goal`、`/loop`、`/schedule`、skills、hooks、routines）。结论用于判断这套 loop 分类对 `pi-dgoal` 的借鉴意义。

## 1. 总体判断

**有启发，但主要是定位启发和边界校准，不是实现路线照搬。**

ClaudeDevs 把 loop 定义成“agent 重复工作周期，直到满足预设停止条件”，并按“触发器 / 停止条件 / 基础指令 / 适用任务”分成四类：turn-based、goal-based、time-based、proactive。对 dgoal 最有价值的是三点：

1. **给 dgoal 一个更清晰的外部坐标**：dgoal 是 goal-based loop 的强化版——不只是 Stop hook（停止钩子）打回，而是三层 Task Plan + phase 建检 + goal 终审。
2. **“交给 AI 的到底是哪一部分”这个框架很好**：turn-based 交出 check，goal-based 交出 stop condition，time-based 交出 trigger，proactive 交出 prompt。dgoal 当前明确只接“stop condition + check”，不接“trigger”。
3. **进一步印证 budget / max tries / token visibility 是 loop 的必要边界**：dgoal 已有终审三次失败暂停和声明性 `budget`，但 phase 级预算、运行轮次 / token 可见性仍是候选，不应急做。

一句话：**这篇对我有启发：它把 dgoal 的“建检循环”放进了更大的 loop 分类里，也提醒我们别把 dgoal 做成调度器或例行程序平台。**

## 2. 核心机制速览

### 2.1 ClaudeDevs 四类 loop

- **Turn-based loop**：每次用户 prompt 都启动一个小 agentic loop。用户仍是检查瓶颈；建议把人工检查步骤固化进 `SKILL.md`，让 agent 在交付前自验证。
- **Goal-based loop (`/goal`)**：用户给出可验证停止条件，agent 反复尝试，直到 goal 满足或达到最大尝试次数。适合 Lighthouse 分数、测试通过数等确定性标准。
- **Time-based loop (`/loop` / `/schedule`)**：按时间间隔触发同一任务，适合 PR 看管、CI 失败处理、周期总结等外部环境变化场景。
- **Proactive loop**：组合 schedule / goal / workflow / auto mode，处理持续涌入、定义清晰的重复流，如 bug report 分诊、依赖升级、数据迁移。

### 2.2 官方 docs 核实到的机制事实

- Claude Code `commands` 文档把 `/goal [condition|clear]` 定义为：Claude 跨 turns 持续工作，直到 condition met；无参数显示当前或最近达成 goal。
- Claude Code `hooks` 文档明确说：`/goal` 是 **session-scoped prompt-based Stop hook**（会话内、基于 prompt 的 Stop 钩子）快捷方式。Stop hook 可阻止 agent 停止并继续对话。
- Claude Code `commands` 文档把 `/loop [interval] [prompt]` 定义为 bundled skill（内置技能）：session 打开期间重复运行 prompt；可省略 interval 让 Claude 自行定节奏；可省略 prompt 使用 autonomous maintenance check 或 `.claude/loop.md`。
- Claude Code `routines` 文档把 `/schedule` / routines 定义为云端 saved configuration（prompt + repos + connectors + triggers），支持 schedule / API / GitHub trigger，可无人值守执行。
- Claude Code `skills` 文档强调：重复 checklist / procedure 应沉淀为 skill；skills 可带动态上下文、allowed tools、subagent fork、hooks，并且需要 eval（评估）验证触发和产出是否有效。

### 2.3 质量和成本边界

ClaudeDevs 的文章把 loop 质量归因于外围系统：

- 代码库本身整洁，agent 会模仿现有模式。
- 给 agent 自我验证方法，最好是量化检查。
- 让文档可达。
- 用第二个 fresh-context agent 做 code review。
- 失败后不要只修单次 bug，要把教训固化进规则。

成本控制点包括：

- 选择合适 primitive 和模型。
- 明确 success / stop criteria。
- 大规模前先小样本试跑。
- 确定性工作用脚本而不是让 LLM 反复推理。
- 循环不要跑得太频繁。
- 定期看 `/usage`、`/goal`、`/workflows` 的消耗拆解。

## 3. 与 pi-dgoal 的关系

### 3.1 设计冲突（明确不借）

**不借 `/schedule` / routines 的云端例行程序形态。** dgoal 当前边界是 Pi 会话内单 goal，不做跨 session、不做云端调度、不做持续例行程序。Claude routines 的 repos / environment / connectors / triggers / branch permissions 是一个完整无人值守平台，和 dgoal 轻量扩展定位冲突。

**不借 `/loop` 的定时触发能力作为近期目标。** dgoal 的建检循环是验证约束，不是定时节奏。time-based loop 属于远期“循环工程（定时循环）”延伸，路线图已明确暂不做，除非出现真实 PR 看管 / 巡检需求。

**不把 auditor（审核器）改成普通 `SKILL.md` 自验证。** ClaudeDevs 推荐在 turn-based loop 中把检查写成 skill；dgoal 的核心价值恰恰是 `dgoal_check` / `dgoal_done` 用 fresh context + 受限工具独立审核，不把主会话 skills/extensions 带进 auditor。可以借“检查要可量化”的思想，但不借“让同一 agent 自己按 skill 判卷”的形态。

**不借 proactive loop 的多 agent workflow 编排。** dynamic workflows + auto mode + 多 worktree judge 适合大规模自动化；dgoal 不是多 agent 编排引擎。相关判断已在 `27-独立规划agent与独立审核agent参考.md` 中收敛：先加深独立审核，不默认引入多 agent 团队。

### 3.2 同思路（已有，印证方向）

**dgoal 已经是 goal-based loop 的强化版。** Claude `/goal` 的官方底层是 prompt-based Stop hook：agent 要停时由 hook 判断是否继续。dgoal 则把“不能停”做成了更硬的状态机：goal/phase/task 三层、phase 只有 `dgoal_check` 能进 done、终审只有 `dgoal_done` 能关 goal。

**“可验证停止条件”印证 dgoal 的 verification 必填。** ClaudeDevs 强调 deterministic criteria（确定性标准）最有效；dgoal 启动闸门要求 `verification`，且已做就绪度自检，方向一致。

**“第二个 agent 做 review”印证 dgoal 建检模式。** 文章建议用 fresh-context 第二 agent 做代码审查；dgoal 已把这内建为阶段建检和终审，并且比普通 code review 更验收导向。

**“失败教训固化为规则”印证项目经验沉淀出口。** ClaudeDevs 说不要只修单次 bug，要把教训固化到规则里；dgoal 项目已有 `doc/经验笔记.md` 出口规范，只是当前未必每次触发。

**“交出 check / stop / trigger / prompt”的分层很适合解释 dgoal。** 对用户教育来说，这比抽象讲 loop 更清楚：dgoal 让用户交出 stop condition，并让独立 checker 接管完成判定；trigger 仍由用户 `/dgoal` 手动发起。

### 3.3 候选（值得吸收）

**候选 1（文档向，强）：用“四类 loop / 交出什么”改写 dgoal 对外解释。**

改造点：

- `README.md` / `README-zh.md`：在 “Design Boundaries” 或 “Goal Lifecycle” 前增加一句定位：dgoal 是 goal-based build-check loop，不是 time-based scheduler。
- `doc/10-架构与运行/10-建检循环与三层结构.md`：补一段“dgoal 在四类 loop 中的位置”。
- `doc/术语表.md`：已补“触发器 / 停止条件 / 循环原语”三词，用来把 `/goal`、`/loop`、`/schedule` 与 dgoal 当前定位放进同一坐标系。

价值：降低用户把 dgoal 误解成 plan mode 或 scheduler 的概率。

**候选 2（产品向，中）：`/dgoal s` 显示 loop 运行计数 / 消耗提示。**

Claude `/goal` 和 `/usage` 会暴露当前 goal 轮次与 token 消耗。dgoal 目前 status 主要展示 goal/phase/task 状态，不展示本 goal 已跑几轮、建检几次、估算 token 或 cost。

改造点：

- `GoalState` 可考虑记录轻量 counters：agent continuation count、phase check count、final audit count、last audit duration。
- `/dgoal s` 详细查询 Modal 可展示这些 counters。
- token cost 若 Pi core 没有稳定 extension API，先不接；可只显示“运行轮次 / 建检次数 / 审核重试次数”。

边界：这是可观测性增强，不是完成机制；已落入路线图“后续候选”，没有真实“烧 token 看不见”的痛点前不排近期切片。

**候选 3（产品向，弱→中）：把 `budget` 从声明性信号逐步演进为运行时上限。**

ClaudeDevs 强调 `/goal` 示例里应写 “stop after 5 tries”。dgoal 已有 `budget` 字段和终审三次失败暂停，但：

- `budget` 当前只是 plan 级声明，不是硬上限。
- phase 级建检失败没有独立次数上限。
- agent 普通推进轮次没有上限。

改造点：

- `dgoal_propose.budget` 继续保留为自然语言边界。
- 未来可新增结构化 budget：`maxTurns` / `maxPhaseChecks` / `maxFinalAudits` / `maxWallClockMinutes`。
- 触发上限后进入 paused，并给用户一份“已尝试什么 / 卡在哪里 / 建议下一步”。

边界：这会改状态机和数据模型，属于够格 ADR 的难逆转设计；已落入路线图“后续候选”，当前仍按“先证据后优化”，没有真实空转样例前不排近期切片。

**候选 4（流程向，中）：把“检查项脚本化”作为 verification 质量提示。**

文章里“用脚本处理确定性工作”非常适合 dgoal 的 `verification`。启动闸门可以更明确鼓励 agent 把验收写成可复验命令，而不是自然语言。

改造点：

- `dgoal_propose` 的模型侧 guidance（非 schema）中强调：verification 优先写命令 / 文件证据 / 可复验输出。
- 启动闸门 readiness 缺口提示可在 verification 太泛时提示“缺少可复验命令或客观标准”。

边界：dgoal 不能替用户项目写万能验证器；只做提示，不做强制。

## 4. 可借鉴的具体资源

- ClaudeDevs X tweet：`https://x.com/claudedevs/status/2074208949205881033?s=46`
- X article：`https://x.com/ClaudeDevs/article/2074208949205881033`（抓取受 JS 限制）
- 宝玉翻译：《从零开始玩转循环 (Getting started with loops)》`https://baoyu.io/blog/2026-07-06/claudedevs-2074208949205881033`
- Claude Code commands docs：`https://docs.anthropic.com/en/docs/claude-code/commands`
- Claude Code hooks docs：`https://docs.anthropic.com/en/docs/claude-code/hooks`
- Claude Code skills docs：`https://docs.anthropic.com/en/docs/claude-code/skills`
- Claude Code routines docs：`https://docs.anthropic.com/en/docs/claude-code/routines`
- 相关既有参考：`doc/20-能力参考/28-循环工程与三层loop参考.md`、`doc/20-能力参考/27-独立规划agent与独立审核agent参考.md`

## 5. 决策记录

本次不新增 ADR。

本次已同步两类项目文档：

- `doc/术语表.md`：新增“触发器 / 停止条件 / 循环原语”，融合到建检循环、until-done、cadence、验收口的既有概念里。
- `doc/30-路线图/30-项目路线图.md`：新增“运行可观测性（`/dgoal s` 运行计数）”与“结构化运行时预算（Budget hard cap）”两个后续候选。

原因：这次主要是定位校准与候选增强，不构成新的难逆转决策。若后续决定实施“结构化 runtime budget”或“`/dgoal s` 运行消耗统计”，再按状态机 / 数据模型影响补 ADR。
