# 变更日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) 的基本格式。带 tag 的发布以 Git tag 为版本号；已发布版本由发布负责人负责维护英文 `CHANGELOG.md`，本文件是对应版本的中文镜像。两份日志只记录用户可感知事实，日常用中文记录，准备发布（release）时按版本同步到英文，并都随 npm 包发布。

新发布使用 `## [x.y.z] - YYYY-MM-DD` 格式的标题；条目可唯一对应 GitHub issue 时，在末尾附 `(#xx)`。历史条目保留原有标题格式。

## [Unreleased]

## [0.8.2] - 2026-11-25

### Added
- **同一 session 内的待定计划恢复**（ADR 0052）：冷启动 `session_start(startup|resume)` 会为当前分支恢复完整的待定 proposal，或把已确认但未完成的活动 Plan Contract 原地持久化为 `paused(session_recovery)`。新增 `/dgoal review` 手动查看、反馈、推迟、拒绝或确认保存 proposal；恢复不会自动打开对话框、恢复执行或跨 session / History 搜索，`fork` 的 session 不继承宿主的 Plan / History 副本。

### Changed
- 支持 Pi 1.6.0 扩展消息触发的回合，以及 Anthropic 会话中途新增的工具定义。
- **恢复后不猜测、不重放**：`/dgoal resume` 与恢复的升级 proposal 确认都保持同一 Goal、Plan Run、Work List、revision、checks 与证据；来源是 session 恢复时，第一轮必须核验 `in_progress` 与工作区/外部副作用，不确定时阻塞或询问。
- **取消确认不再丢弃计划**：Esc、空反馈与旧宿主 confirm=false 现在都会推迟并保留待定 proposal；确认 UI 通过 session generation + Goal/Contract/revision/proposal 隔离并发与迟到选择。
- **跨分支与陈旧快照失败关闭**：resume、START 与反馈重提交通过一次性输入标记绑定到原始 session generation；流式期间只排队，在 `agent_settled` 后作为独立 turn 投递，并在精确的用户 `message_end` 有效 abort 边界处提交活动。如果没有开始、prompt 被改写或分支变化，proposal 保持 pending / paused。Pi 在持久化前先推进内存叶子，因此任何 `appendEntry()` 抛错都会硬锁当前 `SessionManager`：不追加补偿子节点或 continuation，扩展重载、tree、compact 都不能解锁；只有在管理器真正重建后，才从磁盘上最后一条完整记录恢复，若 JSONL 尾部不完整或不可读则保持失败关闭。State、History、prior-context 交接与审计工作区推断不再用 `getEntries()` 跨整棵树猜测当前分支；fork 用只含 session ID 的 scope 标记隔离复制的状态。升级 proposal 绑定 Goal/Work List/Contract 基线：推迟后只能 pause/resume 且仍可查看，更新的进度或审计事实会使旧 proposal 失效，绝不回滚当前状态。

### Fixed
- **恢复兼容宿主 system 更新**：START、显式 resume 和 model-error 用户恢复只由精确 user `message_end` 消费恢复门；Pi 先发出的 system 提示/工具更新不再误取消合法恢复，user 空正文或 marker 改写仍拒绝。
- **连续目标的浮层生命周期**：前一 Goal 完成后立即新建 soft Work List 或 Execution Plan，会清除旧完成快照并取消其隐藏定时器，避免新目标仍 active 却被旧快照遮蔽或隐藏。该问题属于相连路径发现的存量缺陷。
- **公共工具路由一致**：`work_list` 与 `execution_plan` 的工具描述及宿主 prompt guidelines 同步明确交付直接 Execution、记录或等待后续输入才用 soft Work List，消除默认 guidance 与工具指导冲突。

- **Anthropic 请求不再触发 dgoal strict union 上限**：仅在 Anthropic Messages 载荷中让九工具退出 strict grammar 编译，保留参数结构和本地校验；OpenAI/Codex 的 strict 偏好不变。 (#2)
- **计划更新保持系统缓存前缀稳定**：实时 Work List、revision、证据与审核反馈改为每次模型请求的消息尾部投影，不写会话历史或累积旧快照；系统提示仅保留固定 guidance。 (#3)
- **交付任务不再被误降级为软清单**：默认 agent 指引现在把修复、实现、验证等不需要进一步用户决策的明确交付工作路由到 `execution_plan`；软 `work_list` 只用于记录或等待后续输入。
- **Work List TUI 状态一致性**：软 Work List 显示“已保存，等待下一轮”，不再递增 timer 或显示无效的 pause/resume 控件；首次直接创建 Work List 或 Execution Plan 会挂载持久 overlay，用户不会只看到工具回执和状态栏。

## [0.8.1] - 2026-08-08

### Breaking
- **单一 Work List 与九个工具**（ADR 0051）：公开的 agent 工具现在是 `work_list` / `execution_plan` / `goal_plan` / `staged_plan` / `work_create` / `work_read` / `work_update` / `phase_check` / `goal_check`。移除 `task_plan`、`phase_plan`、`plan_create`、`plan_read`、`plan_update` 及旧语义别名；原 Goal Plan 的 Phase + Goal 双重审核语义由 `staged_plan` 承载。
- **新持久化状态；不迁移旧活动计划**：当前 Goal / Work List / Plan Contract 写入 `dgoal-work-v1`，当前 session 脱敏的 Plan Run History 写入 `dgoal-plan-history-v1`。`dgoal-plan-v2` 及更早的活动状态既不读取也不迁移；升级后需重新建立当前工作清单。

### Added
- **正交保障档位**：同一 Work List 可保持软清单，或单向升级为 Execution Plan、Goal Check Plan 或 Staged Check Plan；phase 只存在于真实的串行边界，成员耗尽时绝不自动完成。
- **Plan Run History**：已关闭或被取代的 Plan Contract 在当前 session 内归档；状态页可查看和清空历史。归档保留结构化完成证据与审计结论，裁剪审计员的原始报告、反馈、thinking 与 transcript。

### Changed
- **check / update 分工不变**：`phase_check` / `goal_check` 只记录当前 revision 的独立审核结果；Phase 与 Goal 完成状态仍只能由 `work_update` 显式写入。档位、Work List 与 phase revision 都按单调规则使旧审计失效。
- **软清单与持续执行分离**：`work_list` 只做轻量跨轮跟踪，没有 continuation（自动恢复）、no-progress 计数或独立审核；`execution_plan` 增加 Until Done 保障。
- **统一 TUI 与完成投影**：overlay、状态页与工具详情一致显示 Work Items / Phases / Profiles；完成的 phase 在执行上下文中被柔和遗忘为标题，历史不再膨胀主上下文。

### Fixed
- **可靠的收口清理与用户反馈**：软 Work List 在所有工作项完成且真实 phase 显式完成后自动关闭；任何档位收口按 done → null tombstone → continuation / proposal / circuit breaker / audit snapshot / authorization cleanup 顺序进行，并返回结构化 `dgoal completion signal`，不再留下已完成清单或静默结束。
- **跨分支与迟到审计隔离**：`session_tree` / `session_compact` 只恢复 `dgoal-work-v1`，并按 session generation + Goal ID + revision 继续隔离陈旧分支的审计结果与 continuation。
- **Staged 修复循环与 phase 不变量**：Staged Check 只在所有 phase 显式完成后允许新增 goal 级根 Work Item，且后续操作在 compact / 重载后仍保留；非终态 phase 的状态或描述变更会使本地批准失效，done phase 不再允许同状态改写。Goal Check → Staged Check 的 `acceptanceCriteria` / `nonGoals` / `guardrails` 在输入、语义预审结果、待定 proposal 与恢复边界都保持冻结。
- **原子替换、完整回读与损坏状态隔离**：无效的 Execution 替换不再过早归档仍活动的旧 Plan Run；`work_read`、主 agent 上下文与独立检查 prompt 现在完整投影描述、交付物与逐项证据；损坏的 Work List / CheckRecords 或带未知字段的条目在恢复时失败关闭，而不是抛类型错误或恢复伪造的批准。

## [0.8.0] - 2026-07-31

### Changed
- **Pi 0.83 开发基线**：三个 Pi 开发依赖升级到 0.83，根 TypeBox 升级到 1.3.8；公开 peer 范围仍是宿主提供的 `*`，严格 schema 的 nullable 兼容层保留。

### Fixed
- **Task Plan 模型错误恢复**：Task Plan 遇到 `model_error` 熔断后，不再在下一轮被静默丢弃；下一次真实交互/RPC 输入会恢复它一次，保留原任务、证据与 revision。扩展注入、流式跟进、prompt 改写与 Phase/Goal Plan 不会自动唤醒它。
- **严格参数下的 nullable 转换**：nullable 参数现在把 `null` 分支放在 TypeBox union 首位，使 Pi 0.83 校验不会把数字默认值转成 `0`；`phaseId:null` 配合有效 `phaseNumber` 不再被误判为重复参数，也不再触发无效的 `phase_check` 重试循环。

## [0.7.12] - 2026-07-27

### Fixed
- **本地化的任务耗尽通知**：Task、Phase 与 Goal Plan 中当前任务耗尽时，`plan_update(target=task,status=done)` 现在跟随当前 UI 语言，而不是绕过 `i18n` 显示英文通知。
- **本地化的 Plan 工具输出**：`plan_read` 标题、Plan 创建与更新守卫、phase/goal 审核入口及其审计员错误通知现在跟随当前 UI 语言。

## [0.7.11] - 2026-07-27

### Fixed
- **Task Plan 收口占位符兼容**：`plan_update(target=goal,status=done)` 现在把宿主严格 schema 边界改写的空或纯空白 `subject` / `description` 视为缺省；真实非空文本仍被目标冻结守卫拒绝。

## [0.7.10] - 2026-07-26

### Added
- **工具约束采样**：八个公开 Plan 工具（`task_plan` / `phase_plan` / `goal_plan` / `plan_create` / `plan_read` / `plan_update` / `phase_check` / `goal_check`）现在在支持的 provider/模型上请求 JSON Schema 严格模式，使工具参数与 TypeBox schema 完全一致；模型不支持时宿主回退到普通工具调用，跨 provider 行为不变。开发依赖也升级到 Pi 0.82。

### Changed
- **Task DAG 可解释读模型**：对当前未完成 phase，ready、waiting、传递性根阻塞与直接解阻关系都从既有 `blockedBy` 与任务状态推导，并投影到 `plan_read`、`/dgoal s` 与主 agent prompt；不引入新的持久化字段或调度状态。“ready”只声明主 agent 当前可合法执行或委派的任务；不绑定特定执行扩展，也不替代并发冲突判断；主 agent 验证后仍由 `plan_update` 写入 Plan。
- **Task Plan 交付物与安全收口**：任务可按需声明文件、命令结果或可观察外部状态交付物；一旦声明，必须为每项提供结构化证据。所有当前任务完成时 Plan 保持活动；主 agent 回读全部任务描述与交付物，再用 `summary` / `verification` 显式调用 `plan_update(target=goal,status=done)` 收口。`session_compact` 后，持久化的 Plan 原样恢复为执行权威，compaction 摘要不能覆盖任务描述或已声明的交付物。
- **显式 Task Plan 收口**：完成所有当前任务不再自动关闭目标。主 agent 现在收到决策边界提示：可根据新证据添加任务、在目标被重构时替换 Task Plan，或在回读全部任务描述与交付物后用 `summary` / `verification` 显式收口；Task Plan 仍不增加独立审核。
- **三层 Plan 任务耗尽决策边界**：Phase Plan 与 Goal Plan 中当前 phase 的所有任务完成时，主 agent 同样被提示是否根据新证据继续创建任务；只有确认当前 phase 已足够后，才进入 phase done 或 `phase_check` 链。既有独立审核与完成守卫不变。

### Fixed
- **Codex 严格 schema 兼容**：公开工具参数与嵌套对象现在显式禁用 additional properties，并把每个属性列入 `required`；原本可选的字段用 `null` 作占位，执行前恢复为省略，防止支持严格 JSON Schema 的 OpenAI/Codex 模型拒绝 `task_plan` 等调用。
- **严格参数下的 Task Plan 收口**：`plan_update(target=goal,status=done)` 现在把严格工具调用填入的 `subject:null` / `description:null` 视为缺省，避免误触发目标冻结文本守卫而无法显式收口。
- **Task Plan no-progress 恢复**：只有在 `no_progress` 技术熔断时，主 agent 才可在通过完成守卫后原子替换 Task Plan 或显式收口；用户暂停、真实用户阻塞、其他技术暂停与 Phase/Goal Plan 仍锁定。
- **自动恢复的假进度熔断**：no-progress 检测现在区分工具活动与持久进展；连续 3 轮无工具调用，或连续 8 轮只有读取/状态查询等活动但没有成功写文件、独立检查或 Plan 状态/证据/阻塞结构变化，就会暂停。检测只使用结构化工具事件与 Plan 状态差异，不使用 LLM 文本或 `bash` 命令语义；恢复提示要求 agent 直接行动、委派或报告真实的用户决策阻塞，然后才暂停。
- **compact 后的 Task Plan continuation**：`session_compact` 恢复活动 Plan 后，若 Pi 不自行重试当前 turn，continuation 提示会重新投递；防止 overlay 无限计时而主 agent 失去任务耗尽后添加、替换或显式收口的决策。

## [0.7.9] - 2026-07-20

### Changed
- **合并审计状态**：`phase_check` 现在使用所属 phase 的本地 revision；只有同一 phase 中被审计事实的变化才会使其批准失效，所有 Plan 写入仍使 `goal_check` 失效。逐工具审计检查点只在内存中复用，持久化只保留稳定的终态，避免工具事件造成 append-only 的 session 增长。
- **终审与 proposal 提示**：连续三次或以上 `goal_check` 拒绝现在标记修复风险，但保持目标活动；复杂目标会收到拆分成更小部分的非阻塞建议。

## [0.7.8] - 2026-07-20

### Fixed

- **proposal 证据可采性**：启动指引与语义审核现在拒绝依赖未来审计员无法独立获取的证据的冻结验收条件，包括不受支持的历史不可访问声明、未导出的访问日志，以及 agent/worker/user 记忆。此类声明必须删除或收窄为可观察、可独立审计的证据，而不是移入用户复核；拒绝时可在一个响应里返回所有已识别的 criterion 级问题。

## [0.7.7] - 2026-07-17

### Breaking
- **三层 Description 契约与持久化 v2**（ADR 0042）：目标、用户可见 phase 与任务的描述现在必填；Goal Plan 的目标描述在确认时冻结，phase/任务可显式修订。从工具参数、状态、持久化、prompt 与预览中移除 `contextSummary`；持久化 key 升级为 `dgoal-plan-v2`，不迁移 `dgoal-plan-v1` 活动状态。

### Changed
- **Task Plan 探测与轻量自检指引**：普通明确的多步执行，以及 AFK、有界、低风险、带停止条件的探索，可用 Task Plan 承载当前前沿；生成 Plan/任务前只做相关性、必要性、依赖与证据路径的软自检，不新增 phase、硬门禁或假 HITL。
- **两层 `/dgoal s` modal**：列表页显示完整目标描述，可选择 phase/任务；详情页显示完整描述、状态、依赖、证据与阻塞原因。支持逻辑项选择、窗口跟随、Enter 进入、Esc 返回并保留位置，以及详情独立滚动；持久 overlay 仍不显示描述。
- **描述的执行/审计边界**：主 agent 运行时上下文收到目标与当前/未来 phase/任务描述；完成的 phase 仍被柔和遗忘。独立审计员可用它们理解方法，但不得把自由文本描述提升为独立完成门禁。
- **显式 Plan 精简质量检查**：提交 Phase/Goal proposal 前，始终核验端到端结果、适用时的生命周期/真实调用链、失败路径，以及 Plan 与验收契约的一致性；就地修复问题，不新增报告、模型调用、状态或硬门禁；Task Plan 与语义预审职责不变。
- **共享前沿与最新审计投影**：`plan_read` 与 `/dgoal s` 只读解释当前前沿的直接原因与下一个合法动作，结合既有字段的最新 CheckRecord、反馈、任务证据与完成声明；不显示内部历史索引，不新增计数、计时或恢复结构。

### Fixed
- **终审完成声明校验**：`goal_check` 在启动审计前拒绝纯空白的 summary/verification，避免拒绝结果写入不可恢复的终审历史；恢复时顶层拒绝计数也严格校验。
- **v2 恢复边界**：重载 `dgoal-plan-v2` 时按 Plan 类型严格重新校验目标/计划描述、冻结验收契约、ID、状态、依赖图、检查、反馈、终审历史与 `pendingProposal` 结构；脏条目使整条记录失效，不能绕过启动校验或破坏 session 恢复后的只读状态投影。
- **`/dgoal s` 长内容与渲染边界**：列表分页只滚动物理行，很长的目标描述也能完整浏览；审计活性变化会使同秒缓存失效；非正数或极窄终端宽度安全降级。

## [0.7.6] - 2026-07-17

### Changed
- **Task Plan 自动收口与进行中投影**：当最后一个带证据的任务进入 `done`，运行时在同一次 `plan_update(target=task)` 调用中原子关闭目标，而不再依赖模型追加 `plan_update(target=goal,status=done)`；移除冗余的 `activeForm` 字段，持久 overlay 现在在任务标题后显示循环的 `. / .. / ...` 表示正在进行的工作。

## [0.7.5] - 2026-07-16

### Fixed
- **可读的工具结果投影**：八个公开工具默认显示紧凑摘要；展开显示完整文本结果与工具白名单详情投影，进行中的检查带活性文本，但绝不把原始结构化 `details` 直接交给宿主渲染器。
- **Task Plan 用户中断恢复**：中断当前回复不再把 Task Plan 写成 `paused(user_abort)`；它保持活动并清除旧 continuation，下一次用户输入可直接继续，无需 `/dgoal resume`。显式 Phase/Goal Plan 保留用户中断暂停语义。

## [0.7.4] - 2026-07-16

### Changed
- **Task Plan 显示与模型错误熔断**：持久 overlay 默认列出任务；成功的工具进度会重置模型错误计数，前两次连续错误静默，第 3/4 次警告，第 5 次暂停。
- **`plan_read` 可读诊断**：不再返回原始 Plan payload；`target=plan|goal` 聚合整个 Plan 的 phase/任务进度，`target=phase|task` 返回单项。

### Fixed
- **跨 session 分支异步隔离**：旧分支的迟到审计结果、活性更新或 continuation 不再写入或投递到已重同步的新分支。
- **Task Plan 替换与完成 overlay**：创建或替换 Task Plan 会清除旧完成快照，避免短暂显示上一个目标。
- **旧持久化状态兼容**：缺少 `tasks` 的 phase 在加载/重同步时归一化为 `tasks: []`；同一次更新中的 `removeBlockedBy` 与 `addBlockedBy` 针对最终依赖集校验环。
- **独立审计子进程边界**：事件分类与 abort 处理现在复用隔离 runner 的生产实现，避免测试副本漂移。

## [0.7.3] - 2026-07-16

### Breaking
- **三层 Plan 与八工具运行时**（ADR 0038）：公开的 agent 工具现在是 `task_plan` / `phase_plan` / `goal_plan`、`plan_create` / `plan_read` / `plan_update`，以及 `phase_check` / `goal_check`；旧的五个 `dgoal_*` 工具不再注册。新持久化 key 是 `dgoal-plan-v1`，不迁移旧的 `dgoal-state` / `dgoal-goal-vnext` 活动状态。
- **移除策略与隐式启动组合**：移除 `final_only` / `phased`、有界/无界运行时预算、`implicitFinalOnlyStart` / `implicitFinalOnlyBudget`，以及 proposal 的 `implicit` 参数；保障强度现在只由 `planType: task | phase | goal` 表达。
- **状态收敛**：Goal 只保留 `pending | active | paused | done`，phase/任务只保留 `pending | in_progress | done | blocked`。业务拒绝只写入 `CheckRecord`，Goal 保持活动；Goal 的 `rejected`、固定的三次拒绝暂停与 `completed` 兼容状态已移除。

### Added
- **Task Plan 作为日常默认入口**：agent 可为明确的多步执行任务主动创建可替换的 Task Plan；复用现有 reducer、持久化与 overlay，但隐藏内部单一 phase，跳过 proposal、确认与独立审核。
- **可作废的审计记录**：phase/goal 检查持久化带 plan revision 的 `CheckRecord`；被审计事实的任何变化都会使旧批准失效，审计期间 revision 变化时迟到结果被丢弃。

### Changed
- **check 与 update 职责分离**：`phase_check` / `goal_check` 只写审计结果；`plan_update` 是任务/phase/目标状态、完成显示与 agent 发起暂停的唯一写入方。批准不再隐含完成。
- **`/dgoal` 中显式选择 Plan 类型**：`/dgoal` 与显式自然语言启动由 agent 推荐 Phase Plan 或 Goal Plan，确认 UI 只切换 Plan 类型，不切换验收或预算策略。
- **更严格的任务状态守卫**：任务必须 `pending → in_progress → done`，done 需要可验证证据；阻塞任务解除阻塞时清除旧原因，且不得依赖后面 phase 的任务。
- **Phase/Task ID 双命名空间**（ADR 0039）：phase 与 plan 全局任务各自从 ID `1` 连续编号，`nextId` 只分配任务；类型化工具区分同号对象，旧的 `dgoal-plan-v1` Plan 保留原编号且仍可写。

### Fixed
- **持久 overlay 标题不再因宽 CJK 字符换行**：widget 通过 `Component.render(width)` 获取真实终端宽度，优先显示进度与耗时，并按真实显示宽度动态裁剪目标和每行。
- **恢复时投递失败不再伪装为活动**：如果 `/dgoal resume` 的恢复提示发送失败，原始暂停原因会被恢复并持久化，避免出现没有执行 turn 而永远卡住的活动 Plan。

## [0.7.2] - 2026-07-16

### Fixed
- **npm 包安装不再重装 Pi 核心依赖**：把 `@earendil-works/pi-ai` 的运行时 import 从常规依赖改为宿主提供的 peer dependency，并补上缺失的 `@earendil-works/pi-tui` peer 声明；两者仍作为仅本地开发的开发依赖，防止 `pi install` / `/reload` 在共享 npm prefix 中大范围替换 Pi 依赖并触发 npm Arborist 回滚错误。

## [0.7.1] - 2026-07-16

### Added
- **显式自然语言启动**（ADR 0036）：在空闲冷 session 中，真实用户用祈使句明确要求“使用/启动 dgoal”后，`dgoal_propose` 可在结构与语义预审后消费绑定到确切输入/prompt 的一次性内存授权，创建普通待定目标并进入确认 UI；复杂目标可提交 `phased` / `unbounded` 和计划内外部动作，无需用户再次输入 `/dgoal`。能力性问题、引用/代码例子、解释性讨论、仅否定使用 dgoal 的表达、标识符后缀、处理期间的额外输入、`interactive` / `rpc` 之外的来源，以及已有目标，都不能借此静默启动或替换任何东西；Pi 没有不可变的原始输入字段，因此早于 dgoal 的可信变换仍在本扩展的全权限信任边界内。

### Changed
- **proposal 语义改为“轻提案、硬执行”**（ADR 0037）：`dgoal_propose` 的确定性层只校验结构、状态、策略/预算与授权，不再用词表或自由文本关键词做宽泛语义硬拒绝；当前 session 的 LLM 处理独立验收 / `userReviewItems` / 真实人为阻塞分流，高风险识别动作仍在 `tool_call` 执行前失败关闭，终审只检查冻结结果。
- **隐式 proposal 可自动降级为显式确认**：语义预审返回 `requiresExplicitConfirmation` 时，运行时创建普通待定目标并显示既有确认 UI，不自动执行，也不要求用户重新输入 `/dgoal`；结构或语义失败不再留下半启动的目标。
- **隐式 dgoal 允许完整本地执行**（ADR 0035）：带全局授权的隐式目标可运行本地测试、构建、解释器脚本、项目文件修改与本地 Git 改动；已识别的仓库破坏、`.git` 损坏、Git 远端写入、发布部署、外部写入，以及权限或付费命令，在 `tool_call` 执行前失败关闭，必须走显式 `/dgoal`。该护栏是尽力而为的策略检查，不是 OS 沙箱，无法证明已批准脚本没有隐藏副作用。

### Fixed
- **`final_only` 语义预审空 phase 数组不再阻塞启动**：审核器返回有效的 `phaseAcceptanceCriteria: []` 且 approve/rewrite 时，运行时按 proposal 的 phase 数补齐缺失层并保留已有值，不再把批准误判为篡改，也不会以 `rewrittenLayers[layer] is not iterable` 崩溃；多余的 phase 层仍失败关闭。
- **语义预审批准不再回显完整验收契约**：批准计划时，启动门审核器只需返回最小 `{"decision":"approve"}` JSON，运行时继续使用原始冻结的 `acceptanceCriteria`；避免回显长命令与多层条件导致无效 JSON 或无意义重排，同时仍拒绝偷偷修改完成门禁的 approve 响应。
- **终审不再为当前结果创建自指完成门禁**：目标审计员明确在当前 `dgoal_done` 工具结果与 `status=done` 生成之前运行；审计只检查调用前冻结的条件与产物，运行时在 `<APPROVED>` 返回后才收口。`final_only` 计划投影也显示 `progressCompleted`，避免把进度完成误读为仍未完成。
- **自然语言转折祈使不再漏掉授权**：“不是让你跑脚本，而是你要自己用 dgoal 测试”从后半句明确动作授予一次性显式启动权限；反例如“不是用 dgoal，而是讨论/解释它”仍被拒绝。
- **持久 overlay 在激活与重载时可靠恢复**：PlanOverlay 初始化现在依赖真实的 `setWidget` 能力，而不是在不同 Pi 版本可能缺失的 `hasUI` / `mode` 标志；活动目标激活与 session 重同步都确保 widget 已挂载，UI 错误仍不影响状态机。
- **隐式启动执行护栏与 schema 对齐**：动作护栏从 `tool_execution_start + abort` 移到执行前可阻塞的 `tool_call`，现在覆盖嵌套 shell、fd 重定向、cwd 变量删除、Git 别名与 curl 等号参数；`dgoal_propose` schema 允许显式把 wall-clock 宽限设为 `0`，与运行时和默认配置一致。

## [0.7.0] - 2026-07-15

### Added
- **可选验收策略与运行时预算**（ADR 0032）：同一个 dgoal，主 agent 在启动门推荐、用户选择 `final_only` / `phased`，以及有界 / `unbounded` 预算。`final_only` 去掉逐 phase 独立检查但保留最终目标审核，采用“诊断审计 + 窄确认审计”；有界预算首次耗尽时进入一次预授权宽限，仅宽限耗尽才暂停（`pauseReason: budget_exhausted`）；`unbounded` 不因预算或固定计数暂停，但仍保留模型错误、无进展、审计错误与 `agent_blocked` 的安全出口。
- **主模型主导后台上下文固化**（ADR 0033）：移除单独的启动前后台摘要子进程及其失败关闭语义；主 agent 可按需在 `dgoal_propose` 提交 `contextSummary`，缺少背景不阻塞启动。
- **配置授权的隐式轻量启动**（ADR 0034）：默认仍需显式 `/dgoal`；一旦用户在全局 `pi-dgoal.json` 启用 `implicitFinalOnlyStart`，LLM 可为具体、可独立验收的任务自动启动 `final_only + bounded` 目标（基线 `24 turns / 60 minutes / 1 final-review repair`，另有 24 turn 宽限，可用 `implicitFinalOnlyBudget` 覆盖）；项目配置不能授予此权限。

### Fixed
- **运行时预算统计真实 agent 执行 turn**：活动目标中以 `toolUse`、`length` 和正常 `stop` 结束的 turn 都计入 `budgetUsage.turns`，而不只是 `stop`；默认隐式预算调整为 24 turn、60 分钟、1 次终审修复的基线，另有 24 turn 宽限。
- **session compaction 后恢复 dgoal 目标**：监听 `session_compact`，为 `dgoal_plan` / `dgoal_check` / `dgoal_done` 增加持久化目标的惰性恢复；重同步区分陈旧 session 替换与真实读取错误，避免 compaction 或 session 切换后误报“无目标”。
- **收紧隐式启动动作边界**：禁止隐式 shell/test 执行，并统一校验本地路径工具、Git 选项与多链接文件，避免项目外读写和任意脚本副作用。
- **隐式轻量启动 prompt 对齐**：冷启动告知模型全局授权的隐式入口，`dgoal_propose` 的 `implicit` 描述明确说明无需显式 `/dgoal`，但仍限于 `final_only + bounded` 和用户明确要求的安全任务。
- **共享审计预算耗尽后不再伪造 1ms 候选**：第一个审计候选耗尽 phase/goal 的共享总预算时，运行时不再启动下一候选并把剩余时间压缩为 1ms；保留真实总时长超时原因，不用新的瞬时超时误导用户。审计超时文案不再泄漏内部毫秒，改为以秒显示。

## [0.6.4] - 2026-07-14

### Added
- **agent 发起的暂停出口 `dgoal_pause`**：当 agent 因“需要用户决策才能继续”而死锁（例如冻结的验收条件与目标冲突，或缺少只有用户才有的信息/授权），可调用 `dgoal_pause({ reason })` 立即暂停（新 `pauseReason: agent_blocked` 记录 agent 原因），而不必等 3 轮 `no_progress` 回退。此前这类死锁会让 agent 被动地不调用工具，在 continuation 循环中烧 token 直到第 3 轮才暂停。`no_progress` 仍是回退；`dgoal_pause` 后，`/dgoal resume` 清除空闲计数并给 agent 完整重试预算。

### Fixed
- **`dgoal_pause` 原因边界与恢复状态**：拒绝空白或过长 `reason`，暂停后查询与状态标题保留可读的 `pauseReasonDetail`，恢复或切换到其他暂停原因时清除旧详情，避免用户无法恢复或看到陈旧原因。
- **长时间审计工具执行被 180 秒空闲门禁杀死**：子进程真正运行 `bash` 等内置工具时 Pi 会发出 `tool_execution_*`；dgoal 此前不识别这些事件，因此完整测试套件等长命令正常运行却在 180 秒后被误判为 `auditor_error`。模型工作仍用 180 秒空闲超时，工具执行延长到 1800 秒；超时诊断会点名工具，避免把正常验证误报为审计失败。
- **超时审计从零重启**：隔离审计子进程现在为 `tool_execution_start/end` 生成按 phase/goal 与工作区指纹键控的脱敏审计检查点。候选切换或 `/dgoal resume` 会把同一工作区中此前成功完成的确切命令注入新上下文，避免重复重量级验证；运行中、失败或工作区变更的命令不作为完成证据。phase 与目标还有跨候选共享的 900 秒 / 1800 秒轮次预算，防止无休止审计。
- **审计检查点工作区校验**：未跟踪/忽略文件内容变化、不可读文件内容或不完整的 Git 状态都会阻止复用旧工作区指纹（依赖目录除外），避免复用陈旧的审计成功证据。
- **审计检查点事件校验**：只有 start/end 工具名匹配且子进程显式报告 `isError:false` 才记录成功命令；异常、缺失或无效状态不再成为可复用证据。
- **审计命令脱敏**：审计恢复报告额外屏蔽 shell 环境变量、CLI 参数、URL 凭据、cookie/session、HTTP header，以及复合 API key、access token、client secret、凭据、私钥、密码、secret 和 URL query 形式的授权，避免敏感值进入持久化检查点或模型上下文。
- **`dgoal_propose` 缺 phase 错误可操作**：模型省略必填 `phases` 时，预处理现在填充空数组并交给工具层校验，而不是暴露宿主含糊的 `must have required properties phases`；错误现在明确点名缺失的 `phases`，并建议至少一个带 `subject` 与 `acceptanceCriteria`（`criterion` + `evidence`）的 phase，并有回归测试覆盖该路径。

## [0.6.3] - 2026-07-14

### Fixed
- **语义预审从总时长超时改为可观察的空闲超时**：`dgoal_propose` 的启动前语义审核此前用 30 秒总超时，在 provider 排队或流式延迟期间被杀掉，超时、网络错误与技术失败都被伪装成语义拒绝，告诉 agent“把手动体验移入 userReviewItems”，导致它反复改计划。现在默认 60 秒**空闲超时**（只在没有有效流事件时超时，任何事件都会重置），并通过 `onUpdate` 流式输出活性状态（认证中 / 接收审核结果 / 校验审核 JSON）和空闲倒计时。预审终态拆为四种：`approved` / `rewritten` / `rejected`（语义拒绝，`isError:false`，带 criterion 级反馈）/ `technical_error`（认证、超时、网络、非终态、JSON 解析等基础设施失败，`isError:true`，不再让用户改计划）。
- **可配置语义预审空闲超时**：在 `pi-dgoal.json` 新增 `proposalSemanticReviewIdleTimeoutSeconds`（正整数秒，1..3600；无效值回退默认 60 秒并警告）；项目级优先于全局。
- **预审现在使用流式事件**：从 `completeSimple()`（只等最终结果）切到 `streamSimple()`（消费 `AssistantMessageEventStream`）；每个有效事件（text/thinking/toolcall/done/error）重置空闲计时器，不采纳部分 JSON 作为改写建议，只有完整解析并通过 migration-map 校验的最终结果才写入 `pendingProposal`。

### Changed
- **预审技术失败与语义拒绝分离**：技术失败返回 `semantic review technical error` 且 `isError:true`，明确说明“这不是计划内容问题；可稍后重试 /dgoal 或检查模型/网络可用性”；语义拒绝保留 `isError:false` 与 `semantic review rejected` 及可修复原因。旧测试钩子 `__setProposalSemanticCompletionForTest` 保留向后兼容，新增 `__setProposalSemanticStreamForTest` 注入流式事件序列。
- **类型安全的预审配置加载**：`loadDgoalConfig` 的 `isProjectTrusted` 现在可选并带防御性可选链，`DgoalContext` 新增 `isProjectTrusted?`；`dgoal_propose` 调用点去掉 `as unknown as ExtensionContext` 强转与过宽的 `.catch(() => null)`，改为根据 `ctx.cwd` 是否存在加载配置，缺失时回退默认 60 秒且不阻塞预审。清理 `raceWithIdle` 的死参数、透传包装 `emitProposeUpdate`，以及 `SemanticReviewLiveness` 的死 `"done"` 分支（现在在终态前显式设置 `done`）。

## [0.6.2] - 2026-07-13

### Fixed
- **审核结论仲裁**：有效的 `<APPROVED>` / `<REJECTED>` 现在优先于尾部 WebSocket/网络错误，不再被误暂停为 `audit_error`。
- **审核候选切换**：每个候选一次故障转移；健康的回退按目标与审核范围持久化；`audit_error` 恢复重置失败候选状态，phase/目标拒绝循环分层处理。
- **状态查询 overlay 恢复**：`/dgoal s` 现在可在持久 overlay 丢失或首次渲染失败后幂等重绑并重绘 `dgoal-plan`，不修改运行时状态。

## [0.6.1] - 2026-07-13

### Fixed
- **带归属的审核拒绝不再被误读为部分输出**：`<REJECTED goal>`、`<REJECTED phase="N">` 与 `<REJECTED user_review>` 现在与裸 `<REJECTED>` 一样被识别为正式终审结论，不再触发同模型继续审核和候选链回退，然后被误暂停为 `audit_error`。

## [0.6.0] - 2026-07-13

### ⚠️ Breaking Changes
- **新持久化 key 与旧目标不兼容**：vNext 使用 `dgoal-goal-vnext` 自定义条目，旧的 `dgoal-state` 完全忽略。升级后必须重新运行 `/dgoal`；旧目标不迁移、不恢复、不显示（ADR 0026）。

### Changed
- **vNext Goal Runtime**：新增 `dgoal-goal-vnext` 持久化 key；终审拒绝追加到最终修复账本，rejected/paused(audit_failed_3x) 状态显示 Goal Repair 并保留完整计划修复上下文（包括恢复后柔和遗忘暂停）。多 phase 终审三方归属：审核器输出 `<REJECTED phase="N">` / `goal` / `user_review` 分别重开对应 phase、进入 Goal Repair、或记录用户复核而不拒绝。
- **统一单 phase 完成检查**：单 phase 目标只需一次 `dgoal_check` 同时检查 phase 与目标并记录统一审计凭据；`dgoal_done` 复用该凭据，不重复终审（ADR 0018）。
- **启动与可观测性**：为冷启动 / 暂停新增专门的 `/dgoal help`；若所有后台摘要候选失败，启动失败关闭（ADR 0027）；启动门的 `select→confirm→editor` 三层回退保持与旧宿主兼容；审计工具结果显示实际模型，脱敏的审计用量写入 `~/.pi/agent/audit-usage.jsonl` 供 `pi-session-insights` 聚合。
- **源码分层**：入口统一到 `index.ts` 装配根，新增职责模块 `src/plan`、`src/audit`、`src/isolated-pi`、`src/tui`、`src/goal-runtime`（可变 session-state 单例）与 `src/startup`（Pi 注册 + 事件订阅）（ADR 0024/0025）。

### Fixed
- **冒烟 prompt 与 ADR 0017 对齐**：冒烟目标不再强制两个 phase，简单任务允许单 phase，修复真实模型在 proposal 阶段反复重新提交。
- **语义预审空迁移数组**：approve JSON 中空的 `migratedUserReviewItems` 不再触发失败关闭。
- **Goal Repair 恢复的完整上下文**：从 rejected/paused(audit_failed_3x) 恢复到活动后，保留完整计划上下文，同时保留 `finalFeedback`，修复柔和遗忘与修复上下文的冲突。
- **后台失败文案对齐**：所有候选失败时，通知从“降级为无后台启动”改为“启动已中止（未进入目标）”，与失败关闭行为一致（ADR 0027）。

## [0.5.8] - 2026-07-12

### Changed
- **冻结的、不依赖 LLM 可验证的验收契约**：`dgoal_propose` 现在要求目标和每个 phase 都有结构化 `acceptanceCriteria`（criterion + evidence）；缺失或空条件在启动门前被拒绝。通过结构校验与证据形态检查后，当前 session 的 LLM 在写入 `pendingProposal` 前做计划级语义预审；人为条件结合可验证证据会被拒绝或改写到 `userReviewItems`；`rewrite` 必须保留被移除的条件，并有精确的 `sourceCriterion` → `userReviewItem` 映射，缺失或不相关映射失败关闭。预审异常/中断失败关闭。`buildProposePrompt` 第 5 条继续告诉 agent 提交前复核，审核器只备份已冻结的契约。新目标的冻结完成门禁只有 `acceptanceCriteria`；`verification` 降级为目标级验收说明，不再作为独立终审完成门禁。`userReviewItems` 声明 TUI、视觉和真实使用复核项，最终批准后与 agent 补充项和审计员非阻塞建议一起交付，但不成为 phase/目标完成门禁；完成文案明确说明这些项不表示手动体验已验证。被拒绝终审报告中的用户复核建议也会持久化，并在后续批准时合并。复审时，上一轮反馈中超出范围的人工体验完成门禁不再作为完成门禁延续；复核只遵循冻结契约。审计员只审核冻结契约，不在运行时从 AGENTS/README 或手动体验要求扩展完成门禁。见 ADR 0016。
- **失败降级的启动与完成 UI**：启动确认在投递 START prompt 前先持久化活动，状态推进不依赖 status/overlay/notify；`finalizeGoal` 在显示完成 UI 前持久化 done/null 并清除内存目标。PlanOverlay 同步更新、工具执行刷新、tick 与延迟隐藏的 `setWidget` 调用也都失败降级。新增 UI 错误与状态顺序的回归测试。

## [0.5.7] - 2026-07-12

### Fixed
- **暂停状态被误报为无目标**：目标存在但为 `paused` 时，`dgoal_plan` / `dgoal_check` / `dgoal_done` 都返回“没有活动的 /dgoal 目标”，隐藏了暂停状态。现在区分可读（`isGoalReadable`，含 paused，用于只读入口）与可写（`isGoalMutable`，只含 active/rejected，用于写入入口）：暂停时 `list` / `get` / `/dgoal status` 只读可用；`create` / `update` / `check` / `done` 返回结构化暂停结果（带 `pauseReason` + `/dgoal resume` 指引），而不是把“不能修改”与“目标不存在”混为一谈。
- **无进展 continuation 空闲循环**：`agent_end` 对正常的 `stopReason=stop` 无条件发送 continuation，agent 可能连续多轮回答“未完成”同时烧 token。现在在 `before_agent_start` 重置每轮工具调用标记，在 `tool_execution_start` 设置它，连续 3 轮无工具调用自动暂停（`pauseReason=no_progress`）；工具调用或 Plan/目标状态进展重置计数。计数在 startGoal / clearGoal / resyncGoalFromSession / finalizeGoal 清除，不跨目标/session 继承。
- **缺失 `pauseReason` 写入**：`markGoalPaused` 从 `aborted` / `model_error` / `/dgoal pause` 调用时未带 `pauseReason`，日志显示 `pausedReason=None`。现在分别写入 `user_abort` / `model_error` / `user_abort`。
- **新 plan phase ID 不连续**：`proposalToPlan` 此前让任务与 phase 共享全局 `nextId`，新计划的 phase ID 是 `#1/#4/#8/#12`（任务消耗了后面的 phase ID）。现在先为所有 phase 预分配连续的 `1..N`，任务使用全局唯一 ID；旧计划保留原 ID，不迁移。
- **phase 未找到未映射 + phaseId/phaseNumber 歧义**：phase 未找到时此前只返回“phase #N 不存在”，模型无法定位真实 ID。现在返回完整 phase 列表（phase 序号 + 真实 phaseId + 标题，当前 phase 高亮）。`dgoal_check` / `dgoal_plan` 新增 `phaseNumber`（phase 序号）参数作为 `phaseId` 的替代（同时提供会被拒绝）；`phaseId=2` 不再被静默解释为第二个 phase。
- **审计员配额错误未触发候选回退**：provider 业务层配额耗尽（如 `Codex error: The usage limit has been reached`）以纯文本返回，既不是结构化 HTTP 429 也不是网络错误，因此被归类为 `unknown` → `retry_same_model` → 同模型重试三次后暂停而不切换候选。`classifyAuditorFailure` 现在对明确配额文本（usage/plan/rate limit、quota exceeded、insufficient quota）触发 `fallback` 到下一候选；业务 `REJECTED`、HTTP 400 与其他非配额 unknown 错误（如 `context length exceeded`、`billing address invalid`、`credit card declined`、`quota field invalid`）保持原行为。

### Changed
- **审计模型候选链与预检**：新增 `phaseAuditorModels` / `goalAuditorModels`，每个审核范围最多 3 个有序 `provider/model[:thinking]` 候选。项目级链整体优先于全局链，同一来源内复数 > 匹配的单数值 > 旧 `auditorModel`；`null` 显式继承当前 session 模型并阻止进一步回退，旧单值配置不自动重写。解析时逐项对非法/重复/超限条目警告，并在与审计子进程相同的隔离边界下用结构化 Pi `get_available_models` 结果预检（先完整模型 ID，再检测尾部思考档）；成功结果在当前 Pi 进程内缓存，预检失败仍保留候选供运行时使用。见 ADR 0015。
- **审计模型选择模板初始化**：首次真实独立审核时，若没有全局或可信项目级 `pi-dgoal.json`，会原子创建只含两个复数字段且为 `null` 的全局模板；已有文件不覆盖。坏 JSON 或不可读文件只警告并降级，写入失败仍回退当前 session 模型，不中断审核。
- **审计候选链运行时回退与部分输出续审**：审计员的结构化技术失败（HTTP 401/403/404/408/429/5xx、网络错误、零输出超时）或明确纯文本配额耗尽会按顺序切换下一个模型；HTTP 400、用户中断与显式 `<APPROVED>` / `<REJECTED>` 不切换。有部分输出但无终态标记时，同模型最多重试 3 次，并把已有文本作为有界 `<partial_audit_feedback>` 注入（6000 字符上限，XML 转义）；仍无结论则带部分文本进入下一候选。所有候选耗尽后进入 `audit_error` 暂停，绝不静默回退当前执行模型。工具进度 `onUpdate` 与最终 `details` 记录实际使用的模型、配置/预检降级状态、每次尝试的 trace（模型、结果、原因、网络码、进程 exitCode、错误文本）与耗尽标志；trace 不写入 `GoalState`，部分反馈不污染官方 `phaseFeedbackById` / `finalFeedback`。见 ADR 0015。

## [0.5.6] - 2026-07-07

### Fixed
- **`/tree` 导航后 overlay 与目标状态未重同步**：`/tree`（`navigateTree`）就地切换 session 分支，只发出 `session_tree` 而不发 `session_start`，pi-dgoal 此前不监听 `session_tree`，因此 `currentGoal` 停留在旧分支，计划 overlay 显示陈旧状态（明显完成的 phase 仍显示未完成，timer 冻结）。抽取 `resyncGoalFromSession`（取消旧 continuation、清除检查快照/审计追踪 + `loadGoal` + setStatus + overlay 重同步），在 `session_start` 与新的 `session_tree` 处理器间共享，避免两条事件路径分叉；每次成功重同步递增仅内存中的 session generation，使旧分支的迟到审计结果不能写入新分支，已发送但未派发的旧 continuation 被输入处理器丢弃，UI 错误不阻塞状态重同步。`/fork` 走 `session_start reason fork`，由同一同步覆盖。
- **`/dgoal` 启动未暂停当前 LLM 工作**：`startGoal` 此前不中止当前 agent turn（`clearGoal` 有 `ctx.abort`，`startGoal` 没有），因此在 LLM 工作时输入 `/dgoal` 会先等当前 turn 结束才进入 dgoal。`startGoal` 现在在非空闲时调用 `ctx.abort`（遵循 `shouldAbortCurrentTurnOnClear`），并用 `startGoalInProgress` 标志把整个“创建待定目标 → 投递 propose prompt”包在 try/finally 中，抑制被中断 turn 的 `agent_end` 触发 `handleStartupGate` 与 startGoal 自己的 propose 投递冲突（重复发送）。
- **`dgoal_plan` / `dgoal_propose` 兼容把数组参数序列化为字符串的模型**：模型有时把 `blockedBy` / `addBlockedBy` / `removeBlockedBy`（以及 `dgoal_propose` 的 `phases[].tasks[].blockedBy`）序列化为字符串 `"[]"` / `"[1,2]"` 而不是真数组；此前 pi-ai 参数校验（TypeBox `Value.Convert` 把字符串转成类数组结构并逐元素校验）拒绝并报 `blockedBy.0: must be number`，导致创建任务或加依赖失败。新增 `prepareArguments` hook（框架在校验前规范化糟糕模型输入的接缝，在 `validateToolArguments` 之前执行），用 `JSON.parse` 把字符串化数组还原为 `number[]`；schema 仍严格是 `Array<number>`，不放宽 LLM 契约。reducer 入口也保留 `coerceNumberArray` 作为防御性二次清洗。

## [0.5.5] - 2026-07-07

### Fixed
- **审计子进程在 git worktree 场景下看到真实工作目录**：`dgoal_check` / `dgoal_done` 启动的隔离审计子进程此前总是用 session 的 `ctx.cwd`，因此 agent 在单独的 `git worktree`（嵌套 worktree）中编辑文件时，审计看不到改动，迫使 agent 把 diff `git apply` 回主 worktree 才能通过检查。新增审计工作目录推断：先取当前轮成功执行的文件工具调用路径（`edit` / `write`，再回退 `read`），再取持久化 session 历史中最近的文件工具调用，当其 git root 与当前 `ctx.cwd` 的 git root 不同时切到该 worktree 根目录；同一仓库内保持原 `ctx.cwd`，没有文件历史时回退当前目录。追踪器生命周期与目标对齐：在 `startGoal` / `clearActiveGoal` / `finalizeGoal` / `session_start` / `session_shutdown` 重置，防止一个目标的 worktree 路径泄漏到下一个。

## [0.5.4] - 2026-07-06

### Added
- **`dgoal_propose` 计划就绪自检**：启动门确认 UI 现在显示计划级 L0-L3 就绪等级与缺口提示，优先提示 `non-goals` 边界不足。`dgoal_propose` 新增可选 `nonGoals` / `guardrails` / `budget` 字段作为计划级信号；确认后边界持久化到 `GoalState`，并在执行期系统 prompt 注入 `<dgoal_boundaries>` 块。就绪评估是计划提交前的评估，不是运行时自主等级，不引入项目级 `loop-audit` / badge。
- **`dgoal_done` 可验证完成文案**：`dgoal_done` 新增可选 `whatChanged`（变更列表）与 `userReview`（仍需用户验证的项）字段；完成回复信号从含糊的“完成”公告升级为结构化、可验证文本（目标 / 完成摘要 / 验证证据 / 变更内容 / 仍需你验证 / 审计结论）。终审任务输入也包含变更列表，供审计员核验。对应的债务模型：理解债由 agent 的解释偿还，意图债无法由 agent 偿还（`userReview` 提示人工验证）。

### Changed
- **loop 命名清理**：按“目标/loop 不区分；对外用 goal/dgoal”的决定，清理剩余的 `loop` 命名。类型名 `LoopGoal`→`GoalState`、`LoopStatus`→`GoalStatus`、`LoopContext`→`DgoalContext`、`LoopStateEntryData`→`DgoalStateEntryData`；函数名 `isLooping`→`isGoalRunning`、`handleLoopCommand`→`handleDgoalCommand`；prompt 注入标签 `<loop_*>`→`<dgoal_*>`。代码、测试与当前权威文档已同步；归档与决策记录保留原历史名称，不追溯改写。

### Fixed
- **`dgoal_done` 成功路径不再内联完整审计报告**：完成回复信号此前把原始长终审报告拼进给主模型的信号文本，导致最终回复撞上最大输出 token 限制而被截断。现在只保留审计结论，不内联报告文本。

## [0.5.3] - 2026-06-29

### Added
- **独立审核员模型配置**：新增 `~/.pi/agent/pi-dgoal.json` 或项目 `.pi/pi-dgoal.json`，通过 `auditorModel`（格式 `provider/model`）为隔离审计子进程指定单独模型。解析顺序：项目级（仅项目可信时）> 全局 > 当前 session 模型；配置缺失、不可读或无效时回退当前 session 模型，不中断审计。首次没有配置文件时，dgoal 会一次性给出全局路径的 i18n 通知（安装 `pi-di18n` 时文案跟随 locale），之后保持静默；不会自动创建配置文件。该设置只影响审核员模型选择，不改变主执行线程模型。
- **穷尽式审计 prompt**：`PHASE_CHECK_SYSTEM_PROMPT` 与 `AUDITOR_SYSTEM_PROMPT` 加入“一次列全”和“按严重程度列出所有发现”的指令，要求审计员在本轮预算内列出能找到的每个问题（FAIL/BLOCKER 必须列出；warning 列出但不必导致 REJECTED），而不是一遇到阻塞就停，减少零碎来回。
- **复审反馈注入**：有上一轮反馈时，`buildPhaseCheckTask` / `buildAuditorTask` 把持久化的原始 `phaseFeedbackById` / `finalFeedback` 报告注入审计子任务，放在 `<previous_feedback>` 块中；两个 SYSTEM_PROMPT 都加入“复审重点”指令，要求审计员先验证上轮问题确实修复，再检查所有新问题，消除复审盲区。数据结构不变，复用既有反馈持久化。
- **新决策**：新增 `doc/决策档案/0013-auditorModel配置落点选独立文件.md`，记录为何审核员模型配置用 `pi-dgoal.json` 而不是 Pi 的 `settings.json`（不依赖 Pi 对未知字段的未公开容忍）。

## [0.5.2] - 2026-06-27

### Added
- **检查反馈循环增强**：`LoopGoal` 新增 `phaseFeedbackById` / `finalFeedback`，把失败的 phase 检查与终审拒绝的原始报告持久化到 session 状态；系统 prompt 按状态在 `<loop_plan>` 后注入 `<check_feedback>`，使主 agent 在 compact / 恢复 / 拒绝循环后仍能读到完整失败报告。
- **事件流式审计员活性**：`runIsolatedCheck` 现在消费 `thinking_*`、`toolcall_*`、`text_delta`、`message_end` 等事件，每个有效事件重置空闲计时器；活性状态和 `idle Ns/120s` 倒计时通过 `onUpdate` 流式输出，不写入 `LoopGoal`。
- **裸 `/dgoal` 携带 prior context 进入启动**：空参数 `/dgoal` 不再落到状态查询，而是走启动门“路径 B”；命令层只发送 carry-over 信号，主 agent 在 `dgoal_propose` 中总结目标。没有可携带的 prior context 时，建议 `/dgoal <objective>`。
- **TUI 冒烟证据**：记录启动门确认 UI、provider/model 标识、`/dgoal s` 详细查询 modal、展开的持久 overlay，以及裸 `/dgoal` 携带上下文启动的 ANSI 证据（覆盖关键路径 4/8 切片）。由于当前 Pi 0.80.2 内联扩展运行时限制，切片 5/6 的定向 TUI 补充录制未能完成，改由单元/集成测试覆盖。

### Changed
- **检查结果三态化**：`dgoal_check` / 终审现在正式区分 `approved` / `rejected` / `auditor_error`；`rejected` 保持 `isError: false`（正常业务结果），只有 `auditor_error` 是 `isError: true`（审计员异常）。
- **`auditor_error` 三次透明重试**：审计员异常在单次工具调用内最多重试 3 次；任何成功重试收敛为正常检查结果，只有 3 次失败才进入 `paused(audit_error)`。
- **检查门禁锁定与门禁外推进阻断**：phase 检查失败时目标保持 `active`，但只允许修复该 phase；后续 phase 的 `dgoal_check` 和更早 phase 未通过时的 `dgoal_done` 被硬拒绝。
- **更严格的用户可见边界**：aboveEditor overlay、`/dgoal s` 详细查询 modal 与底部状态栏继续只显示状态和计划结构，不显示检查报告正文。
- **持久 overlay 展开状态收窄**：`Ctrl+O` 展开持久 overlay 只展开 `pending / in_progress` 的 phase；`done phase` 只显示标题行，不再展开任务，而 `/dgoal s` 详细查询 modal 保留完整 phase/任务详情。
- **中英术语统一**：统一“实时 overlay”“展开的实时 overlay”“详细查询 modal”的中文 UI 标签，英文文案对齐同一术语。

## [0.5.1] - 2026-06-23

### Added
- **AI 驱动冒烟（`npm run test:smoke`）**：新增 `test/test-ai-smoke.py`，在隔离环境（临时工作目录，只加载本扩展）用 `pi -ne -e ./index.ts -ns -np --mode rpc --no-session` 以真实模型运行完整多 phase dgoal 工具链（`dgoal_propose → dgoal_plan → dgoal_check → dgoal_done`），自动回答启动门 `select`（选择 `confirmStart`），并跟踪每个 `dgoal_*` 调用的 `isError`、文件产物与退出信号。填补离线 RPC 测试（仅加载/命令注册）与人工 TUI 冒烟之间的验证空白。⚠️ 消耗真实 token，需要网络与已配置的 provider；不属于 CI。

### Changed
- **`/dgoal s` modal 长文本换行**：标题、phase 主题与任务主题超过 modal 宽度时换行而不是用 `...` 截断，续行与内容列对齐，滚动按物理换行行数计算。
- **Plan 注入柔和遗忘（ADR 0010）**：`buildPlanContextBlock` 现在只为通过检查的 done phase 注入标题行，省略其任务的主题/证据。类比 R-SWA（参考滑动窗口注意力）：目标 + 上下文全局可见（参考层），当前 phase + 任务聚焦（工作记忆），done phase 的任务细节被柔和遗忘以聚焦当前进展。不改变 `goal.plan` 持久化（完整保存），不改变审计子进程可见性（读取完整持久化状态），不新增查找工具（依赖 done phase 标题行与检查报告两条自然路径）；柔和遗忘发生在 phase 整体 done 时，当前 phase 内已完成的任务仍被注入。

## [0.5.0] - 2026-06-22

### Changed
- **`/dgoal s` modal 锚点从顶部居中改为居中**（ADR 0008 附加决定）：真实使用中顶部居中视觉上“挂”在上方，不够聚焦；`/dgoal s` 是用户主动打开、阅读、关闭的查询弹窗，只短暂覆盖聊天记录，当初拒绝居中的理由较弱；`maxHeight` 85% + 滚动已解决内容可见性问题。overlay 配置现为 `anchor: "center"`，启用原本的备选方案 C。
- **TUI 视觉编码重构：颜色表层级，字符表状态**（ADR 0009）：`/dgoal s` modal 不再按状态给整行上色，而是按内容层级分配基础色——`goal = accent + bold`、`phase = text`、`task = dim`；`phase`/`task` 现在共用一组状态字符 `○ / ◐ / ✓ / ⚠`（移除 modal 的双重 `PHASE_EMOJI`/`TASK_EMOJI` 轨道，与持久 overlay 的 `PHASE_ICON` 对齐），而 `goal` 保留 `🎯`。`in_progress` 不再加粗；状态只由字符传达。颜色选择假设跨主题可见，排除在白底上容易丢失的 `yellow` 等色相。

### Added
- **`done` 删除线扩展到 phase**：modal 与持久 overlay 中 done 的 `phase`/`task` 标题文本现在带删除线（ANSI 9/29），只作用于标题文本，不作用于状态字符 `○/◐/✓/⚠` 或树形符号 `├─ / │`；行内后缀注释（`activeForm`、`blockedReason`）作为辅助信息弱化，不参与删除线。
- **新术语与决策**：在 `doc/术语表.md` 加入“层级基础色”和“状态字符”；新增 `doc/决策档案/0009-tui-visual-encoding-layer-over-status.md`（覆盖 ADR 0008 的 emoji + 状态色方案）。

### Fixed
- **状态栏 `zh-CN` 真正本地化**：`🔁 active #N / paused / starting / rejected / done` 等状态栏文案此前在中文 locale 下保留英文状态词；现在本地化为五个两字中文状态标签。
- **`/dgoal s` 空状态一致性**：没有活动目标时，TUI 模式也显示居中 modal 空状态；非 TUI 仍降级为 notify，用户可见文案统一用 dgoal 而不是 loop，并恢复 `ESC/Ctrl+C` 关闭提示。
- **`/dgoal s` 快捷键提示动态化**：计划内容不超过 modal 可见高度时只提示 `ESC/Ctrl+C`；`j/k`、方向键与翻页键只在内容可滚动时出现。

### Reminders
- **持久 overlay 着色推迟**：本轮只统一 modal 视觉编码；持久 overlay（`aboveEditor widget`）的主题感知着色推迟到下一版本（见 `doc/30-路线图/30-项目路线图.md`），避免开启新的 TUI 渲染 bug 面。

## [0.4.2] - 2026-06-20

### Added
- **`/dgoal s` 顶部居中 overlay modal**：`showStatus()` 在 TUI 模式优先使用可滚动的顶部居中 overlay modal（`ctx.ui.custom()`），显示完整目标 / phase / 任务状态；标题固定，支持 `j/k`、方向键、`PgDn/PgUp`、`End/G`、`Home/g` 与 `ESC`。
- **纯状态渲染函数与组件测试**：新增 `RenderLine`、`buildBodyLines*`、`buildHeadingLine`、`colorize`、`computeScrollOffset` 与 `PlanStatusDialog`，并在 `plan-status-pure.test.ts`、`plan-status-dialog.test.ts`、`show-status.test.ts` 中覆盖回归。

### Changed
- **`/dgoal s` 查询形态升级**：从 5 行 `notify` 升级为顶部居中 overlay modal（方案 A，见 `doc/决策档案/0008-dgoal-s-modal-形态选型.md`）；无 TUI / `ctx.ui.custom()` 时回退旧 notify，保持 RPC / print / json 兼容。
- **用户中断暂停通知颜色**：“Dgoal paused (user interrupt…)”通知从 `warning`（黄）改为 `error`（红），在深色主题中更醒目。

### Fixed
- **耗时不再吞掉暂停区间**：目标暂停后记录 `pauseStartedAt`，恢复时累加到 `pausedTotalMs`；overlay/modal/标题中的 `⏱️ elapsed` 现在排除暂停窗口，不再把 `/dgoal pause` 到 `/dgoal resume` 的时间计入总时长。
- **modal 标题走 i18n**：`/dgoal s` 弹窗标题不再硬编码英文，跟随 `pi-di18n` locale 或本地回退。
- **文档状态契约统一为 `done`**：README 与权威数据模型文档不再把旧的 `completed` 作为当前任务/phase 状态暴露。

### Removed
- **删除一次性原型**：移除 `prototype/dgoal-status-modal.prototype.ts` 与 `prototype/dgoal-status-modal.preview.ts`。

### Reminder
- **升级后运行 `/reload`**：此版本新增 overlay modal，使用前请在 Pi 中 `/reload` 本扩展以启用新的 `/dgoal s` 形态。

## [0.4.1] - 2026-06-19

### Fixed
- **目标收容忍受 TUI 渲染错误**：`dgoal_done` 成功后，`finalizeGoal` 对宿主 TUI 的调用（完成 overlay、清状态栏）现在包在 try/catch 中，因此 `Spacer is not defined` 等 TUI 渲染错误不再阻塞清除目标状态——即使 UI 显示失败，目标仍正确落到 `done` 并被清除，避免目标卡住无法关闭。

## [0.4.0] - 2026-06-19

### Added
- **单字母 `/dgoal` 命令**：用户可用 `/dgoal s`、`/dgoal p`、`/dgoal r`、`/dgoal c` 分别查询状态、暂停、恢复与清除

### Changed
- **命令提示文案**：Ctrl+O overlay、状态输出与中英文档现在显示完整拼写 + 单字母快捷键形式，英文帮助使用 `[s]tatus` / `[p]ause` / `[r]esume` / `[c]lear`

### Removed
- **移除 `/dgoal stop` 别名**：`stop` 不再映射到 `clear`；请使用 `/dgoal clear` 或 `/dgoal c`

### Fixed
- **TUI timer 图标渲染**：overlay 标题栏的计时器改用显式 emoji 形式 `⏱️`（带变体选择符），避免部分终端渲染成黑白字形并套用文本字符样式

## [0.3.0] - 2026-06-18

### Fixed
- **任务 ID 编号**：`proposalToPlan()` 现在 phase 与任务各自从 1 开始编号（此前共用计数器，phase 占 ID=1，任务从 2 开始）
- **blockedBy 映射**：proposal 中基于 1 的 phase 内 `blockedBy` 索引现在正确映射到全局任务 ID（此前直接透传，导致引用错位）
- **顺序执行 phase**：系统 prompt 增加硬 phase 顺序约束，`dgoal_plan` 工具增加 `enforcePhaseOrder()` 守卫，阻断跨 phase 操作
- **TUI 目标完成 overlay 不消失**：`finalizeGoal()` 现在调用 `planOverlay.dispose()` 清除 overlay
- **TUI 最后 phase 不显示完成**：done 状态不再隐藏完成的 phase；显示完整最终结果（全部 ✓ + N/N）
- **审计子进程空闲超时误判**：`dgoal_check` / 审计子进程现在在任何 `stdout` chunk 时刷新 watchdog，而不是等完整的一行 JSON，防止半行流式输出被杀
- **审计子进程清理不完整**：超时/中断时优先终止 detached 进程组，避免孙进程继承管道导致 `close` 长时间挂起

### Changed
- **PlanStatus 终态统一为 `done`**：任务/phase 终态从 `completed` 改为 `done`（与目标级 `LoopStatus.done` 一致），覆盖类型定义、TUI 图标、系统 prompt、工具描述与错误信息
- **启动门默认显示摘要**：确认 UI 默认显示目标 / verification / phase 与任务数量，任务详情按需展开，避免初始对话被细粒度任务淹没
- **`verification` 必填**：`dgoal_propose` 的 `verification` 从可选改为必填（工具 schema + `validateProposalInput` 工具层校验）；没有可验证完成门禁的目标在工具层被拒绝，不进入启动门确认；空话由 prompt 指引加终审兜底处理（ADR 0007）

### Added
- **TUI timer**：overlay 标题栏显示耗时（例如 `⏱️ 2m 34s`）
- **TUI done 后延迟消失**：目标完成后 overlay 保留终态 10 秒再自动隐藏（应对 agent 在当前 phase 未完成时启动后续 phase 任务的情况）
- **子进程监管回归测试**：新增 `subprocess-supervision.test.ts`，复现父进程退出但孙进程继承管道时的清理

## [0.2.0] - 2025-06

### Added
- **三层 Task Plan 内容**：目标（冻结）→ phase（阶段目标）→ task（按需拆解的细粒度执行单元），`dgoal_plan` 支持 CRUD
- **检查循环**：完成 phase 的唯一方式是 `dgoal_check`（由隔离的只读子进程验证），无法绕过
- **启动门**：`dgoal_propose` 提交计划 → 用户确认 UI（确认/拒绝/反馈）→ 激活 loop
- **终审审计**：`dgoal_done` 触发隔离的只读子进程审计，连续 3 次失败自动暂停
- **计划 overlay**：TUI aboveEditor widget 显示计划状态（默认可见 phase，任务可展开）
- **启动后台上下文固化**：`/dgoal` 启动前从先前讨论中提取结构化背景（目标范围 / 关键约束 / 验收标准），并注入后续每一轮的系统 prompt

### Changed
- 从 `pi-dloop` 改名为 `pi-dgoal`
- README 改为英文门面式入口，中文文档移入 `README-zh.md`
- 建立完整设计文档体系（`doc/10-架构与运行/`、ADR 0001–0006）

### Fixed
- 完成后正确交回模型回复用户（不再自行继续）
- 清理残留的 dloop 引用

## [0.1.1] - 2025-05

### Added
- 启动前自动固化 prior context（summarizeContext 子进程）
- 模型错误自动重试（上限 3 次）
- 审计报告清理（去噪）

### Fixed
- 背景固化输入改用总大小上限（此前按消息数截断可能超限）
- 避免在用户消息里完全展开 loop 上下文（改为预览 + 系统 prompt 注入双轨）
- 防止 Dloop 背景固化产生误导（明确标注为参考证据而非新指令）
- 审计时清除遗留通知，并在审计成功时新增通知

## [0.1.0] - 2025-05

### Added
- 初始版本：轻量目标循环扩展（`/dloop` 命令）
- 独立完成审计（进程内 session 版本，后重构为子进程）
- 审计员切换到官方 CLI 子进程方式，严格只读
- 提示统一为中文
