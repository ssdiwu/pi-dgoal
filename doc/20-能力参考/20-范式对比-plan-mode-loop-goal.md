# 20 - 范式对比：plan mode / loop / goal

> 2026-06 联网调研。支撑 dgoal 范式定位（goal 范式，非 plan mode）。来源：lucumr.pocoo.org、forum.cursor.com、Reddit /goal 实战。

## 三范式对比

| 范式 | 解决的核心问题 | 何时停 | 状态归属 |
|---|---|---|---|
| **Plan Mode** | "怎么做"——读代码、拆步骤、产出可审查计划 | 人点"接受"才停 | 磁盘 markdown 文件 |
| **Agentic Loop** | "自动多步执行"——工具循环直到模型自己停 | 模型自己决定停 | 无持久状态，全在 transcript |
| **Goal Mode** | "何时允许停"——绑定可验证完成契约 | LLM 评估 Stop hook 契约是否满足 | 持久 goal 对象 + 状态机 |

## 关键洞察

**plan mode 的本质（Armin Ronacher 拆解）**：plan mode 不是工具权限切换，**本质是一段 system prompt**。"Plan mode is active... you MUST NOT make any edits" + 四阶段结构 + "写完计划文件就调退出工具等用户批准"。工具其实没真变只读，是 prompt reinforcement。计划本身是磁盘 markdown 文件。**它只管"怎么做"，不管"何时停"。**

**plan vs goal 的本质差异（Cursor forum 金句）**：

> "Plans help the agent know **what to do**; Goal Mode would define **when the agent is allowed to stop**."
> "Plan Mode is great for decomposition, review, and turning work into steps, but a plan is **not the same as an autonomous completion contract**."

转向的真实痛点：plan mode 的 plan 可以"完成计划但不满足实际目标"（objective drift / 提前停止 / 假"done"）。goal mode 用"持久 goal 对象 + Stop hook 契约 + 完成审计"把"何时停"变成可验证的，不是模型说了算。

## dgoal 的定位

dgoal 已是 goal 范式（持久 goal + check 审计 + Stop 语义）。Task Plan 是给 goal 补"怎么做"的结构化脚手架，**不退化成 plan mode**。

- 启动闸门确认 **goal**（方向正确性，用户掌控）→ 解决纯 goal 范式"plan 跑偏不可见"。
- loop 内可调 **task**（执行适应性，agent 掌控）→ 解决纯 plan mode"plan 错了卡死"。
- TUI 显示 **phase 进度**，goal 稳定不晃。

## goal 范式的威力与失败模式（9 小时 /goal 实战）

- **威力**：Stop hook 是另一个 LLM 读 transcript 评估契约，**能检测 bullshit、拒绝假 done**。
- **失败模式①**：契约太紧→死循环；太松→假 ack。解法是**每条成功标准配一条诚实失败条款**（"≥14 fetch 完成 OR ack stale 并点名外部 blocker"）→ 对应 dgoal 的 task `blocked` 状态。
- **失败模式②**：autocompact 丢状态。解法是**状态落盘**（custom entry），不靠 transcript → dgoal 已用 dgoal-state entry 持久化。
- **关键洞察**："iterative auditing dominates exhaustive auditing"——中途多次短审计胜过只在终点审一次 → 对应 dgoal 的 `dgoal_check` 阶段建检（每个 phase 完成都 check）。

## 一个反方声音

Armin：plan mode 这种"切换 UI 模式"的复杂度可能多余——"为什么不直接用自然语言让模型规划？" pi 和 Amp 都没 plan mode。dgoal 的回应：dgoal 不做 plan mode 的"模式切换"，而是把 plan 做成 goal 内的结构（phase/task），通过启动闸门 + TUI 浮层实现可见性，不引入"模式"概念。
