# ADR 0007：contextSummary 与 verification 分字段，但 verification 可默认继承 contextSummary 的验收部分

`contextSummary`（启动背景固化）与 `verification`（全局验收说明）看起来都可能包含验收信息，但职责不同：前者是从前文讨论提炼出的背景纪要，后者是主代理在 `dgoal_propose` 阶段提交的完成契约。决定保持双字段，不合并；同时允许 `verification` 默认继承 `contextSummary` 中的“验收标准”部分，再由主代理显式确认或改写，避免两套信息完全割裂。

继承方式也一并定下：系统只提供候选验收信息给 `LLM`（大语言模型）思考，不做静默自动回填；`verification` 必须仍由主代理在 `dgoal_propose` 中显式提交。这样既复用前文收敛结果，又保住 `verification` 作为“本次计划承诺”的语义。

候选信息的暴露层也定下：把 `contextSummary` 中提炼出的“验收标准”显式放进 `buildProposePrompt()`，作为启动闸门 prompt 的可见输入，让主代理理解、确认或改写；不放进工具参数默认值，更不直接隐式落库。

启动闸门的硬约束也一并定下：`objective`、`contextSummary` 与 `dgoal_propose` 三者合起来，必须能归纳出清晰的验收口（完成结果 / 验收标准）；若仍归纳不出，就直接打回，不进入 `active`。`/dgoal` 不接受“先研究一下”“先看看再说”这类无完成判据的愿望句进入 loop。