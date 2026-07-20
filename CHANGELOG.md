# Changelog

All notable changes to `pi-dgoal` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.7.9] - 2026-07-20

### Changed

- **审核状态收敛**：`phase_check` 改用所属 phase 的局部 revision；同 phase 的受审事实变更才使其批准失效，所有 Plan 写操作仍会使 `goal_check` 失效。审核逐工具 checkpoint 仅在内存中复用，持久化只保留稳定终态，避免 append-only session 随工具事件膨胀。
- **终审与提案提示**：连续三次及以上 `goal_check` 拒绝会提示修复风险但保持 active；复杂目标可收到不阻塞的拆分建议。

## [0.7.8] - 2026-07-20

### Fixed

- **Proposal evidence admissibility**: startup guidance and semantic review now reject frozen acceptance conditions that depend on evidence a future auditor cannot independently obtain, including unsupported historical non-access claims, unexported access logs, and agent/worker/user memory. Such claims must be removed or narrowed to observable, independently auditable evidence rather than being moved to user review; rejection can return all identified criterion-level issues in one response.

## [0.7.7] - 2026-07-17

### Breaking

- **三层 Description 合同与持久化 v2**（ADR 0042）：goal、用户可见 phase 与 task 的 Description 改为必填；Phase/Goal Plan 的 goal description 随确认冻结，phase/task 可显式修订。删除 `contextSummary` 的工具参数、状态、持久化、prompt 与预览链路；持久化键升级为 `dgoal-plan-v2`，不迁移 `dgoal-plan-v1` 活动状态。

### Changed

- **Task Plan 探路与轻自检 guidance**：普通明确多步执行，以及 AFK、有界、低风险且有停止条件的探索，可用 Task Plan 承载当前 frontier；Plan/task 生成前只做相关性、必要性、依赖和证据路径的软自检，不增加阶段、硬门或伪装 HITL。
- **`/dgoal s` 两层 Modal**：列表页展示完整 goal description 与可选择的 phase/task；详情页展示完整 description、状态、依赖、evidence 与 blocked reason。支持逻辑项选择、窗口跟随、Enter 进入、Esc 返回保位与详情独立滚动；持续浮层仍不显示 Description。
- **Description 执行/审核边界**：主 agent 的运行上下文注入 goal 与当前/未来 phase/task Description；done phase 继续软遗忘。独立审核器可据此理解执行方法，但不能把自由文本 Description 升级为独立完成门。
- **显式 Plan 精简质量检查**：Phase/Goal proposal 提交前固定核对端到端结果、适用时的生命周期/真实调用链、失败路径及 Plan 与验收契约一致性；问题直接修正，不新增报告、模型调用、状态或 hard gate，Task Plan 与语义预审职责不变。
- **共享 frontier 与最新审核投影**：`plan_read` 和 `/dgoal s` 只读解释当前 frontier 的直接原因与下一合法动作，并组合现有字段中最新的 CheckRecord、反馈、task evidence 与完成声明；不展示内部历史索引，也不新增计数、耗时或恢复结构。

### Fixed

- **终审完成声明校验**：`goal_check` 在启动审核前拒绝仅含空白的 summary/verification，避免拒绝结果写出无法恢复的终审历史；恢复时同时严格校验顶层拒绝次数。
- **v2 恢复边界**：`dgoal-plan-v2` 重载时按 Plan 类型严格复验 goal/plan 的 Description、冻结验收契约、ID、状态、依赖图、check、feedback、终审历史与 `pendingProposal` 结构；脏 entry 整体失效，不能在 session 恢复后越过启动校验或破坏只读状态投影。
- **`/dgoal s` 长内容与渲染边界**：列表翻页只滚动物理行，超长 goal description 可完整浏览；审核活性变化会使同秒缓存失效，非正或极窄终端宽度安全降级。

## [0.7.6] - 2026-07-17

### Changed

- **Task Plan 自动收口与进行中投影**：最后一个带 evidence 的 task 进入 `done` 时，运行时在同一次 `plan_update(target=task)` 中原子关闭 goal，不再依赖模型追加 `plan_update(target=goal,status=done)`；移除冗余的 `activeForm` 字段，持续显示浮层改用任务标题后的循环 `. / .. / ...` 表示进行中。

## [0.7.5] - 2026-07-16

### Fixed

- **工具结果人类可读投影**：八个公开工具默认显示紧凑摘要；展开时显示完整文字结果与工具白名单化的详情投影，进行中的建检也显示活性文本，但不将原始结构化 `details` 直接交给宿主渲染。
- **Task Plan 用户中断恢复**：中断当前响应不再把 Task Plan 写成 `paused(user_abort)`；它保留 active 状态并清理旧 continuation，下一条用户输入可直接继续，无需 `/dgoal resume`。显式 Phase/Goal Plan 仍保留用户中断后的暂停语义。

## [0.7.4] - 2026-07-16

### Changed

- **Task Plan 展示与模型错误熔断**：常驻浮层默认列 task；成功工具推进会重置模型错误计数，前两次连续错误静默、第 3/4 次告警、第 5 次暂停。
- **`plan_read` 人类可读诊断**：不再返回原始 Plan payload；`target=plan|goal` 聚合整个 Plan 的 phase/task 进度，`target=phase|task` 返回单项。

### Fixed

- **跨 session 分支异步隔离**：旧分支迟到的审核结果、活性更新或 continuation 不再写入/投递到重同步后的新分支。
- **Task Plan 替换与完成浮层**：创建或替换 Task Plan 时清除旧完成快照，不再短暂显示上一目标。
- **旧持久态兼容**：缺少 `tasks` 的 phase 在 load/resync 时规范化为 `tasks: []`；`removeBlockedBy` 与 `addBlockedBy` 同次更新按最终依赖集验环。
- **独立审核子进程边界**：事件分类与 abort 处理改为复用 isolated runner 的生产实现，避免测试副本漂移。

## [0.7.3] - 2026-07-16

### Breaking

- **三档 Plan 与八工具运行时**（ADR 0038）：公共 agent 工具改为 `task_plan` / `phase_plan` / `goal_plan`、`plan_create` / `plan_read` / `plan_update`、`phase_check` / `goal_check`；旧五个 `dgoal_*` 工具不再注册。新持久化键为 `dgoal-plan-v1`，旧 `dgoal-state` / `dgoal-goal-vnext` 活动状态不迁移。
- **删除策略与隐式启动组合**：移除 `final_only` / `phased`、bounded / unbounded runtime budget、`implicitFinalOnlyStart` / `implicitFinalOnlyBudget` 与 proposal `implicit` 参数。保障强度统一由 `planType: task | phase | goal` 表达。
- **状态收敛**：Goal 只保留 `pending | active | paused | done`，phase/task 只保留 `pending | in_progress | done | blocked`。业务 rejection 仅写入 `CheckRecord` 并保持 Goal active，不再进入 Goal `rejected`、固定三次拒绝暂停或 `completed` 兼容状态。

### Added

- **Task Plan 日常默认入口**：agent 可为明确多步执行任务主动建立可替换的 Task Plan；复用现有 reducer、持久化和浮层，但隐藏内部单 phase，不经过 proposal、确认或独立审核。
- **可失效的审核记录**：phase/goal check 持久化带 plan revision 的 `CheckRecord`；任一受审事实变化都会使旧 approval 失效，审核运行期间 revision 变化时丢弃迟到结果。

### Changed

- **check 与 update 职责分离**：`phase_check` / `goal_check` 只写审核结果；`plan_update` 是 task / phase / goal 状态、完成显示与 agent 主动暂停的唯一写入口。approved 不再隐式等于 done。
- **显式 dgoal 选择 Plan 类型**：`/dgoal` 与自然语言显式启动由 agent 推荐 Phase Plan 或 Goal Plan，确认 UI 只切换 Plan 类型，不再切换验收或预算策略。
- **任务状态守卫收紧**：task 必须按 `pending → in_progress → done` 推进，done 必须带可复验 evidence；blocked 解除后清理旧原因，且禁止依赖后续 phase 的 task。
- **Phase/Task ID 双命名空间**（ADR 0039）：phase 与 plan-global task 各自从 ID `1` 连续编号，`nextId` 只分配 task；类型化工具区分同号对象，旧 `dgoal-plan-v1` 保留原编号并继续可写。

### Fixed

- **持续浮层标题不再因中文宽字符换行**：widget 通过 `Component.render(width)` 获取当前终端宽度，优先保留进度与耗时，并按真实显示宽度动态裁切 objective 与各行内容。
- **恢复投递失败不再假 active**：`/dgoal resume` 的恢复 prompt 发送失败时恢复原 paused 原因并持久化，避免没有执行 turn 的 active Plan 永久停滞。

## [0.7.2] - 2026-07-16

### Fixed

- **npm 包安装不再重装 Pi 核心依赖**：将运行时导入的 `@earendil-works/pi-ai` 从普通 dependency 改为宿主提供的 peer dependency，并补齐 `@earendil-works/pi-tui` 的 peer 声明；两者仅在本地开发时保留 dev dependency，避免 `pi install` / `/reload` 在共享 npm 前缀中大范围替换 Pi 依赖并触发 npm Arborist 回滚异常。

## [0.7.1] - 2026-07-16

### Added

- **自然语言显式启动**（ADR 0036）：真实用户在空闲冷会话用祈使句明确要求“使用/启动 dgoal”后，`dgoal_propose` 可在结构与语义预审成功后消费精确绑定 input/prompt 的一次性内存授权，建立普通 pending goal 并进入确认 UI；复杂目标可提交 `phased` / `unbounded` 及计划内外部动作，不再要求重复输入 `/dgoal`。能力问句、引用/代码示例、解释讨论、仅否定使用 dgoal 的表达、标识符后缀、处理中追加输入、`interactive` / `rpc` 之外的来源和已有 goal 均不会借此静默启动或替换；Pi 无不可变输入原文字段，早于 dgoal 的受信任 transform 仍属于扩展全权限信任边界。

### Changed

- **提案语义职责改为“轻提案、硬执行”**（ADR 0037）：`dgoal_propose` 的确定性层只校验结构、状态、策略/预算和授权，不再用 evidence 词表或自由文本关键词作泛化语义硬拒；当前会话 LLM 负责独立验收 / `userReviewItems` / 真实人工 blocker 分流，已识别的高风险动作继续由 `tool_call` 执行前 fail-closed，终审只核冻结结果。
- **隐式 proposal 可自动降级显式确认**：语义预审返回 `requiresExplicitConfirmation` 时，运行时建立普通 pending goal 并弹现有确认 UI，不自动执行、也不要求用户重输 `/dgoal`；结构或语义失败不再留下半启动 goal。
- **隐式 dgoal 允许完整本地执行**（ADR 0035）：全局授权后的隐式目标可运行本地测试、构建、解释器脚本、项目文件修改和本地 Git 变更；已识别的仓库销毁、`.git` 破坏、Git 远端写入、发布部署、外部写入、权限与付费命令会在 `tool_call` 执行前 fail-closed，须改走显式 `/dgoal`。该护栏是 best-effort 策略检查而非 OS sandbox，不能证明获准脚本内部没有隐藏副作用。

### Fixed

- **`final_only` 语义预审空 phase 数组不再阻断启动**：审核器在 approve/rewrite 返回合法的 `phaseAcceptanceCriteria: []` 时，运行时按 proposal phase 数补齐缺失层并保留原值，不再误判 approve 偷改，也不再因 `rewrittenLayers[layer] is not iterable` 崩溃；额外 phase 层仍 fail-closed 拒绝。
- **语义预审 approve 不再回显完整验收契约**：启动闸门审核器批准计划时只需返回最小 `{"decision":"approve"}` JSON，运行时继续使用原冻结 `acceptanceCriteria`；避免长命令与多层 criteria 回显导致无效 JSON 或无意义格式改写，同时仍拒绝 approve 响应偷偷修改完成门。
- **终审不再建立当前结果的自指完成门**：goal auditor 明确在当前 `dgoal_done` tool result 与 `status=done` 生成前运行；审核只核调用前冻结条件和工件，返回 `<APPROVED>` 后才由 runtime finalize。`final_only` 计划投影同时展示 `progressCompleted`，避免把进度已完成误读为仍未完成。
- **自然语言转折祈使不再漏授权**：“不是要你跑脚本，而是需要你自己用 dgoal 测试”会按后半句明确动作授予一次性显式启动权；“不是要用 dgoal，而是讨论/解释它”等反例仍拒绝。
- **持续显示浮层在激活与重载时可靠恢复**：PlanOverlay 初始化改以真实 `setWidget` 能力为准，不再依赖不同 Pi 版本可能缺失的 `hasUI` / `mode` 标记；active goal 激活与 session 重同步都会确保 widget 已挂载，UI 抛错仍不影响状态机。
- **隐式启动执行护栏与 schema 对齐**：动作护栏从 `tool_execution_start + abort` 移到真正执行前可 block 的 `tool_call`，并覆盖嵌套 shell、fd 重定向、cwd 变量删除、Git alias 与 curl 等号参数；`dgoal_propose` schema 允许墙钟宽限显式设为 `0`，与运行时和默认配置一致。

## [0.7.0] - 2026-07-15

### Added

- **可选验收策略与运行预算**（ADR 0032）：同一 dgoal 在启动闸门由主 agent 推荐、用户选择 `final_only` / `phased` 与有界 / `unbounded` 预算。`final_only` 取消逐 phase 独立建检但保留 goal 终审，并采用“诊断审 + 窄确认审”；有界预算首次耗尽进入一次预授权宽限，宽限耗尽才暂停（`pauseReason: budget_exhausted`）；`unbounded` 不因预算或固定次数拒绝暂停，但仍保留模型错误、无进展、审核错误与 `agent_blocked` 安全出口。
- **主模型主导背景固化**（ADR 0033）：移除启动前独立背景摘要子进程与其 fail-closed 语义；主 agent 可在 `dgoal_propose` 中按需提交 `contextSummary`，背景缺失不阻塞启动。
- **配置授权隐式轻量启动**（ADR 0034）：默认仍须显式 `/dgoal`；用户在全局 `pi-dgoal.json` 开启 `implicitFinalOnlyStart` 后，LLM 可对范围具体、可独立验收的任务自动启动 `final_only + bounded` goal（默认基础 `24 turns / 60 分钟 / 1 次终审修复`，turn 宽限再给 24，可由 `implicitFinalOnlyBudget` 覆盖），项目配置不能授予此权限。

### Fixed

- **运行预算按真实 agent 执行回合计数**：`toolUse`、`length` 和正常 `stop` 结束的 active goal 回合均计入 `budgetUsage.turns`，不再只统计 `stop`，默认隐式启动预算调整为基础 24 turns、60 分钟和 1 次终审修复，turn 宽限再给 24 turns。
- **会话压缩后恢复 dgoal goal**：监听 `session_compact`，并为 `dgoal_plan` / `dgoal_check` / `dgoal_done` 增加持久化 goal 惰性恢复；重同步区分 stale session replacement 与真实读取错误，避免压缩或切 session 后误报没有目标。
- **收紧隐式启动动作边界**：禁止隐式 shell/test 执行，统一校验本地路径型工具、Git 选项和多链接文件，避免项目外读写与任意脚本副作用。
- **隐式轻量启动提示对齐**：冷启动会把全局授权的隐式入口告知模型，`dgoal_propose` 的 `implicit` 描述明确不要求显式 `/dgoal`，但仍限 `final_only + bounded` 且必须是用户明确提出的安全任务。
- **审核共享预算耗尽后不再伪启动 1ms 候选**：首个审核候选耗尽 phase/goal 的共享总预算后，不再启动下一候选并把剩余时间压成 1ms；保留真实的总时长超时原因，避免误导为新的瞬时超时。审核超时文案也不再泄漏内部毫秒，统一显示为秒。

## [0.6.4] - 2026-07-14

### Added

- **agent 主动暂停出口 `dgoal_pause`**：agent 卡在"需要用户决策才能继续"的死锁（如冻结验收条件与目标冲突、缺只有用户掌握的信息或授权）时，可调用 `dgoal_pause({ reason })` 立即暂停（新增 `pauseReason: agent_blocked`，记录 agent 给出的原因），不等连续 3 轮 `no_progress` 兜底。此前 agent 遇到此类死锁只能消极地连续不调工具，被 continuation 催着空转烧 token 直到第 3 轮才暂停。`no_progress` 保留作兜底；`dgoal_pause` 暂停后 `/dgoal resume` 清零空转计数，给 agent 完整重试预算。

### Fixed

- **`dgoal_pause` 暂停原因边界与恢复状态**：拒绝空白或超长 `reason`，暂停后的查询与状态标题保留可读的 `pauseReasonDetail`，resume 或切换到其他暂停原因时清理旧 detail，避免用户无法恢复卡点或看到过期原因。
- **长审核工具执行被 180 秒空闲门误杀**：Pi 在 child（子进程）实际运行 `bash` 等内置工具时发送 `tool_execution_*`，此前 dgoal 未识别这些事件，导致全量测试等长命令虽然正常执行却在 180 秒后被误判为 `auditor_error`。现模型工作仍用 180 秒 idle timeout，工具执行自动扩展到 1800 秒；超时诊断会标明工具名，避免把正常验证误报为审核失败。
- **超时审核从零重跑**：独立审核 child 的 `tool_execution_start/end` 现在生成按 phase/goal 与工作区 fingerprint 隔离的脱敏审核检查点。候选切换或 `/dgoal resume` 会把同工作区已成功结束的精确命令注入 fresh context，避免反复跑同一重型验证；运行中、失败或工作区变化的命令不作为完成证据。phase 与 goal 另有跨候选共享的 900 秒 / 1800 秒整轮预算，避免无限审核。
- **审核检查点工作区校验**：untracked/ignored 文件内容变化、文件内容无法读取，或 Git 状态无法完整读取时，都会禁止复用旧工作区 fingerprint（依赖目录除外），避免复用过期的审核成功证据。
- **审核检查点事件校验**：只有 start/end 的 tool name 匹配且 child 明确报告 `isError:false` 时才记录成功命令；异常、缺失或不合法状态不再成为可复用证据。
- **审核命令脱敏**：审核恢复报告会额外遮蔽 shell 环境变量、CLI 参数、URL credentials、Cookie/session、HTTP header 和 URL query 形式的复合 API key、access token、client secret、credential、private key、password、secret 与 authorization，避免敏感值进入持久化检查点或模型上下文。
- **`dgoal_propose` 漏传 phase 的错误可操作化**：模型遗漏必填 `phases` 时，预处理现在先补为空数组并交给工具层校验，不再暴露宿主模糊的 `must have required properties phases`。错误会明确指出缺少 `phases`，并提示至少提交一个含 `subject` 与 `acceptanceCriteria`（`criterion` + `evidence`）的 phase；补回归测试覆盖该路径。

## [0.6.3] - 2026-07-14

### Fixed

- **语义预审从总时长超时改为可观测 idle timeout**：`dgoal_propose` 启动前语义预审此前用 30s 总时长超时，在 provider 排队或流式延迟时被误杀，且超时、网络异常与技术失败统一伪装成“请将人工体验移入 userReviewItems”的语义打回，误导 agent 反复改计划。现改为默认 60s **idle timeout**（无任何有效流事件才超时，收到任意事件重置），预审过程通过 `onUpdate` 输出活性状态（认证中/接收评审结果/校验评审 JSON）与空闲倒计时。预审终态拆为四类：`approved` / `rewritten` / `rejected`（语义打回，`isError:false`，带 criterion 级意见）/ `technical_error`（认证、超时、网络、非终止、JSON 解析等基础设施失败，`isError:true`，不再提示用户改计划）。
- **语义预审 idle timeout 可配置**：新增 `pi-dgoal.json` 的 `proposalSemanticReviewIdleTimeoutSeconds`（正整数秒，1..3600，非法值回退默认 60s 并告警），项目级优先于全局。
- **预审改用流式事件**：从 `completeSimple()`（只等最终结果）改为 `streamSimple()`（消费 `AssistantMessageEventStream`），每个有效事件（text/thinking/toolcall/done/error）重置 idle timer，半截 JSON 不作为改写建议采用，只有完整解析并通过迁移映射校验的最终结果才写入 `pendingProposal`。

### Changed

- **预审技术失败与语义打回分离**：技术失败以 `isError:true` 返回 `semantic review technical error`，明确提示“这不是计划内容问题；可稍后重试 /dgoal，或检查模型/网络可用性”；语义打回保持 `isError:false` 返回 `semantic review rejected` 与可修正原因。旧测试接缝 `__setProposalSemanticCompletionForTest` 保留向后兼容，新增 `__setProposalSemanticStreamForTest` 注入流式事件序列。
- **预审配置加载类型安全**：`loadDgoalConfig` 的 `isProjectTrusted` 改为可选并防御性可选链，`DgoalContext` 补 `isProjectTrusted?` 字段；`dgoal_propose` 调用点去掉 `as unknown as ExtensionContext` cast 与过宽的 `.catch(() => null)`，改为按 `ctx.cwd` 存在性加载配置，缺失时回退默认 60s 不阻断预审。清理 `raceWithIdle` 死参数、`emitProposeUpdate` 纯透传包装与 `SemanticReviewLiveness` 的 `"done"` 死分支（终态前显式置 `done`）。
## [0.6.2] - 2026-07-13

### Fixed

- **审核结论仲裁**：有效 `<APPROVED>` / `<REJECTED>` 优先于尾部 WebSocket/网络错误，不再误暂停为 `audit_error`。
- **审核候选切换**：每候选单次故障切换，健康 fallback 按 goal 与审核范围持久复用；`audit_error` resume 重置故障候选状态，phase/goal 拒绝回环分层。
- **状态查询浮层恢复**：`/dgoal s` 在持续浮层丢失或首次渲染失败后可幂等重绑并重绘 `dgoal-plan`，且不修改运行态。
## [0.6.1] - 2026-07-13

### Fixed

- **带归因的审核拒绝被误判为部分输出**：`<REJECTED goal>`、`<REJECTED phase="N">` 与 `<REJECTED user_review>` 现在与裸 `<REJECTED>` 一样被识别为正式终审结论，不再触发同模型续审和候选链回退后误暂停为 `audit_error`。

## [0.6.0] - 2026-07-13

### ⚠️ Breaking Changes

- **新持久化键不兼容旧 goal**：vNext 使用 `dgoal-goal-vnext` custom entry，旧 `dgoal-state` 被完全忽略。升级后需重新 `/dgoal`，不迁移、不恢复、不展示旧 goal（ADR 0026）。

### Changed

- **vNext Goal Runtime**：新增 `dgoal-goal-vnext` 持久化键；终审拒绝追加终审修复账本，rejected/paused(audit_failed_3x) 展示 Goal Repair，并保留完整计划修复上下文（含 resume 后软遗忘暂停）。多 phase 终审三路归因：审核器输出 `<REJECTED phase="N">/goal/user_review`，分别重开对应 phase、进 Goal Repair、不拒绝直接记录用户复核。
- **单 phase 统一完成建检**：单 phase goal 的一次 `dgoal_check` 同时核验 phase 与 goal，记录统一审核凭据；`dgoal_done` 复用凭据不重复终审（ADR 0018）。
- **启动与可观测性**：新增冷启动/paused 专用 `/dgoal help`；背景总结候选链全失败时 fail-closed 中止启动（ADR 0027）；启动闸门 `select→confirm→editor` 三层降级兼容旧主机；审核工具结果展示实际模型，并把脱敏审核 usage 写入 `~/.pi/agent/audit-usage.jsonl`，供 `pi-session-insights` 聚合。
- **源码分层**：入口收敛到 `index.ts` 组装根，新增 `src/plan`、`src/audit`、`src/isolated-pi`、`src/tui`、`src/goal-runtime`（可变会话状态单例）、`src/startup`（Pi 注册 + 事件订阅）职责模块（ADR 0024/0025）。

### Fixed

- **smoke prompt 对齐 ADR 0017**：smoke 目标不再强制两个 phase，任务简单时允许单 phase，修复真实模型在 proposal 阶段反复重提。
- **语义预审空迁移数组**：approve JSON 中空的 `migratedUserReviewItems` 不再误判 fail-closed。
- **Goal Repair resume 完整上下文**：resume 从 rejected/paused(audit_failed_3x) 恢复为 active 后，`finalFeedback` 仍在时保留全量 plan 上下文，修复软遗忘与修复上下文冲突。
- **背景失败文案对齐**：候选链全失败通知从“已降级为不带背景启动”改为“已中止启动（未进入目标）”，与 fail-closed 行为一致（ADR 0027）。

## [0.5.8] - 2026-07-12

### Changed

- **冻结 LLM 可独立验收契约**：`dgoal_propose` 现在要求 goal 与每个 phase 提供结构化 `acceptanceCriteria`（criterion + evidence）；缺失或空条件在启动闸门前拒绝。结构校验和 evidence 形态检查通过后，再由当前会话 LLM 在写入 `pendingProposal` 前做计划级语义预审；人工条件与可复验证据的组合会被拒绝或改写到 `userReviewItems`；`rewrite` 必须用精确 `sourceCriterion` → `userReviewItem` 映射保留被移除条件，缺失或无关映射 fail-closed。预审异常/中断 fail-closed。`buildProposePrompt` 第 5 条继续引导 agent 在提交前二次复核，审核器只对已冻结契约兜底。新 goal 的冻结完成门只有 `acceptanceCriteria`；`verification` 降级为 goal 级验收说明，不单独作为终审完成门。`userReviewItems` 用于声明 TUI、视觉和实际使用复核项，终审通过后与 agent 补充及审核器非阻塞建议合并输出，不成为 phase/goal 完成门；完成文本明确这些事项不代表人工体验已经验证。终审 rejected 报告中的用户复核建议也会持久化并在后续 approved 时合并交付。重审时上一轮反馈中的越权人工体验完成门不继续作为完成门，只按冻结契约重审。审核器只审冻结契约，不从 AGENTS/README 或人工体验要求运行时扩容完成门。详见 ADR 0016。
- **启动与完成 UI fail-soft**：启动确认先持久化 active 再投递 START prompt，状态推进不依赖 status/overlay/notify；`finalizeGoal` 先持久化 done/null 并清理内存 goal，再展示完成 UI。PlanOverlay 的同步更新、tool execution 刷新、tick 与完成延迟隐藏的 `setWidget` 调用也全部 fail-soft。补充 UI 抛错与状态先后顺序回归测试。

## [0.5.7] - 2026-07-12

### Fixed

- **paused 状态被误报为无目标**：goal 存在但处于 `paused` 时，`dgoal_plan` / `dgoal_check` / `dgoal_done` 此前统一返回“没有进行中的 /dgoal 目标”，掩盖了暂停事实。现区分可读判定（`isGoalReadable`，含 paused，用于只读入口）与可变更判定（`isGoalMutable`，仅 active/rejected，用于写入入口）：paused 下 `list` / `get` / `/dgoal status` 只读可用；`create` / `update` / `check` / `done` 返回结构化 paused 结果（含 `pauseReason` + `/dgoal resume` 指引），不再把“不能修改”混同为“目标不存在”。
- **无进展续跑空转**：`agent_end` 对正常 `stopReason=stop` 无条件发 continuation（续跑），导致 agent 连续多轮只回复“未完成”仍烧 token。现用 `before_agent_start` 重置本轮工具调用标记、`tool_execution_start` 置位，连续 3 轮无工具调用自动暂停（`pauseReason=no_progress`）；发生工具调用或 plan/goal 状态推进时计数重置。计数在 startGoal / clearGoal / resyncGoalFromSession / finalizeGoal 时清零，不跨 goal/session 继承。
- **pauseReason 写入遗漏**：`markGoalPaused` 在 `aborted` / `model_error` / `/dgoal pause` 三处调用此前未传 `pauseReason`，导致日志显示 `pausedReason=None`。现分别写入 `user_abort` / `model_error` / `user_abort`。
- **新 plan phase ID 非连续**：`proposalToPlan` 此前让 task 与 phase 共用全局 `nextId`，导致新计划 phase ID 为 `#1/#4/#8/#12`（task 占用了后续 phase 的 ID）。现先给所有 phase 预分配连续 ID `1..N`，task 再用全局唯一 ID；旧 plan 保留原 ID 不迁移。
- **phase 找不到无映射 + phaseId/phaseNumber 歧义**：phase 找不到时此前只返回“phase #N 不存在”，模型无法定位真实 ID。现返回完整阶段列表（阶段序号 + 真实 phaseId + 标题，当前 phase 高亮）。`dgoal_check` / `dgoal_plan` 新增 `phaseNumber`（阶段序号）参数，与 `phaseId` 二选一（同时提供被拒）；不把 `phaseId=2` 静默解释为第二阶段。
- **审核器配额错误未触发候选回退**：provider 业务层配额耗尽（如 `Codex error: The usage limit has been reached`）以纯文本返回，既非结构化 HTTP 429 也非 network 错误，被归为 `unknown` → `retry_same_model` → 同模型重试 3 次后直接暂停，不切候选。现 `classifyAuditorFailure` 对明确配额文本（usage/plan/rate limit、quota exceeded、insufficient quota）触发 `fallback` 切下一候选；业务 `REJECTED`、HTTP 400、未知非配额错误（如 `context length exceeded`、`billing address invalid`、`credit card declined`、`quota field invalid`）保持原行为。

### Changed

- **审核模型候选链与预检**：新增 `phaseAuditorModels` / `goalAuditorModels`，每个审核范围最多 3 个有序 `provider/model[:thinking]` 候选。项目级链整体优先于全局链、同来源复数 > 对应单值 > 旧 `auditorModel`，`null` 明确继承当前会话模型并阻断继续降级；旧单值配置不自动改写。解析会逐项告警非法/重复/超限项，并以审核 child 同隔离边界的 Pi `get_available_models` 结构化结果预检（完整模型 ID 优先、再识别末尾 thinking）；成功结果缓存到当前 Pi 进程，预检失败保留候选交给运行时。详见 ADR 0015。
- **审核器选模模板初始化**：首次实际独立审核发现全局和受信任项目级的 `pi-dgoal.json` 文件都不存在时，原子创建只含两个复数字段 `null` 的全局模板；不会覆盖已有文件。已有坏 JSON 或不可读文件只告警降级，写入失败仍回退当前会话模型并不中断审核。
- **审核器候选链运行时回退与部分输出续审**：审核器发生结构化技术异常（HTTP 401/403/404/408/429/5xx、网络错误、零输出超时）或明确纯文本配额耗尽时按候选顺序切换下一模型；HTTP 400、用户中断与明确 `<APPROVED>` / `<REJECTED>` 不切换。有部分输出但缺终止标记时，同模型最多重试 3 次，把已有文本作为受限的 `<partial_audit_feedback>`（6000 字符上限、XML 转义）续审，仍无结论才携带部分文本切下一候选。全部候选耗尽进入 `audit_error` 暂停，绝不静默回退当前执行模型。工具进度 `onUpdate` 与最终 `details` 记录实际采用模型、配置/预检降级状态、每次尝试轨迹（模型、outcome、reason、网络 code、进程 exitCode、error 文本）与耗尽标志；轨迹不写入 `GoalState`，部分反馈不污染正式 `phaseFeedbackById` / `finalFeedback`。详见 ADR 0015。

## [0.5.6] - 2026-07-07

### Fixed

- **`/tree` 导航后浮层与 goal 状态不重同步**：`/tree`（`navigateTree`）原地切 session 分支，只发 `session_tree` 通知、不发 `session_start`，而 pi-dgoal 此前未监听 `session_tree`，导致 `currentGoal` 停在旧分支、计划浮层显示陈旧状态（阶段明明完成了还显示未完成，计时器也冻住）。现抽取 `resyncGoalFromSession`（取消旧 continuation、清 check snapshot/auditor tracker + `loadGoal` + setStatus + overlay 重同步），`session_start` 与新增的 `session_tree` 处理共用，保证两个事件路径不分叉；每次成功重同步递增仅内存的 session generation，旧分支异步审核结果不能写回新分支，已发送但尚未派发的旧 continuation 会被 input handler 丢弃；UI 抛错不阻断状态重同步。`/fork` 走 `session_start reason fork`，同步被覆盖。

- **`/dgoal` 启动不暂停当前 LLM 工作**：`startGoal` 此前不 abort 当前 agent turn（`clearGoal` 有 `ctx.abort`，`startGoal` 没有），用户在 LLM 工作时敲 `/dgoal` 要等当前 turn 跑完才进 dgoal。现 `startGoal` 入口在非 idle 时 `ctx.abort`（参照 `shouldAbortCurrentTurnOnClear`）；并用 `startGoalInProgress` 标志包住「创建 pending goal → 投递 propose prompt」整段（try/finally），抑制被中断 turn 的 `agent_end` 触发 `handleStartupGate` 与 startGoal 自己的 propose 投递撞车（双发）。

- **`dgoal_plan` / `dgoal_propose` 兼容模型把数组参数序列化成字符串**：模型有时会把 `blockedBy` / `addBlockedBy` / `removeBlockedBy`（以及 `dgoal_propose` 的 `phases[].tasks[].blockedBy`）序列化成字符串 `"[]"` / `"[1,2]"` 而非真正的数组，此前 pi-ai 入参校验（`TypeBox` `Value.Convert` 把字符串转成类数组结构后按元素逐项校验）直接以 `blockedBy.0: must be number` 拒绝，导致建 task / 加依赖失败。现新增 `prepareArguments` 钩子（框架提供的「校验前规整模型坏输入」接缝，在 `validateToolArguments` 之前执行），把字符串化的数组 `JSON.parse` 回 `number[]`；schema 保持严格 `Array<number>` 不放宽对 LLM 的契约。reducer 入口同时保留 `coerceNumberArray` 兜底作为防御性二次清洗。

## [0.5.5] - 2026-07-07

### Fixed

- **建检子进程在 git worktree 场景下看对真实工作目录**：`dgoal_check` / `dgoal_done` 起的独立审核子进程此前始终用会话 `ctx.cwd` 启动，在 agent 于独立 `git worktree`（嵌套工作树）里改文件时看不到改动，导致 agent 为过建检不得不把 diff `git apply` 回主 worktree。现新增审核工作目录推断：优先取当前轮已成功执行的文件型工具调用（`edit` / `write`，再回退 `read`）的路径，再回退到已持久化的会话历史里的最近文件工具调用，最终在其所属 git 根与当前 `ctx.cwd` 所属 git 根不同时切到对应 worktree 根；同仓库仍保持原 `ctx.cwd`，无文件历史时回退当前目录。tracker 生命周期对齐 goal：在 `startGoal` / `clearActiveGoal` / `finalizeGoal` / `session_start` / `session_shutdown` 均重置，避免上一个 goal 的 worktree 路径泄漏到下一个 goal。

## [0.5.4] - 2026-07-06

### Added

- **`dgoal_propose` 计划就绪度自检**：启动闸门确认 UI 现在展示 plan 级 L0-L3 就绪度等级与缺口提示，优先暴露 `non-goals` 边界不足。`dgoal_propose` 新增可选 `nonGoals` / `guardrails` / `budget` 字段作为 plan 级信号；确认后边界持久化到 `GoalState`，并在执行期 system prompt 注入 `<dgoal_boundaries>` block。就绪度评估是计划提交前的评估，不是运行时自主权档位，也不引入项目级 `loop-audit` / badge。
- **`dgoal_done` 可核对完成文本**：`dgoal_done` 新增可选 `whatChanged`（改动清单）与 `userReview`（仍需用户核对）字段；完成回复信号从笼统宣布“已完成”升级为结构化的可核对文本（目标 / 完成总结 / 验证证据 / 改了什么 / 仍需你核对 / 审核结论）。终审任务输入也包含改动清单，方便审核器核验。对应三债模型：理解债靠 agent 解释恢复，意图债 agent 还不了（`userReview` 提示人核对）。

### Changed

- **loop 命名清理**：按“goal/loop 不分，对外用 goal/dgoal”的概念决定，统一清理残留 `loop` 命名。类型名 `LoopGoal`→`GoalState`、`LoopStatus`→`GoalStatus`、`LoopContext`→`DgoalContext`、`LoopStateEntryData`→`DgoalStateEntryData`；函数名 `isLooping`→`isGoalRunning`、`handleLoopCommand`→`handleDgoalCommand`；prompt 注入标签 `<loop_*>`→`<dgoal_*>`。代码、测试与当前权威文档均已同步；归档与决策档案保留原历史命名，不追溯。

### Fixed

- **`dgoal_done` 成功路径不再内联完整审核报告**：完成回复信号此前会把终审原始长报告拼进给主模型的信号文本，导致最终回复容易撞 maximum output token limit 被截断。现改为只保留审核结论，不内联报告原文。

## [0.5.3] - 2026-06-29

### Added

- **独立审核器选模配置**：新增 `~/.pi/agent/pi-dgoal.json` 或项目 `.pi/pi-dgoal.json`，可通过 `auditorModel`（格式 `provider/model`）为独立审核子进程单独指定模型。解析顺序为项目级（仅项目已 trusted 时生效）> 全局 > 当前会话模型；配置缺失、不可读或非法时回退到当前会话模型，审核不中断。首次审核且无任何配置文件时，dgoal 会一次性 i18n 提示全局路径（提示文案在安装 `pi-di18n` 时跟随 locale），之后保持静默；配置文件不被自动创建。该配置只影响独立审核子进程选模，不改变主执行线程模型。
- **穷举式审核 prompt**：`PHASE_CHECK_SYSTEM_PROMPT` 与 `AUDITOR_SYSTEM_PROMPT` 增加「一次提全」与「分级列出所有发现」指令，要求审核器在本轮预算内把所有已能发现的问题全部列出（FAIL/BLOCKER 必须列出，warning 级列出但不一定导致 REJECTED），不要找到第一个 blocker 就停，减少挤牙膏式往返。
- **重审反馈注入**：`buildPhaseCheckTask` / `buildAuditorTask` 在存在上一轮反馈时，把已持久化的 `phaseFeedbackById` / `finalFeedback` 原始报告以 `<previous_feedback>` 块注入审核子进程 task；两个 SYSTEM_PROMPT 增加「重审聚焦」指令，要求审核器先核验上轮问题是否真已修好，再全量查新问题，消除重审视野漂移。数据结构不变，复用已有反馈持久化。
- **新决策**：新增 `doc/决策档案/0013-auditorModel配置落点选独立文件.md`，记录审核器选模配置为什么用 `pi-dgoal.json` 而非借道 Pi 的 `settings.json`（不依赖 Pi 未文档化的未知字段容忍）。

## [0.5.2] - 2026-06-27

### Added

- **建检反馈闭环增强**：`LoopGoal` 新增 `phaseFeedbackById` / `finalFeedback`，把阶段建检未通过与终审 rejected 的原始报告持久化到 session 状态；system prompt 在 `<loop_plan>` 后按状态注入 `<check_feedback>`，让 compact / 恢复 / rejected 回环后主 agent 仍能读到完整失败报告。
- **事件流化审核器活性状态**：`runIsolatedCheck` 现在消费 `thinking_*`、`toolcall_*`、`text_delta`、`message_end` 等事件，任一有效事件都会重置 idle timer；活性状态和 `idle Ns/120s` 倒计时通过 `onUpdate` 流出，不写入 `LoopGoal`。
- **裸 `/dgoal` 承接前文启动**：空参数 `/dgoal` 不再落到状态查询，而是走启动闸门“路径 B”；命令层只发承接信号，由主 agent 在 `dgoal_propose` 中归纳 objective。当前无前文可承接时会提示改用 `/dgoal <objective>`。
- **TUI smoke 证据**：录制启动闸门确认 UI、provider/model 标识、`/dgoal s` 详细查询 Modal、持续显示浮层展开态以及裸 `/dgoal` 承接启动的 ANSI 证据（覆盖切片 4/8 关键路径）。切片 5/6 的 TUI 定向补录受当前 Pi 0.80.2 inline extension 运行时限制未能完成，改由单元/集成测试覆盖。

### Changed

- **建检结果三态化**：`dgoal_check` / 终审正式区分 `approved` / `rejected` / `auditor_error`；`rejected` 保持 `isError: false`（正常业务结果），`auditor_error` 才是 `isError: true`（判卷器异常）。
- **`auditor_error` 3 次透明重试**：审核器自身异常在一次工具调用内部最多重试 3 次；任一重试成功即收敛为正常建检结果，3 次全失败才进入 `paused(audit_error)`。
- **建检闸门锁定与越闸门推进拦截**：阶段建检不过时，goal 保持 `active`，但只能修当前 phase；对后续 phase 的 `dgoal_check`、以及前序 phase 未过时的 `dgoal_done` 会被硬拒。
- **用户可见边界收紧**：aboveEditor 浮层、`/dgoal s` 详细查询 Modal、底部状态栏继续只展示状态与 plan 结构，不展示建检报告正文。
- **持续显示展开态收敛**：`Ctrl+O` 打开的持续显示浮层展开态只展开 `pending / in_progress` phase；`done phase` 仅持久显示标题行，不再展开其 task，而 `/dgoal s` 详细查询 Modal 继续保留全量 phase/task 细节。
- **中英文术语统一**：用户可见文案统一为“持续显示浮层 / 持续显示展开态 / 详细查询 Modal”，英文同步为 `live overlay` / `expanded live overlay` / `Detailed Query Modal`。

## [0.5.1] - 2026-06-23

### Added

- **AI 驱动 smoke（`npm run test:smoke`）**：新增 `test/test-ai-smoke.py`，用 `pi -ne -e ./index.ts -ns -np --mode rpc --no-session` 在隔离环境（临时工作目录 + 只加载本扩展）以真实模型跑通多 phase dgoal 全工具链（`dgoal_propose → dgoal_plan → dgoal_check → dgoal_done`），自动回复启动闸门 `select`（取 `confirmStart` 选项）并追踪每个 `dgoal_*` 工具调用的 `isError`、文件产物与退出信号。补齐离线 RPC 测试（仅加载/命令注册）与人工 TUI smoke 之间的验证档位。⚠️ 消耗真实 token，需网络与已配置 provider，不进 CI。

### Changed

- **`/dgoal s` modal 长文本换行**：heading、phase subject、task subject 超出 modal 宽度时从 `...` 截断改为自动换行，续行与内容列对齐；滚动按换行后的物理行计算。
- **plan 注入软遗忘（ADR 0010）**：`buildPlanContextBlock` 对建检通过的 done phase 只注入标题行，其下 task 的 subject/evidence 不再注入。对照 R-SWA（参考滑动窗口注意力）类比——goal + context 全局可见（参考层），当前 phase + task 聚焦（工作记忆），done phase 的 task 细节软遗忘以聚焦当前进度。不改 `goal.plan` 持久化（全量保存）、不改建检/终审子进程可见性（读持久化全量）、不另建回查工具（靠 done phase 标题行 + 建检报告两条天然路径）；软遗忘时机是 phase 整体 done，当前 phase 内已完成的 task 仍注入。

## [0.5.0] - 2026-06-22

### Changed

- **`/dgoal s` modal anchor 从 top-center 切 center（ADR 0008 追加决策）**：实际使用后 top-center 视觉上“挂”在顶部不够聚焦；`/dgoal s` 是按需查询弹窗，用户主动唤起查完即关，挡 chat history 的时间窗口短，当初否决 center 的核心理由偏弱；maxHeight 85% + scroll 已解决内容看不全。overlay 配置改为 `anchor: "center"`，激活原备选 Variant C。
- **TUI 视觉编码重构：层级靠颜色，状态靠字符（ADR 0009）**：`/dgoal s` modal 不再按 status 整行染色，改为按内容层级分配基色——`goal = accent + bold`、`phase = text`、`task = dim`；`phase`/`task` 统一用同一套状态字符 `○ / ◐ / ✓ / ⚠`（删掉 modal 的 `PHASE_EMOJI`/`TASK_EMOJI` 双轨，与持续浮层 `PHASE_ICON` 对齐），`goal` 保留 `🎯`。`in_progress` 不再加 bold，状态只靠字符表达。颜色选择以跨主题可见性为前提，禁用 `yellow` 等在白底易丢的色相。

### Added

- **`done` 删除线扩展到 phase**：modal 和持续浮层的 done `phase`/`task` 标题文本现在都带删除线（ANSI 9/29），只划标题文本，不划状态字符 `○/◐/✓/⚠` 和树形符号 `├─ / │`；行内后缀说明（`activeForm`、`blockedReason`）作为辅助信息弱化显示、不参与删除线。
- **新术语与决策**：`doc/术语表.md` 新增"层级基色"、"状态字符"；新增 `doc/决策档案/0009-tui-visual-encoding-layer-over-status.md`（覆盖 ADR 0008 的 emoji+status 色方案）。

### Fixed

- **状态栏 `zh-CN` 真正中文化**：`🔁 active #N / paused / starting / rejected / done` 等状态栏文案在中文 locale 下原本沿用了英文状态词，现真正本地化为两字：`🔁 进行 / 暂停 / 启动 / 未过 / 完成`。
- **`/dgoal s` 空状态一致性**：没有 active goal 时，TUI 模式也显示 center modal 空状态；非 TUI 仍降级为 notify，用户可见文案统一使用 dgoal 而不是 loop，并补回 `ESC/Ctrl+C` 关闭提示。
- **`/dgoal s` 快捷键提示动态化**：plan 内容未超过 modal 可见高度时，只提示 `ESC/Ctrl+C`；只有内容可滚动时才显示 `j/k`、方向键和翻页键。

### Reminders

- **持续浮层彩色化延后**：本次只统一 modal 视觉编码；持续浮层（`aboveEditor widget`）的 theme-aware 彩色化延后到下一版本（见 `doc/30-路线图/30-项目路线图.md`），避免引入新 TUI 渲染 bug 面。

## [0.4.2] - 2026-06-20

### Added

- **`/dgoal s` top-center overlay modal**：`showStatus()` 现优先在 TUI 模式用 `ctx.ui.custom()` 弹出可滚动的 top-center overlay modal，展示完整 goal / phase / task 状态；heading 钉顶，支持 `j/k`、方向键、`PgDn/PgUp`、`End/G`、`Home/g`、`ESC`。
- **状态渲染纯函数与组件测试**：新增 `RenderLine`、`buildBodyLines*`、`buildHeadingLine`、`colorize`、`computeScrollOffset`、`PlanStatusDialog`，并补 `plan-status-pure.test.ts`、`plan-status-dialog.test.ts`、`show-status.test.ts` 回归覆盖。

### Changed

- **`/dgoal s` 查询形态升级**：从 5 行 `notify` 升级为 top-center overlay modal（Variant A，见 `doc/决策档案/0008-dgoal-s-modal-形态选型.md`）；非 TUI / 无 `ctx.ui.custom()` 时回退旧 notify，兼容 RPC / print / json 模式。
- **用户中断暂停通知颜色**：`Dgoal 已暂停（用户中断…）` 现在走 `error`（红色）而不是 `warning`（黄色），提升深色主题下的可见性。

### Fixed

- **elapsed 不再吞掉 pause 边界**：goal 暂停后会记录 `pauseStartedAt`，恢复时累计进 `pausedTotalMs`；overlay/modal/heading 的 `⏱️ elapsed` 现在会排除暂停窗口，不再把 `/dgoal pause` 到 `/dgoal resume` 之间的时间算进总时长。
- **modal 标题走 i18n**：`/dgoal s` 弹窗标题不再硬编码英文，会随 `pi-di18n` 的 locale 或本地 fallback 渲染。
- **文档状态契约统一为 `done`**：README 与权威数据模型文档不再暴露旧 `completed` 作为当前 task/phase 状态。

### Removed

- **删除 throwaway prototype**：移除 `prototype/dgoal-status-modal.prototype.ts` 与 `prototype/dgoal-status-modal.preview.ts`。

### Reminder

- **升级后请 `/reload`**：本版本新增 overlay modal，需要在 Pi 中 `/reload` 扩展后再体验 `/dgoal s` 新形态。

## [0.4.1] - 2026-06-19

### Fixed

- **goal 终结对 TUI 渲染异常容错**：`dgoal_done` 成功后 `finalizeGoal` 调用主程序 TUI（完成浮层、状态栏清空）现用 try/catch 包裹，主程序 TUI 渲染异常（如 `Spacer is not defined`）不再阻断 goal 状态清空——UI 展示失败时 goal 仍正确落 `done` 并清空，避免 goal 卡死无法关闭。

## [0.4.0] - 2026-06-19

### Added

- **`/dgoal` 单字母命令**：用户现在可以用 `/dgoal s`、`/dgoal p`、`/dgoal r`、`/dgoal c` 分别执行查询、停止、继续和清理

### Changed

- **命令提示文案**：Ctrl+O 浮层、状态输出和中英文说明文档同步改为展示全拼 + 单字母快捷形式，英文帮助使用 `[s]tatus` / `[p]ause` / `[r]esume` / `[c]lear`

### Removed

- **移除 `/dgoal stop` 别名**：`stop` 不再映射到 `clear`；请改用 `/dgoal clear` 或 `/dgoal c`

### Fixed

- **TUI 计时器图标渲染**：浮层标题栏的计时器改为显式 emoji 形式 `⏱️`（附带 variation selector），避免部分终端按文本字符样式渲染成黑白字形

## [0.3.0] - 2026-06-18

### Fixed

- **Task ID 编号**：`proposalToPlan()` 中 phase 和 task 各自从 1 编号（原共用计数器导致 phase 抢 ID=1，task 从 2 起步）
- **blockedBy 映射**：proposal 中 `blockedBy` 的 phase 内 1-based 索引现在正确映射到全局 task ID（原直接透传导致引用错位）
- **阶段顺序执行**：system prompt 新增阶段顺序硬约束；`dgoal_plan` 工具侧新增 `enforcePhaseOrder()` 防护，拦截跨 phase 操作
- **TUI goal done 后不消失**：`finalizeGoal()` 现在调用 `planOverlay.dispose()` 清除浮层
- **TUI 最后阶段不显示完成状态**：done 状态下不再隐藏已完成 phase，展示完整最终结果（全 ✓ + N/N）
- **建检子进程空闲超时误判**：`dgoal_check` / auditor 子进程现在在收到任意 `stdout` 数据块时就续命，不再等完整换行 JSON 才重置 watchdog，避免半行流式输出被误杀
- **建检子进程收尸不完整**：超时/中断时改为优先终止 detached process group，避免孙进程继承 pipe 导致 `close` 长时间挂住

### Changed

- **PlanStatus 终态命名统一为 `done`**：task/phase 的终态从 `completed` 统一改为 `done`（与 goal 层 `LoopStatus.done` 一致），涉及类型定义、TUI 图标、system prompt、工具描述、错误消息全链路
- **启动闸门默认展示摘要**：确认 UI 默认展示 goal / verification / phases / task 数量，用户按需展开 task 明细，避免初始对话被细粒度 task 淹没
- **verification 必填**：`dgoal_propose` 的 `verification` 从可选改为必填（工具 schema + `validateProposalInput` 工具层校验），没有可验收完成口的 goal 在工具层直接拒绝，不进入启动闸门确认；空话拦截靠 prompt 引导 + 终审兜底（ADR 0007）

### Added

- **TUI 计时器**：浮层标题栏显示已用时间（如 `⏱️ 2m 34s`）
- **TUI done 延迟消失**：goal 完成后浮层保留最终状态展示 10 秒后自动隐藏（agent 在当前 phase 未完成时直接开始后续 phase 的 task）
- **子进程监督回归测试**：新增 `subprocess-supervision.test.ts`，复现父进程退出但孙进程继承 pipe 的收尸场景

## [0.2.0] - 2025-06

### Added

- **Task Plan 三层内容**：goal（冻结）→ phase（阶段性目标）→ task（按需分解细粒度执行单元），支持 `dgoal_plan` 工具 CRUD
- **建检循环**：phase completed 唯一入口是 `dgoal_check`（独立只读子进程核验），不可绕过
- **启动闸门**：`dgoal_propose` 提交计划 → 用户确认 UI（确认/拒绝/反馈）→ 激活 loop
- **终审审核**：`dgoal_done` 触发独立只读子进程审核，连续 3 次不过自动暂停
- **计划浮层**：TUI aboveEditor widget 展示 plan 状态（phase 默认可见，task 可展开）
- **启动背景固化**：`/dgoal` 启动前自动从前文讨论提取结构化背景（目标范围/关键约束/验收标准），注入后续每轮 system prompt

### Changed

- 重命名 `pi-dloop` → `pi-dgoal`
- README 改为英文 facade 风格入口，中文文档移至 `README-zh.md`
- 建立完整设计文档体系（`doc/10-架构与运行/`、ADR 0001–0006）

### Fixed

- 完成后正确交回模型回复用户（不再自断续跑）
- 清理旧 dloop 残留引用

## [0.1.1] - 2025-05

### Added

- 启动前自动固化前文背景（summarizeContext 子进程）
- 模型错误自动重试（上限 3 次）
- 审核报告净化（去除噪音）

### Fixed

- 背景固化输入改用总量上限（原按消息数截断可能超限）
- 避免 loop context 在用户消息中完整展开（改用预览 + system prompt 注入双轨）
- 防止 Dloop 背景固化误导（明确标注为参考证据而非新指令）
- 删除审核进行中的残留通知，补审核通过结果通知

## [0.1.0] - 2025-05

### Added

- 初始版本：轻量目标循环扩展（`/dloop` 命令）
- 独立完成审核（in-process session 版，后重构为子进程）
- 审核器改为官方 CLI 子进程方式，纯只读
- 中文提示统一
