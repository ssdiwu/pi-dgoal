# 28 - 循环工程与三层 loop 参考

> 2026-07 调研。对象：量子位《傻瓜式Loop教程》（公众号 QbitAI 2026-07-03，二手）→ 追一手：Cobus Greyling `loop-engineering`（GitHub）、Addy Osmani《Loop Engineering》canonical essay、Cobus《Goal Engineering》、吴恩达 The Batch issue-359（2026-06-30）。结论用于判断循环工程 / 三层 loop 对 pi-dgoal 的借鉴意义。本文是调研讨论的全量沉淀，配合术语表新增词条（循环工程 / 直到完成 / 定时循环 / 就绪度分级）和路线图候选。

## 1. 总体判断

**部分值得借鉴，且这次调研催生了 dgoal 的两个结构性改进候选 + 概念版图理清。**

价值分布：

- **印证**：Addy 一句话点透 dgoal 建检循环核心（"maker/checker split applied to the stop condition"）；吴恩达三层 loop 给 dgoal 清晰的定位锚（最内层）。
- **催生候选**：Cobus 的 L0-L3 就绪度分级 + loop-audit 物证评估，暴露 dgoal 的结构性偏科（验证强、边界声明弱），催生"dgoal_propose 就绪度自检"和"dgoal_done 产出可核对文本"两个强候选。
- **理清概念**：理清 dgoal 的概念版图——建检循环是核心（验证约束，比"直到完成"更高阶），循环工程是延伸（定时循环节奏），goal/loop 不分（dgoal = pi-dgoal 扩展，同时涵盖两者）。

二手源（量子位）传歪了一个关键词：把吴恩达明确反对的"品味"传成吴恩达的主张，吴恩达本人要叫"上下文优势"。详见写作 vault 碎片 `[[二手源会反转原意不只是有损]]`。

## 2. 核心机制速览

### 2.1 Cobus loop-engineering（GitHub 4.5k Star）

- **5 primitives + memory**：调度（定时触发）、工作树（并行隔离）、skills（项目知识固化）、连接器（MCP 接外部工具）、子 agent（maker/checker 分离）+ memory/state（对话外持久状态）。
- **7 个运维 pattern**：每日巡检、PR 看管、CI 清理、依赖扫描、起草更新日志、合并后清理、Issue 处理——都是定时循环运维场景。
- **L0-L3 就绪度分级**：发布就绪度评估表，自主性换约束（详见 2.4）。
- **CLI 工具**：loop-init（脚手架）、loop-cost（token 估算）、loop-audit（就绪度打分）。

### 2.2 Addy Osmani《Loop Engineering》（canonical essay）

- **loop = recursive goal**：loop 是第一性概念，下分 cadence（定时）和 until-done（跑到完成）两种节奏。
- **maker/checker split applied to the stop condition**：写代码的 agent 不判自己 done，由 fresh model 判——这是 dgoal 建检循环最精准的外部一句话定义。
- **三个警告**：验证还是你的事（"完成"是声称不是证明）、理解债（comprehension debt，loop 越快产出理解差距越大）、认知投降（cognitive surrender，loop 自跑时容易放弃判断）。三债模型见写作 vault `[[AI编程的三债模型]]`。

### 2.3 吴恩达 The Batch issue-359（2026-06-30，一手）

- **三层 loop**（不同时间尺度）：agentic coding loop（分钟级，agent 自写自测自改）、developer feedback loop（几十分钟到数小时，开发者审查引导）、external feedback loop（数小时到数周，真实用户反馈）。
- **人的贡献是"上下文优势"不是"品味"**：吴恩达明确反对"品味"措辞——上下文优势指明帮 AI 进步的方向（人有 AI 不知道的上下文，需 human-in-the-loop 注入），"品味"是玄学黑箱。详见写作 vault `[[上下文优势比品味更精确]]`。

### 2.4 L0-L3 就绪度分级（loop-design-checklist + loop-audit）

- **四级**：L0 Draft（只有意图）/ L1 Report（分诊写状态不改）/ L2 Assisted（带验证器小自动修复）/ L3 Unattended（无人值守）。
- **核心交易**：自主性换约束——要 agent 更自主，就得补更多约束（验证/护栏/预算/可观测）。是"没有约束的 loop 只是把错误自动化"的就绪度版。
- **loop-audit 评估方式**：物证导向——查 15 类东西在不在（状态文件/检验技能/配置/预算/运行日志）+ v1.4 活动证据（有没有真在跑），不评内容质量。L3 硬要求四样齐（verifier + state + cost observability + proven activity）。

### 2.5 Cobus Goal Engineering（/goal 的四 primitive）

- **四 primitive**：objective（有界目标 + 可验证完成条件）、verifier（写代码的不判自己）、state（GOAL.md 跨会话外部记忆）、budget（轮次/token 上限 + kill switch）。
- **goal vs loop**：Cobus 切两层（loop 定时 vs goal until-done，互补不同层）——dgoal 不接受这个分法（见术语表：dgoal 同时涵盖两者，建检循环是核心，循环工程是延伸）。

## 3. 与 pi-dgoal 的关系

### 3.1 设计冲突（明确不借）

**不借循环工程的 cadence / worktree / skills / 连接器 primitives。** 这些是定时循环运维场景的能力（定时调度、并行隔离、外部系统连接），dgoal 是会话内 goal 扩展，明确不做（路线图边界）。skills/MCP 是 Pi 原生能力，dgoal 不重复。

**不借跨会话状态（STATE.md / GOAL.md）。** Cobus 的外部状态文件偏跨 session（明天接着干），dgoal 明确会话内单 goal（跨 session 归 dteam）。会话内版（LoopGoal 持久化）是同思路（见 3.2）。

**不借 Cobus 的 goal/loop 两层分法。** Cobus 切 loop（cadence）和 goal（until-done）为不同层；dgoal 的定法是建检循环是核心（验证约束，比 until-done 更高阶），循环工程是延伸，goal/loop 不分（dgoal = pi-dgoal 扩展同时涵盖两者）。详见术语表。

**不借 L1-L3 分级机制本身。** Cobus 按自主权分级（report / assisted / unattended）；dgoal 按用户介入节点分级（开始前 + 结束 + 异常暂停，中间不介入）。dgoal 是半自动，不用自主权分级——它的可靠性靠"独立建检 + 用户介入节点"，不靠"逐步放手"。

**不借 loop-audit 项目级打分。** Cobus 的 loop-audit 给整个 repo 打 0-100 分；dgoal 审的是单个 goal 的 plan 就绪度（plan 级不是 repo 级）。但就绪度评估思想已借到 plan 级（见 3.3）。

### 3.2 同思路印证

**maker/checker split applied to the stop condition。** Addy 一句话点透 dgoal 建检循环核心——"停止条件本身套用制作器/检验器分离，判定完成的全新模型，不是写代码的那个"。dgoal 已落成 `dgoal_check` 独立子进程，且比内建 `/goal` 更深：全新上下文 + 受限核验工具 + phase 完成唯一入口 + 建检闸门锁定。关键辨析："fresh" 指上下文不是模型——dgoal 可继承主模型，也可通过 `phaseAuditorModel` / `goalAuditorModel` 固定两级审核的专用模型与思考等级；`null` 显式回到当次会话模型，字段缺失或非法时继续按配置优先级降级，全链都无有效值才回退。关键仍是上下文隔离。印证 ADR 0006 + 22-ADaPT 参考。

**吴恩达三层 loop 定位锚。** dgoal 对应最内层（agentic coding loop，建检循环正是 agent 自写自测自改直到通过）；中间层（developer feedback loop）靠启动闸门 + 终审介入 + pause/resume 承载；外层不在范畴。吴恩达"上下文优势"印证 dgoal 不让 agent 自己定 goal，而是人通过启动闸门注入。

**外部状态会话内版。** Addy"agent 会忘，repo 不会"——dgoal 的 LoopGoal 持久化正是抗 compaction / resume 丢失。但 dgoal 有意做轻（存储重 + 注入轻 + 不外置的分层设计，见候选讨论）：存储全量保真（plan + 建检反馈原文不压缩）、注入软遗忘（done phase 只标题行）、封装 session entry 不写文件进用户项目。Cobus 做重（外置独立文件、跨会话、人可编辑）服务于定时运维场景；两者是各自定位的有意取舍。

**就绪度评估思想。** loop-audit 的"物证评估"被 dgoal 借到 plan 级（术语表"就绪度分级 L0-L3"），只是形态不同（分级不用分数，嵌启动闸门确认而非独立 CLI）。

**"没有约束的 loop 只是把错误自动化"。** vault 已有此碎片，Cobus L0-L3 是它的就绪度产品化版（自主性换约束）。

### 3.3 候选（值得吸收）

**候选（强）：dgoal_propose 就绪度自检（L0-L3 字段物证 + 缺口提示）。** [已落路线图] 当前 `dgoal_propose` 只做必填校验（objective + verification），验证维度超 L3 但缺边界声明。升级成就绪度自检：提交时根据字段全不全自动评等级 + 列缺口（non-goals / 护栏 / budget），嵌启动闸门确认。比 loop-audit 轻（只查 plan 字段不扫文件）。non-goals 近优先，护栏/budget 次优先。

**候选（强）：dgoal_done 产出可核对的理解文本（降理解债）。** [已落路线图] 当前 `dgoal_done` 只要 summary + verification（自由文本）。参考三债模型（理解债 agent 能帮、意图债不能），完成阶段产出结构化可核对文本（改了什么 / 为什么 / 怎么验证 / 哪些要确认）。和就绪度自检对称——plan 阶段（`dgoal_propose`）补 non-goals 还意图债，完成阶段（`dgoal_done`）产出可核对文本降理解债。

**候选（弱）：Budget / turn cap。** [26-Datawhale 候选 2 同族] dgoal 有间接兜底（终审 3 次不过暂停 + pause），无显式 turn cap / token budget。潜在缺口：阶段建检无次数上限。按"先证据后优化"待真实样例。触发条件：实测出现某 phase 反复建检不过、agent 空转烧 token 且自身判断不出。

**候选（命名）：loop 命名清理。** [已落路线图] 类型名（`LoopGoal` 等）/ 函数名（`isLooping` / `handleLoopCommand`）/ prompt 标签（`<loop_*>` 十多处）仍有 loop 残留，按"goal/loop 不分，对外用 goal/dgoal"（术语表）统一。本次调研过完后统一改。

## 4. 可借鉴的具体资源

- Cobus `loop-engineering` GitHub：`https://github.com/cobusgreyling/loop-engineering`
- loop-design-checklist（L0-L3 就绪度评估表）：`https://github.com/cobusgreyling/loop-engineering/blob/main/docs/loop-design-checklist.md`
- loop-audit README（物证评估机制）：`https://github.com/cobusgreyling/loop-engineering/blob/main/tools/loop-audit/README.md`
- Addy Osmani《Loop Engineering》canonical essay：`https://addyosmani.com/blog/loop-engineering/`
- 吴恩达 The Batch issue-359（2026-06-30，三层 loop 一手）：`https://www.deeplearning.ai/the-batch/issue-359`，同步发于 @AndrewYNg X / LinkedIn
- Cobus《Goal Engineering》：`https://cobusgreyling.substack.com/p/goal-engineering`

## 5. 决策记录

本次不新增 ADR（候选项都是实现增强层，不触及状态机 / 数据模型等难逆转决策）。

但本次调研有明确的文档产出：

- **术语表新增 4 条**：循环工程、直到完成、定时循环、就绪度分级（L0-L3）；建检循环 / 建检模式两条补充（验证约束不是节奏 / 上下文隔离不是模型隔离）。
- **路线图新增 3 个候选**：loop 命名清理、dgoal_propose 就绪度自检、dgoal_done 可核对文本（Budget 候选并入 26-Datawhale 同族）。
- **写作 vault 新增 2 碎片**：`上下文优势比品味更精确`、`二手源会反转原意不只是有损`（脱离 pi-dgoal 也成立的判断，已维护碎片图谱）。

够格进 `doc/决策档案/` 的边界：若后续决定实施就绪度自检（改 `dgoal_propose` schema）或可核对文本（改 `dgoal_done` schema），涉及数据模型 / 启动闸门 / 完成产出等难逆转改动时，再补 ADR。
