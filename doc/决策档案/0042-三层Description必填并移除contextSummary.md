# ADR 0042：三层 Description 必填并移除 contextSummary

> Status：已实施。覆盖 ADR 0007；覆盖 ADR 0033 中 `contextSummary` 的字段、持久化、注入与兼容语义，但保留“取消独立背景摘要子进程、由主 LLM 直接建立 Plan”的结论。

## 背景

当前 `objective` / `subject` 只表达“要做什么”。当两个方案能交付相似结果、但方法选择会影响用户真实需求时，用户在执行中很难看出 Agent 为什么采用当前路径，也难以及时识别执行手段已经偏离。

现有 Task / Phase 已有可选 `description`，但它主要出现在 proposal 确认与单项 `plan_read`；持续浮层和 `/dgoal s` 只展示标题。Goal 没有统一的 `description`，Phase/Goal Plan 另有可选 `contextSummary`。后者混合前文背景、范围、风险与验收线索，会把历史讨论和日志重新注入后续上下文；在结构化 objective、nonGoals、guardrails 与 acceptanceCriteria 已存在后，它更多形成噪音，而不是清晰的执行说明。

此前移除的 task 运行态文案只是在复述状态，不能回答“为什么做”和“为什么这样做”。本决策不恢复运行态文案，而是给 goal / phase / task 建立稳定、可见的说明合同。

## 决策

### 1. 三层都使用必填 Description

- `GoalState` 新增必填 `description`；`task_plan`、`phase_plan`、`goal_plan` 都必须提交。
- 所有用户可见的 Phase 与 Task 都必须有非空 `description`；动态 `plan_create` 也必须提交 description，`plan_update` 不允许把它清空。
- Task Plan 的隐藏 Phase 只是内部容器，不生成独立 description；统一数据结构中的内部字段复用 goal description，工具、prompt 与 TUI 均不把它作为 phase 展示。
- `objective` / `subject` 继续作为可扫读的短标题；description 回答：
  1. 为什么这一项存在；
  2. 它对上层目标有什么作用；
  3. 为什么采用当前方法；
  4. 哪些方法偏移需要避免。
- 简单项目可以只写一句，复杂项目可以更长；不得只把 objective / subject 换句话复述，也不写实时进度。

### 2. Description 是权威执行说明，但不是独立完成门

- 主 Agent 的运行上下文必须包含 goal description，以及当前/未来 Phase 与 Task 的 description；done Phase 仍遵循 ADR 0010 的软遗忘边界。
- Description 用于指导执行和帮助用户识别方法偏移。它不单独构成 phase / goal auditor 的通过条件。
- 必须阻止的方法写入 `guardrails`；必须达成的方法性结果写入 `acceptanceCriteria`。Auditor 可读取 description 理解上下文，但不能只凭自由文本 description 新增 FAIL 条件。

### 3. 冻结 Goal，允许 Phase / Task 显式修订

- Phase/Goal Plan 的 goal description 随启动确认冻结，运行中不允许改写。
- Task Plan 再次调用 `task_plan` 时，可随 objective 和全部 tasks 一起原子替换 goal description。
- Phase / Task description 可通过显式 `plan_update` 修订；修订属于 Plan 写操作，递增 revision、使旧审核失效，并在人类可读工具结果中展示新 description，不能无痕改写。

### 4. 直接删除 contextSummary，不做兼容

- 从 GoalState、Plan proposal、三个建 Plan 工具、持久化、prompt 注入、预览和公开文档中删除 `contextSummary`。
- 不做 deprecated 过渡、不迁移旧值，也不把旧内容并入 goal description。
- 持久化 schema 升级后不恢复缺少必填 description 的旧活动 Plan；不根据 objective、subject 或 contextSummary 猜测说明文本。
- 历史 ADR、CHANGELOG 与归档文档保留旧字段记录，不代表当前契约。
- 长程执行需要的事实由 Agent 按需读取代码和权威文档；方法理由写入 description；硬范围与完成约束分别写入 nonGoals、guardrails、verification 和 acceptanceCriteria。

### 5. `/dgoal s` 使用两层 Description 浏览

持续浮层继续只显示 goal heading 与 phase/task 单行主干，不加入 description，避免挤占进度信息。

`/dgoal s` Modal 改为两层：

1. **列表页**：完整展示 goal description，并显示可选择的 Phase / Task 层级列表；Task Plan 不暴露隐藏 Phase。
2. **详情页**：展示所选 Phase 或 Task 的完整 description，以及已有状态、依赖、evidence 或 blocked reason；长文本自动换行并可滚动，返回列表后保留原选择位置。

Phase/Goal proposal 确认继续展示三层 description；Task Plan 建立、`plan_create` 与 description 修订的工具结果以人类可读文本展示对应说明。Description 不进入持续浮层。

## 实施结果

- 持久化键升级为 `dgoal-plan-v2`；`dgoal-plan-v1` 不恢复。v2 load guard 按 Plan 类型严格复验 goal/plan 三层 Description、冻结验收契约、ID/`nextId`、状态、依赖图、check 结构和已删除字段，恢复中的 `pendingProposal` 也重新走完整 proposal 结构校验；任一处脏数据使整条 entry 失效。
- 三个建 Plan 工具、`plan_create` 与 `plan_update` 已落实必填/非空/冻结和显式修订规则；执行 prompt 注入 Description，auditor prompt 明确它不是独立完成门。
- `/dgoal s` 已实现列表选中、详情滚动、返回保位；列表翻页键只滚动物理行而不改变选中，超长 goal description 可完整浏览；持续浮层保持单行主干。
- Task Plan 默认 guidance 已允许 AFK、有界、低风险探索，并要求 Plan/task 生成前做不新增硬门的轻量自检。
- 自动化回归覆盖三层字段校验、v2 隔离、修订留痕、goal 冻结、两层 Modal 导航与 TUI fail-soft 边界。

## 后果

- 用户不必学习 Plan 路由，也能在需要时查看 Agent 为什么采用当前目标、阶段和任务路径。
- Agent 在上下文压缩与续跑后仍拥有明确的方法说明，减少“目标相似但手段偏离”的风险。
- 删除 contextSummary 后，历史背景不会作为自由文本持续污染执行上下文；代价是 Agent 必须重新读取权威工件，不能依赖一段背景纪要。
- 三层 description 必填会增加少量生成与上下文成本；通过允许长度按复杂度变化、禁止同义复述和持续浮层不展示，控制仪式化文本。
- 数据模型和持久态发生破坏性变化；升级后的旧活动 Plan 直接失效。这是明确接受的代价。
- `/dgoal s` 从单页滚动列表变成可选择的两层 Modal，需要新的选择、详情、返回与滚动回归测试；TUI 失败仍不得影响状态、持久化或审核事实。

## 未选择方案

- **复用多行 objective**：会混合短标题、目标与方法说明，浮层和工具无法稳定投影。
- **复用或隐藏 contextSummary**：仍会把历史背景、日志和旧 prompt 注入执行上下文，没有消除噪音根因。
- **description 全部可选**：无法保证 Modal 首层和详情页真的具备解释价值。
- **description 作为独立审核门**：会形成第二套自由文本 acceptance contract，与 ADR 0016 的独立验收边界冲突。
- **三层 description 全部冻结**：会阻断运行中基于证据修正 Phase / Task 的必要适应性。
- **在持续浮层展示全部 description**：会挤掉状态主干并突破行数预算。

## 覆盖关系

- **覆盖 ADR 0007**：不再保留 `contextSummary` / verification 双字段关系；verification 与 acceptanceCriteria 的现行职责仍由 ADR 0016 约束。
- **部分覆盖 ADR 0033**：保留主 LLM 直接建立 Plan、取消独立背景摘要与无摘要 fail-closed 的决策；删除其中所有 `contextSummary` 生产、持久化、注入和旧值兼容语义。
- **扩展 ADR 0008 / 0009**：保留居中 overlay modal 与层级/状态视觉编码，增加列表与详情两层导航。
- **扩展 ADR 0040**：description 的建立与修订必须进入人类可读工具投影，不直出原始 JSON。
