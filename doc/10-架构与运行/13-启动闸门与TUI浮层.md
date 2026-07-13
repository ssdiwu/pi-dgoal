# 13 - 启动闸门与 TUI 浮层

> `/dgoal` 启动流程与计划浮层。决策依据见 `../决策档案/0002-启动闸门与工具回调提交计划.md`。

## 启动闸门流程

```
/dgoal <objective>            # 路径 A：显式目标启动
/dgoal                       # 路径 B：承接前文共识启动（v0.5.2）
  ↓
主代理读代码/前文 + 整理 plan(用 dgoal_propose 提交 goal + phases + 冻结验收条件 + 可选用户复核项)
  ↓
dgoal_propose execute：结构校验 → 当前会话 LLM 计划语义预审 →（通过或带完整精确迁移映射的改写后）写入 pendingProposal；再触发确认 UI
  ↓
弹 ctx.ui.select 确认 UI(默认列 goal + verification + 独立验收条件 + 用户复核项 + readiness + 边界/缺口提示 + phases + task 数量;用户可点入口查看 task 明细):
  ├─ 确认 → 写入 goal(pending→active),发 START prompt 进 loop
  ├─ 拒绝 → 中止,不进 loop
  └─ 输入反馈(ctx.ui.editor)→ 反馈喂回主代理 → 重新整理 → 再弹确认
  ↓
agent_end 检测:主代理本轮是否调了 dgoal_propose?
  ├─ 调了 → 走确认 UI
  └─ 没调 → 兜底(见下,已决)
```

### 裸 `/dgoal`（路径 B，v0.5.2）

- **目的**：grill / 讨论已经在前文把目标对齐清楚时，不要求用户再手打一遍 objective。
- **路由**：裸 `/dgoal`（空 args）从原来的 `status` 改为 `start`；看状态统一用显式 `/dgoal s`。
- **承接方式**：命令层只发“承接前文启动”的信号，`summarizeContext` 仍只产 `contextSummary` 背景；真正的 `objective` 由主代理在 `dgoal_propose` 里归纳并提交。
- **前文为空时不硬启动**：如果当前 session 没有可承接的前文共识，就提示改用 `/dgoal <objective>` 或先对齐后再裸 `/dgoal`。

### 为什么是启动闸门(不是纯自主)

纯自主模式(agent 直接进 loop 自建 plan)的失败是 plan 跑偏在 loop 内不可见,用户只能等结束或中途打断才发现--南辕北辙往往体现在步骤拆解里。启动闸门用一次人工确认把这个成本前置付掉。

本轮改动起，启动闸门不只展示“做什么”（goal / verification / phases），还冻结并展示两类完成信息：**独立验收条件**（goal + 每个 phase 必须具备，缺失则提案直接拒绝）与**完成后用户复核项**（可选，只在完成回复中告知用户，不进入 phase/goal 完成门）。计划仍展示 **plan 级就绪度自检**：至少到 L2（目标 + 验收口 + 独立验收条件 + 阶段计划），若 `nonGoals` / `guardrails` / `budget` 缺失，则在确认框里显式暴露缺口。

### 验收契约边界

`dgoal_propose` 的 `acceptanceCriteria` 是 phase/goal 的冻结完成门：每项必须由 LLM 通过工具、命令、文件或可观察外部状态独立复验。TUI 视觉、实际使用和主观体验事项写入 `userReviewItems`，确认时可见，但不阻塞 dgoal 完成；语义预审改写时必须用精确 `sourceCriterion` → `userReviewItem` 映射保留被移除的要求，不能静默丢弃。审核器只能复核冻结条件，不能在 loop 运行中依据 AGENTS/README 或自身判断扩容完成门。

### 为什么用工具回调(不用文本解析)

steps 是数组结构(id/subject/blockedBy),工具 schema 能强制结构,文本解析保证不了嵌套字段且格式漂移会失败。工具调用本身也是"主代理整理完毕"的信号,兜底简单。`dgoal_propose` 与 `dgoal_done` 对称(提交计划 / 提交完成)。

## TUI 计划浮层(借鉴 rpiv-todo)

照搬 `todo-overlay.ts` 结构,`placement: "aboveEditor"`:

- **注册**:`pi.setWidget("dgoal-plan", factory, { placement: "aboveEditor" })`
- **heading**:`🎯 <objective 首行> (X/Y)`,X/Y 为 phase 完成数。
- **每行**:`├─ [符] phase subject`,符 ○ pending / ◐ in_progress / ✓ done / ⚠ blocked;done 的 phase/task 标题文本带删除线,状态字符和树形符号不带(ADR 0009)。
- **task 默认隐藏**:双可见性轴。持续显示浮层的展开态跟随 Pi 的 `app.tools.expand`(默认 `Ctrl+O`)，但只展开 `pending / in_progress` phase 的 task；`done phase` 持久显示标题行，不再在持续显示展开态里露出其 task。浮层底部同一行固定提示快捷键 + 常用命令说明。
- **不展示建检报告**:aboveEditor 浮层只显示状态与 plan 结构，不承载阶段/终审失败报告；报告是 agent-facing 修复输入，不是持续浮层正文。
- **A-line i18n 软依赖**:浮层、状态栏、通知、启动闸门确认 UI 等用户可见文案通过 `pi-di18n` bundle 本地化;缺失 `pi-di18n` 时降级为内置中文。模型侧 prompt、tool description、schema description 不在本地化范围,避免改变 agent 行为。
- **done phase 持久显示**:phase 是用户确认过的进度主干,完成后仍持续显示(✓),不因 `agent_start` 或 `/reload` 隐藏;只有整个 goal done / clear 后浮层才消失。Goal Repair 期间为支持终审回查，system prompt 暂停 done phase 的软遗忘，保留全量 phase/task 上下文；判据是 `status === rejected`、`paused(audit_failed_3x)`，或 `finalFeedback` 存在（含 resume 后 status 已回 active 的修复期）。
- **10 行折叠**:浮层自身最多渲 10 行(heading + body + 底部 hint),给 Pi core 的 widget 区域留余量,避免触发 `(widget truncated)`;溢出时保留底部 `Ctrl+O 显示/隐藏 task` hint,并用 `+N more` 摘要。
- **空时隐藏**:无 plan 或 goal 为 pending/已 clear 时 `setWidget(key, undefined)`；paused goal 保留冻结的 plan 浮层供只读查看。
- **刷新时机**:`tool_execution_end`(toolName 是 dgoal_plan/dgoal_check)+ `agent_end` 推进 iteration 时。注意 `tool_execution_end` 只读 `getState()`,不 replay(branch stale)。

### 状态栏(现有,保留)

`ctx.ui.setStatus("dgoal", ...)` 显示 goal 级状态:
- `🔁 active #N`(N=iteration)
- `🔁 paused` / `🔁 starting...` / `🔁 rejected ×M`(M=rejectedCount)/ `🔁 done`
- `rejected` 展示 `终审修复（Goal Repair）· 第 M/3 次`；`paused(audit_failed_3x)` 展示 `终审修复已暂停`。该文本是展示投影，不是新的状态、phase 或 task。

## `/dgoal s` 详细查询 Modal(v0.4.2+,视觉编码 v0.5+ 见 ADR 0009)

`/dgoal s`（`status` 单字母别名）调 `ctx.ui.custom()` 弹一个 center overlay modal，让用户能按需看完整 plan 细节（goal + 所有 phase + 所有 task）。**与上方持续显示浮层职责正交**——浮层是“持续进度显示”，s 是“按需详细查询”。持续显示浮层走收敛视图，详细查询 Modal 保留全量 phase/task 细节；两者都不展示建检报告正文。

### 建检反馈的可见性边界（v0.5.2）

- 原始建检/终审失败报告会通过 system prompt 的 `<check_feedback>` block 注入给主 agent，作为后续修复输入。
- 注入顺序：`<dgoal_goal>` → `<dgoal_context>` → `<dgoal_plan>` → `<check_feedback>` → 循环规则。
- **用户侧 TUI 不复读报告正文**：aboveEditor 浮层、`/dgoal s` modal、底部状态栏都不渲染 `report`，避免把 agent-facing 修复材料变成持续 UI 噪音。
- 进行中的建检可以在工具执行流里展示活性片段（如 `thinking` / `tool_running` / `idle Ns/180s`），但这仍属于运行时状态，不是报告正文。

决策依据：形态选型 `doc/决策档案/0008-dgoal-s-modal-形态选型.md`（原 Variant A top-center，v0.5+ 切 center，见追加决策）；视觉编码 `doc/决策档案/0009-TUI视觉编码改为层级靠颜色状态靠字符.md`（**层级靠颜色，状态靠字符**，覆盖 ADR 0008 的 emoji+status 色方案）；探索过程：`doc/20-能力参考/25-dgoal-s-modal变体探索参考.md`。

形态:
- **heading 钉顶**:`🎯 <objective 首行> (X/Y) ⏱️ <elapsed>`,accent 色 + bold
- **body 可滚动**(层级靠颜色,状态靠字符):每 phase 一行(前缀统一状态字符 `○/◐/✓/⚠` + phase 层级基色 text),phase 下 task 缩进(`│    ○/◐/✓/⚠` + task 层级基色 dim);详细查询 Modal 保留全量 phase/task 细节，包含 `done phase` 的 task；done 的 phase/task 标题文本带删除线,状态字符和树形符号不带;行内后缀说明(`activeForm` 用 `(...)`、`blockedReason` 用 `[...]`)作为辅助信息弱化显示,不参与删除线
- **底部 hint**:内容超过可见高度时显示 offset 指示 + 滚动键位;短内容 / 空状态只显示 `ESC/Ctrl+C` 关闭提示。
- **滚动**:vim 风格 `j` 下、`k` 上;`↑↓` 方向键、`PgDn/PgUp` 跳 10、`End/G` 跳底、`Home/g` 跳顶、`ESC` 退出
- **overlay 配置**：`anchor: "center"`, `width: "100%"`, `maxHeight: "85%"`, `margin: 1`（原 top-center，v0.5+ 切 center，见 ADR 0008 追加决策）
- **空状态**：没有 goal 时弹同一个 center modal，显示“当前没有进行中的 dgoal”、`/dgoal <goal>` 引导和 `ESC/Ctrl+C` 关闭提示；paused goal 仍存在，`/dgoal status` 展示其 plan 只读内容；非 TUI / custom 不可用时降级为 notify。

**为什么 modal 本次彩色化、持续浮层暂不**:持续浮层彩色化涉及把 `aboveEditor widget` 从 `string[]` 升级为 theme-aware factory,会引入新的 TUI 渲染 bug 面;本次浮层只统一状态字符、结构和 done 删除线,彩色化延后到下一版本(见 `doc/30-路线图/30-项目路线图.md`)。

**为什么不复用 widget**:`setWidget` 走 Pi 的 `MAX_WIDGET_LINES = 10` 限制(参考 `tui.js:1421`),modal 30+ 行 plan 装不下。`ctx.ui.custom()` 没有这个限制,且支持键盘事件 + 滚动 + 自定义 anchor。

## 兜底(已决)

主代理不调 `dgoal_propose`(跑偏没产出 plan)时:降级提示重试 2 次;仍无产出则中止启动(goal 不进 `active`,直接清除),不走"进 loop 自建 plan"的纯自主兜底。详见 `30-路线图` 与 `决策档案/0002-启动闸门与工具回调提交计划.md`。
