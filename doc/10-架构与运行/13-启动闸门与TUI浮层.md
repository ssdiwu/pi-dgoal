# 13 - 启动闸门与 TUI 浮层

> 当前权威：ADR 0051；未完成计划恢复见 ADR 0052；proposal 语义职责继承 ADR 0037。

## 三条建立路径

### soft Work List：被动跟踪入口

```text
用户明确要记录、整理、等待后续输入或不要求本轮完成
  → before_agent_start 注入 soft guidance
  → agent 调用 work_list
  → 立即 active；不启动 continuation / no-progress / auditor
```

讨论、解释、能力问答和单步回答不建清单。修复、实现、验证、交付等有明确交付结果且无需用户继续决策的多步请求，必须直接选择 Execution Plan，不能降级为 soft Work List。`work_list` 可原子重写当前 soft Work List；全部 Work Item terminal 且真实 Phase 显式 done 后自动收口并返回总结。

### Execution Plan：直接增加 Until Done

```text
工作确实需要持续推进
  → agent 调用 execution_plan
  → 创建计划态 Work List，或原子升级当前 soft Work List
  → active + continuation + 固定活性熔断
```

Execution 不需要 `/dgoal`、语义预审或确认 UI，也不扩大宿主权限。若真实用户已经显式授权高保障 dgoal，不能静默降级成 Execution。

### Goal Check / Staged Check：显式启动闸门

```text
/dgoal [objective]
或真实用户明确祈使“使用/启动 dgoal”
  → pending Goal + propose prompt
  → 主 agent 读相关文档/代码
  → 选择 Goal Check 或 Staged Check
  → 归一 Work List，写 Goal / Phase / Work Item Description
  → 核对端到端结果、真实调用链、失败路径与验收契约
  → goal_plan / staged_plan
  → 结构校验 → 当前会话模型语义预审
  → pending proposal
  → ui.select 确认 / 拒绝 / 反馈 / 延后 / 切换 Profile
  → 确认后发送带一次性 marker 的 extension input
  → input 复核并落 paused checkpoint
  → before_agent_start 预检最终 prompt 并注入目标 Plan context
  → 精确 user message_end 在有效 abort signal 下原子 active
  → 同一步从会话/provider 输入中清除内部 marker；不匹配则取消该 run
```

- **Goal Check**：允许零 Phase；只冻结 goal 条件，最终 `goal_check`。
- **Staged Check**：至少一个真实 Phase；冻结 Phase + goal 条件，逐 Phase check 后再 goal check。

Profile 切换由确认 UI 返回反馈，要求 agent 用另一 proposal 工具重提；运行时不在原 proposal 上静默改 Profile。Esc、取消、空反馈与旧宿主 confirm=false 都表示“延后”，保留 pending proposal；只有显式拒绝才删除。upgrade proposal 绑定原 Goal/Work List/Contract 基线：暂停/恢复后仍可用，但新进度、evidence、check 或 Contract 变化会使旧提案失效，不能回滚当前事实。提案失败、session 变化或 UI 异常不得改变现有 Work List / Plan Contract。

### 裸 `/dgoal` 与自然语言授权

裸命令承接前文，由 agent 归纳 objective / description；没有可承接上下文时提示补目标，不建立空合同。真实 interactive / RPC 用户输入中的明确祈使可形成一次性授权；能力问句、引用、否定、处理中追加、extension 注入与 transform 后无法精确绑定的输入不授权。

## 未完成计划恢复

恢复只针对同一 Pi session 当前分支最新一条 `dgoal-work-v1`。其中 current Goal 必须完整合法；无效时 fail-closed，不回退复活更旧的 active Plan；无效 pending proposal 也不恢复。`fork` 创建的新 session 追加只含当前 session ID 的 `dgoal-session-scope-v1` 边界标记，只读取标记之后的本地状态，从而忽略宿主复制来的 Plan / History；恢复不搜索其它 session，也不把 Plan Run History 重新变成 current：

- 完整 pending proposal 保持 pending，状态提示 `/dgoal review`；冷恢复不会重新授予 `agent_end` 自动弹确认或无 proposal 重试的权力。
- active Plan Contract 在冷 `session_start(startup|resume)` 时，先于 status / overlay 原地持久化为 `paused(session_recovery)`；不发送 continuation、不自动弹窗。
- `/dgoal resume` 保留 Goal ID、Plan Run ID、Work List、revision、check 与 evidence；首轮先核对所有 `in_progress` 及工作区/外部副作用，不能确认是否已发生时必须 blocked 或询问，不得重放。
- `reload`、`session_tree` 与 `session_compact` 只做结构重同步；soft Work List 只恢复结构，不暂停、不续跑。

这条能力不声称识别 crash；它只能确认“当前分支存在未结束状态”。若确认 UI 与 session/tree 切换并发，旧选择由 session generation + Goal/Contract/revision/proposal 精确校验后丢弃；同一 proposal 同时最多有一个确认 UI。确认、resume 与反馈重提也不把 `sendUserMessage()` 视为送达：streaming 期间只排队，`before_agent_start` 只预检，精确 user `message_end` 才在有效 abort signal 下提交 active 并清除 marker；中途失败保持 pending 或 paused。feedback 旧 proposal 保留到新 proposal 通过预审并持久化；单次改写未生成合法新提案时停回 `/dgoal review`，不误入原 Plan 的 execution continuation。

## Proposal 确认内容

确认框展示：Profile、Goal objective / description / verification、goal criteria、Staged Phase criteria、userReviewItems、Work List / Phase / Work Item 概览、nonGoals / guardrails 与 readiness。可展开 Work Item Description。它不展示旧 verification policy、runtime budget 或隐式权限。

## 持续显示浮层

使用 `setWidget("dgoal-plan", ..., { placement: "aboveEditor" })`：

- soft Work List 的 heading 显示“已保存，等待下一轮”和聚合进度；不显示递增耗时，也不展示 pause / resume；
- active / paused Plan Contract 的 heading 显示 Profile、聚合 Work Item 进度和耗时；操作提示仅显示当前可用的 pause 或 resume；
- flat Work List 默认显示当前 Work Item；有 Phase 时显示真实 Phase 主干；不存在隐藏 Phase；
- `Ctrl+O` 展开 Work Item 与建检活性；active 日常视图最多 10 行；
- done 文本使用删除线，状态用 `○ / ◐ / ✓ / ⚠ / ◌` 等字符；
- 持续浮层不展示完整 Description；详细字段由工具展开或 Status Modal 承担；
- Goal 完成时展示短暂 done snapshot 后隐藏；即使动画失败，状态已先清理。

创建 Work List 或直接创建 Execution Plan 时会先绑定 widget，再刷新投影；刷新时机还包括九工具结束、agent turn、Plan 激活、session start/tree/compact 与 check 活性变化。状态机和持久化不依赖 TUI 成功。

## `/dgoal s` Current / History Modal

使用 `ctx.ui.custom(..., { overlay: true, anchor: "center" })`：

- **Current tab**：Goal heading、完整 Description、Profile、frontier、最新适用审核投影与可选 Phase / Work Item；保存提案或冷恢复 Plan 会显示对应 `/dgoal review` / `/dgoal resume` 提示。
- **History tab**：当前 session 分支的终态 Plan Run 列表；详情展示 Profile、终态、Goal、Description、Plan Run ID、summary / verification、结构化 check 与 Work List 快照。
- **两层浏览**：Enter 打开详情；Esc 返回且保留选择；Ctrl+C 关闭；长文本和列表各自滚动。
- **只读**：Modal 不修状态、不恢复 History；`/dgoal history clear` 使用独立二次确认。
- **隐私边界**：History 与审核投影不展示 auditor 原始 report、thinking、transcript、checkpoint 或内部修复索引。

## 状态栏

`setStatus("dgoal", …)` 对 soft Work List 显示“已保存清单”；Plan Contract 显示 starting / active / paused / done 与恢复入口。pending proposal 优先显示 `/dgoal review`，`paused(session_recovery)` 显示 `/dgoal resume`。business rejection 保持 active；soft Work List 不显示 Plan pause 语义。

## 启动兜底

显式 `/dgoal` 后主 agent 若未提交 `goal_plan` / `staged_plan`，运行时可有界提示重试；连续失败后中止 pending 启动，不用空 Plan 越过确认门。soft / Execution 不走该兜底。

## Fail-soft 边界

- proposal 确认 UI 抛错：恢复 pending proposal 或保持原状态，不半激活；
- proposal 确认并发或 session 切换：旧选择失效，不重复消费、不跨分支激活；
- overlay / status / notify 抛错：跳过展示，状态事实不变；
- check 活性渲染抛错：审核结果仍按 revision 落地；
- completion snapshot 抛错：done / tombstone / runtime 清理已经完成，工具仍返回总结。
