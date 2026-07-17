# ADR 0007：contextSummary 与 verification 分字段，但 verification 可默认继承 contextSummary 的验收部分

> Status：已被 ADR 0042 覆盖；`contextSummary` 从新数据模型直接移除，verification 的现行职责继续由 ADR 0016 规定。

`contextSummary`（启动背景固化）与 `verification`（全局验收说明）看起来都可能包含验收信息，但职责不同：前者是从前文讨论提炼出的背景纪要，后者是主代理在 `dgoal_propose` 阶段提交的完成契约。决定保持双字段，不合并；同时允许 `verification` 默认继承 `contextSummary` 中的“验收标准”部分，再由主代理显式确认或改写，避免两套信息完全割裂。

继承方式也一并定下：系统只提供候选验收信息给 `LLM`（大语言模型）思考，不做静默自动回填；`verification` 必须仍由主代理在 `dgoal_propose` 中显式提交。这样既复用前文收敛结果，又保住 `verification` 作为“本次计划承诺”的语义。

候选信息的暴露层也定下：把 `contextSummary` 中提炼出的“验收标准”显式放进 `buildProposePrompt()`（`buildProposePrompt` 本来就把 `contextSummary` 注入 `<loop_context>`），作为启动闸门 prompt 的可见输入，让主代理理解、确认或改写；不放进工具参数默认值，更不直接隐式落库。

启动闸门的硬约束也一并定下：`objective`、`contextSummary` 与 `dgoal_propose` 三者合起来，必须能归纳出清晰的验收口（完成结果 / 验收标准）；若仍归纳不出，就直接打回，不进入 `active`。`/dgoal` 不接受“先研究一下”“先看看再说”这类无完成判据的愿望句进入 loop。

进一步收紧：只要提案准备进入 `/dgoal` 启动闸门，`verification` 就必须非空。也就是说，“能归纳出验收口但没有显式写进 verification”仍算不合格提案，必须打回要求主代理明确写出完成契约。

确认角色也定下：`verification` 的“显式确认”是 AI 在 `dgoal_propose` 中做的内容确认，不是额外弹一个用户确认步骤；用户仍只在启动闸门对话框里做一次总确认（看 goal / phases / verification 后确认、拒绝或给反馈），不为 verification 单独再确认一次。

因此，启动闸门确认对话框必须显式展示 `verification`，把它作为与 goal、phases 并列的提案组成部分，让用户在唯一一次总确认里看见完整验收说明。

> **ADR 0016 更新**：`verification` 的角色已从“完成契约”调整为“goal 级验收说明”。新 goal 的冻结完成门是结构化 `acceptanceCriteria`（criterion + evidence）；`verification` 帮助 agent 和用户理解完成标准，但不单独作为终审完成门。旧 session 缺少 `acceptanceCriteria` 时，终审兼容沿用 `verification`。`verification` 仍必填（ADR 0007 的硬约束不变），但其权威角色由 ADR 0016 重新定义。

## 实现口径（最小闭环，不做过度设计）

代码层只落实“verification 必填”这一硬约束，不扩机制：

- **`dgoal_propose` schema**：`verification` 从 `Type.Optional` 改为必填 `Type.String`（SDK 层第一道防线）。
- **`validateProposalInput` 纯函数**：校验 `objective` / `verification` / `phaseCount`，trim 后为空就返回 `{ error, message }`；execute 调用它，空 verification 返回 `details.error: "no verification"`，不推给用户确认。
- **`buildProposePrompt`**：明确要求主代理写出 verification，可参考 `<loop_context>` 的“验收标准”，并提示不要写“完成并验证”这类空话。

**明确不做**（避免过度设计）：

- 不做“空话识别”启发式（词表 / 名词动词模式 / 再起一个 LLM 审）。空话靠 prompt 引导 + 终审 auditer 兜底——auditer 本就会拒掉“脚手架 / 空话 / 弱验证”。
- 不把 `contextSummary` 结构化拆成 acceptance / constraints / scope 等子字段；三段文本给主代理看就够。
- 不为 verification 单独新增一轮用户确认；用户只在启动闸门确认一次整体方案。
