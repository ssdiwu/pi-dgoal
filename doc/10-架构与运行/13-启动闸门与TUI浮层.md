# 13 - 启动闸门与 TUI 浮层

> 当前权威设计：ADR 0038；proposal 语义职责见 ADR 0037。

## 两条启动路径

### Task Plan：默认直接建立

```text
明确、需要跟踪的多步执行任务
  → before_agent_start 注入 Task Plan 默认指引
  → agent 视需要调用 task_plan
  → 立即 active，展示 task 列表
```

Task Plan 不需要 `/dgoal`、pending proposal、语义预审或确认 UI。它不扩大权限；真正动作仍按宿主工具授权执行。再次调用 `task_plan` 会整份替换当前 Task Plan。

纯讨论、解释、能力问答和单步回答不建立 Task Plan。若 agent 判断任务需要冻结验收契约或独立审核，只能建议用户使用 `/dgoal`，不能自行调用 `phase_plan` / `goal_plan`。

### Phase/Goal Plan：显式启动闸门

```text
/dgoal [objective]
或用户明确祈使“使用/启动 dgoal”
  → pending goal + propose prompt
  → 主 agent 读相关文档/代码
  → 推荐 Phase Plan 或 Goal Plan
  → 调用 phase_plan / goal_plan
  → 结构校验
  → 当前会话模型语义预审
  → pending proposal
  → ui.select 确认 / 拒绝 / 反馈 / 切换 Plan 类型
  → 确认后 active
```

- **Phase Plan**：phase 只组织进度；冻结 goal 验收条件，最终 `goal_check`。
- **Goal Plan**：phase 是独立验收里程碑；冻结 phase 与 goal 条件，逐 phase check 后再 goal check。

用户选择切换类型时，确认 UI 返回反馈，让 agent 改用另一入口重新提交；运行时不在原 proposal 上静默改 `planType`。

### 裸 `/dgoal`

裸命令承接前文，由 agent 归纳 objective；若没有可承接上下文，只提示用户补目标，不创建空 pending Plan。查看状态必须显式用 `/dgoal s`。

### 自然语言显式启动

真实用户在空闲 interactive / RPC 输入中以祈使句明确要求使用 dgoal，可获得一次性显式启动权。能力问句、引用/代码示例、解释讨论、否定句、标识符后缀、处理中追加和 extension 注入不授权。该路径仍经过语义预审和用户确认，不是隐式启动，也不得静默降级成 Task Plan。

## 启动确认内容

确认框展示：

- Plan 类型；
- objective 与 verification；
- goal acceptance criteria；
- Goal Plan 的 phase acceptance criteria；
- `userReviewItems`；
- phases 与 task 数，可展开 task；
- `nonGoals` / `guardrails` / `contextSummary` 等已提供边界；
- readiness 提示。

不再展示或切换 verification policy、bounded/unbounded budget、implicit 权限。成本预估文本不是运行时策略。

## Proposal 语义边界

- 确定性代码只校验结构、状态、Plan 类型与显式授权。
- 当前会话模型判断候选条件属于独立验收、用户复核还是人工 blocker。
- 高风险真实动作由执行时工具边界决定，不靠 proposal 关键词猜测。
- 审核器只核冻结结果，不扩张完成门。
- 语义或技术失败不得留下半激活 Plan。

## 持续显示浮层

使用 `setWidget("dgoal-plan", ..., { placement: "aboveEditor" })`：

- 默认只显示 heading、聚合进度、耗时与 `Ctrl+O` 提示，避免日常操作淹没对话；Task Plan 的隐藏 phase 永不显示。
- `Ctrl+O`：展开当前 Plan 的 phase/task 与建检活性；再次按下收起。goal 完成后的 10 秒快照则完整展示所有 phase/task，不受日常 10 行限制。
- heading 优先保留进度与耗时，objective 按当前终端显示宽度（含中文宽字符）动态裁切，禁止自动换成第二行。
- 展开中的 active Plan 最多 10 行，过长时显示折叠提示。
- done 文本使用删除线，状态用 `○ / ◐ / ✓ / ⚠` 字符，层级用固定基色。

刷新时机包括 Plan 激活、八个工具执行结束、agent turn 结束，以及 session start/tree/compact 重同步。状态机和持久化不依赖 TUI 成功；`setWidget`、`setStatus`、notify 或 Modal 抛错只能降级。

## `/dgoal s` 详细查询 Modal

使用 `ctx.ui.custom(..., { overlay: true, anchor: "center" })`。它按需展示完整可见 Plan：

- Task Plan：平铺完整 task，不显示隐藏 phase。
- Phase/Goal Plan：完整 phase 与 task，包括 done phase 的 task。
- 审核运行时只展示轻量活性片段，不展示原始报告正文。

持续显示浮层是 L3 widget；详细查询是 L2 overlay Modal，两者不可混叫。

## 状态栏

`setStatus("dgoal", …)` 显示 goal 级 starting / active / paused / done。check rejection 保持 active，并通过 Plan context 与工具结果推动修复；新三档 Plan 不使用预算宽限或 `budget_exhausted` 展示。

## 启动兜底

显式 `/dgoal` 后主 agent 若没有调用 `phase_plan` / `goal_plan`，运行时可提示重试；连续失败后中止 pending 启动，不以空 Plan 越过确认闸门。Task Plan 不走此兜底。
