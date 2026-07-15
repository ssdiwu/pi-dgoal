# ADR 0005：step blocked 状态

> Status：部分被 ADR 0038 覆盖。`blocked` 与必填原因继续保留；blocked 作为完成放行条件的旧语义已删除，task/phase 必须真正 done 才能完成。

## 背景

step 状态机原为三态 `pending → in_progress → completed`。调研（9 小时 /goal 实战）最硬教训：goal 契约必须配诚实失败条款，否则死循环（契约太紧）或假完成（契约太松）。agent 跑到某 step 发现做不下去（外部依赖缺失、需要权限、技术上不可行）时，三态只能：标 completed（假完成）、留 in_progress（卡死，dgoal_done 永远放行不了）、新建接续 step（原 step 还挂着）。

## 决策

step 四态 `pending → in_progress → completed | blocked`。

- **blocked**：这步因 X 原因无法完成，必须带 reason（为什么 block）。
- **dgoal_done 放行条件**改为：所有 step 是 completed **或 blocked**。
- **blocked 可回退 in_progress**：外部 blocker 解除后（如权限拿到）重试合理。与 completed 不回退区分（completed 是"真做完"，回退才破坏历史；blocked 是"暂时卡住"）。
- **blocked 不单独触发 paused**：blocked 是 step 级状态，不是 goal 级。goal 级的 3 次停止只针对终审 rejected（见 ADR 0004）。
- **dgoal_check 可审 block reason**：终审/自检时独立审核"这个 block 理由站得住吗"（真外部 blocker 还是 agent 偷懒），把诚实失败变成可审计的。
- **TUI 浮层 blocked 显示 ⚠**，用户一眼看到卡住的 step 及原因。

## 为什么

显式区分 success（completed）和 honest-failure（blocked）两个桶，不混。调研教训正是要显式区分，不能把"做不完但承认了"塞进 completed 污染语义。blocked 带 reason + dgoal_check 可审，让"诚实失败"可审计而非 agent 说了算，呼应 dgoal 范式"独立他证"核心。dgoal_done 放行条件"全完成或全有诚实失败说明"匹配实战"14 fix + 3 ack_stale + 1 abandon = 18 全部终结"的契约思路。

## 权衡

备选是不加 blocked，用接续 step 表达（某步做不下去，标 completed 带说明，新建接续 step）。但把诚实失败伪装成完成，污染 completed 语义，dgoal_check 终审和 TUI 都无法区分"真完成"和"放弃"。blocked 让两者显式分离，代价是 step 状态机从三态变四态 + dgoal_plan 处理 blocked 转换 + dgoal_check 审 block reason，复杂度可控且必要。
