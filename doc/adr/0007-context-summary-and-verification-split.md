# ADR 0007：contextSummary 与 verification 分字段，但 verification 可默认继承 contextSummary 的验收部分

`contextSummary`（启动背景固化）与 `verification`（全局验收说明）看起来都可能包含验收信息，但职责不同：前者是从前文讨论提炼出的背景纪要，后者是主代理在 `dgoal_propose` 阶段提交的完成契约。决定保持双字段，不合并；同时允许 `verification` 默认继承 `contextSummary` 中的“验收标准”部分，再由主代理显式确认或改写，避免两套信息完全割裂。

继承方式也一并定下：系统只提供候选验收信息给 `LLM`（大语言模型）思考，不做静默自动回填；若主代理决定把 `verification` 写进 `dgoal_propose`，仍必须由它显式提交，而不是系统隐式代填。这样既复用前文收敛结果，又保住 `verification` 作为“本次计划承诺”的语义。

候选信息的暴露层也定下：把 `contextSummary` 中提炼出的“验收标准”显式放进 `buildProposePrompt()`，作为启动闸门 prompt 的可见输入，让主代理理解、确认或改写；不放进工具参数默认值，更不直接隐式落库。

启动闸门的硬约束也一并定下：`objective`、`contextSummary` 与 `dgoal_propose` 三者合起来，必须能归纳出清晰的验收口（完成结果 / 验收标准）；若仍归纳不出，就直接打回，不进入 `active`。`/dgoal` 不接受“先研究一下”“先看看再说”这类无完成判据的愿望句进入 loop。

字段约束也一并定下：`verification` 不是工具层必填字段。只要 `objective`、`contextSummary` 与提案本身合起来已经能归纳出清晰验收口，启动闸门就可以放行；若主代理额外写出 `verification`，它应当比背景摘要更接近“本次计划承诺”。

确认角色也定下：`verification` 的“显式确认”是 AI 在 `dgoal_propose` 中做的内容确认，不是额外弹一个用户确认步骤；用户仍只在启动闸门对话框里做一次总确认（看 goal / phases / verification 后确认、拒绝或给反馈），不为 verification 单独再确认一次。

因此，启动闸门确认对话框在提案包含 `verification` 时，必须显式展示它，把它作为与 goal、phases 并列的提案组成部分，让用户在唯一一次总确认里看见完整完成契约。

工具层职责也定下：`dgoal_propose` 不因缺失 `verification` 而直接拒绝；真正的硬约束是启动闸门不能放过“整体仍归纳不出验收口”的提案。也就是说，用户的那一次确认面向完整提案，而系统前置校验的重点是是否具备可验证的完成口径，而不是机械要求某个可选字段非空。

若主代理提供了 `verification`，它也不该是“完成并验证”“确保没问题”“达到目标”“验证通过”这类空话；合格的 verification 至少要明确交付物、验证方式中的一个，最好两者兼有。若只是空话，它就不能被当成真正的完成契约，只能回退到 objective / contextSummary 是否足以支撑验收口的判断。
