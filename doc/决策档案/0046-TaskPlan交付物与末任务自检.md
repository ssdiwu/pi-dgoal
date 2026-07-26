# ADR 0046：Task Plan 交付物与末任务自检

> Status：部分被 ADR 0047 覆盖；交付物逐项证据与压缩后 Plan 优先仍已实现。

## 背景

Task Plan 的轻量完成守卫此前只要求每个 task 进入 `done` 并带有自由文本 evidence。它不能表达一个 task 必须同步多个命名工件，也不能阻止 evidence 与 task description 相互矛盾；最后一个 task 因而可能以“未改文档”作为“同步文档”任务的证据自动收口。

同时，`session_compact` 会从 `dgoal-plan-v2` 恢复完整 Plan 并在下一轮注入，但压缩摘要仍在模型上下文中。需要明确结构化 Plan 与摘要背景的执行优先级，不能让摘要中的临时说法覆盖持久 task。

## 决策

1. **Task 可选声明交付物。**`deliverables` 是 `{ target, description }[]`：`target` 可是文件、命令结果或外部可观察状态，`description` 说明完成时必须成立的事实。它不是按文件名触发的规则，也不要求普通 task 填写。
2. **声明交付物后，完成必须逐项给证据。**`plan_update(target=task,status=done)` 必须提供与每个 `target` 一一对应的 `deliverableEvidence`；缺少、重复或指向未声明 target 都拒绝 task done。通用 `evidence` 仍保留，用于整个 task 的可复验证据。
3. **Task Plan 显式收口要求同会话结构化自检。**当前 task 全部完成后，主 agent 回读全部 task Description 与显式交付物；只有在 `plan_update(target=goal,status=done)` 提供 `summary` 与 `verification` 后才关闭 Plan。任务耗尽本身不关闭 Plan；新增 task 或替换 Task Plan 均保持可用。
4. **压缩后持久 Plan 优先。**`session_compact` 继续原样恢复 `dgoal-plan-v2` 的结构化 Plan；每轮执行 prompt 明确 `<dgoal_plan>` 是执行与收口权威。摘要和普通对话只能补背景，不能覆盖 task description 或 `deliverables`。冲突时不得标 done：用户改变目标才重建 Task Plan，否则创建 follow-up task。

## 后果

- Task Plan 仍无独立审核、启动确认或额外权限；显式 goal 更新的 `summary` / `verification` 是主 agent 自检，不是 `goal_check`。
- 原有未声明 `deliverables` 的 v2 Plan 保持可读取；新字段均为可选。已声明交付物的持久 Plan 会严格校验其结构及 done task 的逐项证据。
- Task 耗尽从自动收口改为显式决策边界：主 agent 可根据新证据添加 task、替换 Plan 或自检后关闭，换取对未知过程的继续分解能力。
- 不解析 assistant 文本、命令或文件名来推断业务完成；运行时只校验显式结构与对应关系，语义判断仍由主 agent 承担。

## 未选择方案

- **按 `README`、`CHANGELOG` 等关键词硬判定**：文件名不是普适语义，且会把运行时变成不断扩张的词表。
- **为所有 Task Plan 增加独立审核器**：改变轻量路径的保障边界；高保障目标仍应由用户显式选择 Phase/Goal Plan。
- **新增等待审核的 goal/task 状态或第九个工具**：末任务自检可由现有 `plan_update` 的结构化参数承载，不值得扩张状态机和工具面。
- **让压缩摘要改写 Plan**：摘要是临时背景，不是持久执行合同；用户改目标已有 `task_plan` 原子替换入口。

## 覆盖关系

本 ADR 的交付物逐项证据与压缩后 Plan 优先边界继续有效；末任务自动收口与其自检位置由 ADR 0047 覆盖。Description 仍不是独立验收契约，主 agent 不得以矛盾证据跳过它；ADR 0045 的“运行时不解析自由文本语义”边界不变。
