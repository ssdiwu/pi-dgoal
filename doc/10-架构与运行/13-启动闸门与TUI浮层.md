# 13 - 启动闸门与 TUI 浮层

> 当前权威：ADR 0051；proposal 语义职责继承 ADR 0037。

## 三条建立路径

### soft Work List：默认轻量入口

```text
普通多步工作值得跟踪
  → before_agent_start 注入 soft guidance
  → agent 视需要调用 work_list
  → 立即 active；不启动 continuation / no-progress / auditor
```

讨论、解释、能力问答和单步回答不建清单。`work_list` 可原子重写当前 soft Work List；全部 Work Item terminal 且真实 Phase 显式 done 后自动收口并返回总结。

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
  → ui.select 确认 / 拒绝 / 反馈 / 切换 Profile
  → 确认后原子 active
```

- **Goal Check**：允许零 Phase；只冻结 goal 条件，最终 `goal_check`。
- **Staged Check**：至少一个真实 Phase；冻结 Phase + goal 条件，逐 Phase check 后再 goal check。

Profile 切换由确认 UI 返回反馈，要求 agent 用另一 proposal 工具重提；运行时不在原 proposal 上静默改 Profile。提案失败或 UI 异常不得改变现有 Work List / Plan Contract。

### 裸 `/dgoal` 与自然语言授权

裸命令承接前文，由 agent 归纳 objective / description；没有可承接上下文时提示补目标，不建立空合同。真实 interactive / RPC 用户输入中的明确祈使可形成一次性授权；能力问句、引用、否定、处理中追加、extension 注入与 transform 后无法精确绑定的输入不授权。

## Proposal 确认内容

确认框展示：Profile、Goal objective / description / verification、goal criteria、Staged Phase criteria、userReviewItems、Work List / Phase / Work Item 概览、nonGoals / guardrails 与 readiness。可展开 Work Item Description。它不展示旧 verification policy、runtime budget 或隐式权限。

## 持续显示浮层

使用 `setWidget("dgoal-plan", ..., { placement: "aboveEditor" })`：

- heading 显示 Profile、聚合 Work Item 进度、耗时与按终端宽度裁切的 objective；
- flat Work List 默认显示当前 Work Item；有 Phase 时显示真实 Phase 主干；不存在隐藏 Phase；
- `Ctrl+O` 展开 Work Item 与建检活性；active 日常视图最多 10 行；
- done 文本使用删除线，状态用 `○ / ◐ / ✓ / ⚠ / ◌` 等字符；
- 持续浮层不展示完整 Description；详细字段由工具展开或 Status Modal 承担；
- Goal 完成时展示短暂 done snapshot 后隐藏；即使动画失败，状态已先清理。

刷新时机包括九工具结束、agent turn、Plan 激活、session start/tree/compact 与 check 活性变化。状态机和持久化不依赖 TUI 成功。

## `/dgoal s` Current / History Modal

使用 `ctx.ui.custom(..., { overlay: true, anchor: "center" })`：

- **Current tab**：Goal heading、完整 Description、Profile、frontier、最新适用审核投影与可选 Phase / Work Item。
- **History tab**：当前 session 分支的终态 Plan Run 列表；详情展示 Profile、终态、Goal、Description、Plan Run ID、summary / verification、结构化 check 与 Work List 快照。
- **两层浏览**：Enter 打开详情；Esc 返回且保留选择；Ctrl+C 关闭；长文本和列表各自滚动。
- **只读**：Modal 不修状态、不恢复 History；`/dgoal history clear` 使用独立二次确认。
- **隐私边界**：History 与审核投影不展示 auditor 原始 report、thinking、transcript、checkpoint 或内部修复索引。

## 状态栏

`setStatus("dgoal", …)` 显示 starting / active / paused / done 与 Profile。business rejection 保持 active。soft Work List 不显示 Plan pause 语义。

## 启动兜底

显式 `/dgoal` 后主 agent 若未提交 `goal_plan` / `staged_plan`，运行时可有界提示重试；连续失败后中止 pending 启动，不用空 Plan 越过确认门。soft / Execution 不走该兜底。

## Fail-soft 边界

- proposal 确认 UI 抛错：恢复 pending proposal 或保持原状态，不半激活；
- overlay / status / notify 抛错：跳过展示，状态事实不变；
- check 活性渲染抛错：审核结果仍按 revision 落地；
- completion snapshot 抛错：done / tombstone / runtime 清理已经完成，工具仍返回总结。
