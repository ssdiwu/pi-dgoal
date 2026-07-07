# Changelog

All notable changes to `pi-dgoal` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

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
