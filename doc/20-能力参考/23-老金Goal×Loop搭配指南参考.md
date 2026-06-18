# 23 - 《Goal × Loop 搭配指南》参考

> 2026-06 调研公众号文章《Goal × Loop搭配指南：长任务自动化落地老金给你讲明白！》并做外部对照。对照来源：Anthropic《Building effective agents》《Effective harnesses for long-running agents》、LangChain《The Runtime Behind Production Deep Agents》。

## 1. 总体判断

**部分值得借鉴，但主要价值在用户教育和启动闸门文案，不在核心架构。**

这篇文章最有价值的点，是把 **“愿望 ≠ goal；goal 必须可验收”** 讲得很清楚，也把 **goal / loop / state** 的分工讲成了普通用户能立刻照抄的语言。对 `pi-dgoal` 来说，它更像一篇**产品教育 / onboarding（上手引导）参考**，不是新的架构来源。

原因：

- `pi-dgoal` 的核心机制（goal 范式、独立建检、phase 门、持久状态）已经覆盖了文章的大部分正确方向；
- 文章没有提出比 `dgoal_check` 更强的“独立验证”机制，更多停在“把目标写清楚 + 让 loop 围着目标转”；
- 真正值得吸收的，不是它的整套个人工作流脚本，而是它对 **可验收 goal** 的强调，以及对 **state 不是聊天记录而是续跑纪要** 的表述。

一句话：**可借它的讲法，少借它的整套做法。**

## 2. 核心机制速览

### 2.1 goal 是可验收结果，不是愿望

文章最核心的判断：`“帮我优化一下 / 写个爆款 / 做个 AI 助手”` 这类话更像愿望，不像 goal。真正的 goal 必须能回答：

- 服务谁；
- 交付什么；
- 以什么标准验收；
- 有什么边界；
- 不过关时下一轮往哪改。

这和 `pi-dgoal` 的基本盘一致：goal 不只是让 agent 开干，而是定义 **什么时候允许停**。

### 2.2 loop 不是“多跑几轮”，而是围绕同一 goal 反复推进 / 检查 / 修正

文章把 loop 讲成“反复执行、检查、修正的一套动作”，并强调：**没有可验收终点，loop 只是在换着方式猜。**

这与 `pi-dgoal` 的建检循环高度同向：不是模型自己说 done，而是推进一段、建检一段，不过继续干。

### 2.3 state 不是长上下文，而是下一轮能接着跑的纪要

文章把 state 比喻成会议纪要，而不是会议录音。它主张 state 只保留：

- 做到哪了；
- 哪些坑别再犯；
- 下一步改什么。

这是对长任务续跑问题的正确抽象。外部资料也一致：Anthropic 的 long-running harness 强调 progress file（进度文件），LangChain 强调 durable execution（可恢复执行）和 checkpoint（检查点）状态。

### 2.4 workflow 和 agent 要分场景

文章借 Anthropic 的说法区分：

- `workflow`（预设路径编排）适合固定轨道任务；
- `agent`（模型动态决策）适合开放式探索。

这和 `pi-dgoal` 已有的 `doc/20-能力参考/20-范式对比-plan-mode-loop-goal.md` 一致：不要为了“更高级”而把所有东西都做成 agent。

### 2.5 长任务要把 goal 放在显眼位置反复重申

文章强调：不要把 goal 埋在长聊天记录中间；每轮续跑都要把当前 goal、验收标准和状态重新摆到模型眼前。

这也是外部主流做法：Anthropic long-running harness 会让每个新 session 先读 feature list、progress file、git log，再决定下一步。

### 2.6 个人外层 loop：从重复任务沉淀 prompt 模板

文章后半段给了一套个人工作流：采集当天输入 → 找重复任务 → 生成 prompt 模板库 → 周末合并。这更像个人效率系统，而不是 `pi-dgoal` 这类目标循环扩展的核心能力。

## 3. 与 pi-dgoal 的关系

### 3.1 设计冲突（明确不借）

#### 冲突 A：把“采集用户日志 → 自举 prompt 库”当成 dgoal 核心能力

**不借。**

原因：

- `pi-dgoal` 的定位是 **目标循环与建检扩展**，不是个人 prompt 管理器；
- 文章的 Hook + 本地日志采集方案面向个人工作台，和本项目的扩展边界不一致；
- 引入这类能力会把项目从“goal completion contract（完成契约）”拉偏到“个人知识 / prompt 资产沉淀工具”。

对应边界：`AGENTS.md` 与 `README.md` 都明确本项目聚焦会话内单目标、Task Plan、建检循环，不扩成泛工作流平台。

#### 冲突 B：只靠“写清 goal”替代独立建检

**不借。**

文章对“goal 要可验收”的判断是对的，但它没有提供比 `dgoal_check` 更强的验证机制。若把结论误读成“只要 goal 写清楚，loop 就能稳定完成”，会削弱 `pi-dgoal` 的基本盘。

`pi-dgoal` 的关键不是“会写 goal”，而是：

- phase completed 唯一入口是 `dgoal_check`；
- 验证在独立只读子进程里完成；
- agent 不能自己给自己判卷。

所以这篇文章**不能**作为削弱建检门的依据。

#### 冲突 C：把 Git/脚本化环境管理默认内建进 dgoal

**不借。**

外部 long-running harness 常把 `git commit`（Git 提交）、`init.sh`（初始化脚本）、progress file（进度文件）作为工程环境的一部分。`pi-dgoal` 明确边界是不自动做 Git 动作，也不替代项目自己的运行 / 测试方式。

这类能力若要有，也应是宿主 harness 或项目脚手架的职责，不应默认塞进 `pi-dgoal`。

### 3.2 同思路（已有，印证方向）

#### 同思路 A：goal 管“何时允许停”

文章强调 goal 必须可验收；`pi-dgoal` 已通过 goal + `dgoal_done` + 终审把“何时允许停”做成了机制，而不是提醒。

对应实现：

- `index.ts`：`buildAuditorTask()`
- `index.ts`：`AUDITOR_SYSTEM_PROMPT`
- `doc/10-架构与运行/10-建检循环与三层结构.md`

#### 同思路 B：state 应是可续跑的摘要，而不是全文 transcript

文章把 state 讲成会议纪要；`pi-dgoal` 已有：

- `contextSummary`（启动背景固化）；
- `plan`（phase/task 结构化状态）；
- `dgoal-state` custom entry 持久化。

这说明项目方向正确，不必因为这篇文章重做状态模型。

对应实现：

- `index.ts`：`LoopGoal.contextSummary` / `LoopGoal.plan`
- `index.ts`：`persistGoal()` / `loadGoal()`
- `doc/10-架构与运行/12-工具命令与数据模型.md`

#### 同思路 C：workflow / agent 要区分，不要无脑 agent 化

文章对 `workflow` / `agent` 的区分，与项目已有范式对比文档同向。

对应文档：

- `doc/20-能力参考/20-范式对比-plan-mode-loop-goal.md`

#### 同思路 D：长任务要显式暴露进度与下一步

文章强调别让模型在长上下文里失焦；`pi-dgoal` 通过 phase/task 计划、浮层可见性和阶段建检，已经把“当前做到哪”显式化。

对应实现：

- `index.ts`：`renderPlanLines()`
- `doc/10-架构与运行/13-启动闸门与TUI浮层.md`
- `doc/10-架构与运行/10-建检循环与三层结构.md`

### 3.3 候选（值得吸收）

#### 候选 A：把“可验收 goal”前置到启动闸门文案和确认 UI

**值得吸收，优先级高。**

当前 `pi-dgoal` 已有 `verification?: string`，但它还是可选的，且用户/agent 很容易把它写成空话。文章最大的启发不是新架构，而是提醒我们：**如果 goal 还是愿望句，后面的 loop 和 audit 都会更吃力。**

可吸收改造：

- 在启动闸门里显式要求 agent 提交：
  - 目标服务对象（可选）；
  - 交付物；
  - 验收方式；
  - 不做边界；
  - 至少一句全局 verification；
- 若 `verification` 缺失或明显空泛，在确认 UI 里提示“该计划缺少明确验收口”。

建议落点：

- `index.ts`：`buildProposePrompt()`
- `index.ts`：`dgoal_propose` tool schema 描述
- `index.ts`：`formatProposalForConfirm()`
- `doc/10-架构与运行/13-启动闸门与TUI浮层.md`
- `README.md` / `README-zh.md`

#### 候选 B：补一层面向用户的“愿望 → 可验收 goal”文档表达

**值得吸收，优先级高。**

这篇文章最强的是教学表达。`pi-dgoal` 现在文档里已经说明“建检循环 / goal 范式”，但对普通用户来说还偏架构语言。可以借它的表达，把用户常见误区讲得更直白：

- “goal 管终点，loop 管靠近方式，check 管是否允许停”；
- “写愿望，agent 会猜；写验收口，agent 才能干”；
- “Task Plan 是施工脚手架，不是完成证明”。

建议落点：

- `README-zh.md`
- `README.md`（英文等价表达）
- `doc/术语表.md`
- `doc/10-架构与运行/10-建检循环与三层结构.md`

#### 候选 C：考虑补一个更轻量的“续跑纪要”字段，而不只靠启动摘要 + task 证据

**可观察，优先级中。**

文章和 Anthropic long-running harness 都提醒：真正跨多轮续跑时，除了结构化 plan，还需要一个很短的“做到哪 / 当前坑 / 下一步”摘要。`pi-dgoal` 现在有：

- 启动时的 `contextSummary`；
- 运行中的 `plan` / `evidence`；
- transcript 本身。

但缺一个**运行中持续更新的短纪要**。这不一定现在就做，但值得作为后续观察项：如果实测出现 compact（上下文压缩）后 agent 需要重新猜“上一轮为什么这么改”，那就说明需要补这一层。

可能落点：

- `LoopGoal` 新增轻量 `progressNote` / `checkpointNote` 字段
- `index.ts`：续跑 prompt 注入
- `doc/10-架构与运行/12-工具命令与数据模型.md`
- `test/context-input-cap.test.ts` / 状态机相关测试

注意：这不是照搬文章的 state 文件，而是吸收其“state 应短而可续跑”的原则。

## 4. 可借鉴的具体文件 / 代码 / 资源

### 本次被调研对象

- 公众号文章：<https://mp.weixin.qq.com/s/OrNNJm795eK0PDN80szIuA?scene=1>

### 对照资料

- Anthropic《Building effective agents》
  - <https://www.anthropic.com/research/building-effective-agents>
  - 用来核对 workflow vs agent 区分、从简单模式起步的原则。
- Anthropic《Effective harnesses for long-running agents》
  - <https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents>
  - 用来核对长任务续跑时 feature list / progress file / incremental progress 的主流做法。
- LangChain《The Runtime Behind Production Deep Agents》
  - <https://www.langchain.com/blog/runtime-behind-production-deep-agents>
  - 用来核对 durable execution / checkpoint / HITL / observability 在生产运行时的职责边界。

### 本项目内对应精读位置

- `doc/20-能力参考/20-范式对比-plan-mode-loop-goal.md`
- `doc/20-能力参考/22-ADaPT与建检模式.md`
- `doc/10-架构与运行/10-建检循环与三层结构.md`
- `doc/10-架构与运行/12-工具命令与数据模型.md`
- `index.ts`
  - `buildProposePrompt()`
  - `formatProposalForConfirm()`
  - `buildAuditorTask()`
  - `buildPhaseCheckTask()`

## 5. 决策记录

**暂无新增 ADR。**

当前结论还停留在“文案与启动闸门可加强”，尚未到需要写架构决策记录的程度。

若后续决定：

- 将 `verification` 从“可选提示”升级为更强约束；或
- 引入独立的运行中 `progressNote` 持久字段；

再评估是否满足 ADR 条件（难逆转 / 无上下文会困惑 / 有真实权衡）。
