# test/

pi-dgoal 的测试地图。离线确定性测试使用 Bun，扩展加载使用 RPC（Python），另有真实模型 smoke 与审核/子进程专项测试。`context-summarizer-*` 仅保留为 ADR 0033 兼容 helper 的遗留覆盖，生产启动不再调用独立背景摘要链。

## 运行

```bash
npm run test:context   # bun test test/context-input-cap.test.ts
npm run test:rpc       # python3 test/test-extension-rpc.py
npm run test:smoke:runtime # python3 test/test-ai-smoke-runtime.py（smoke 的 Pi 运行时选择，不消耗 token）
npm run test:smoke:cleanup # Python 假 Pi：认证最小化与 SIGTERM 清理（不消耗 token）
npm run test:smoke         # python3 test/test-ai-smoke.py（AI 驱动 smoke，消耗真实 token）
python3 test/test-auditor-fallback-smoke.py # 真实候选运行时回退 smoke，消耗真实 token
npm test               # bun test（全量，跑所有 *.test.ts）
```

## 文件

| 文件 | 验证什么 |
|---|---|
| `task-plan-data-model.test.ts` | 切片1：Task Plan 数据模型 + `persistGoal`/`loadGoal` 往返 + 向后兼容（0.1.x 旧 goal 无 plan 字段）。 |
| `dgoal-plan-reducer.test.ts` | 切片2：`dgoal_plan` reducer（纯函数）—— `applyPlanMutation` 四态状态机、`setPhaseCompleted`（task 聚合）、`detectPlanCycle`（blockedBy 环检测）。 |
| `plan-overlay-render.test.ts` | 切片3：计划浮层渲染纯函数 `renderPlanLines` + `PlanOverlay` 类（reload 恢复、展开折叠、完成闪现）。 |
| `plan-status-pure.test.ts` | v0.4.2 `/dgoal s` modal 的纯函数测试：`buildBodyLines*`、`buildHeadingLine`、`colorize`、`computeScrollOffset`。 |
| `plan-status-dialog.test.ts` | v0.4.2 `/dgoal s` modal 的 `PlanStatusDialog` 组件测试：render、heading 钉顶、scroll、ESC 关闭、缓存与 Focusable/Component 契约。 |
| `show-status.test.ts` | v0.4.2 `/dgoal s` 入口回归：`showStatus` 的空 dgoal modal、非 TUI 兜底、overlay 参数、同步 throw / async reject 错误边界，以及浮层缺失/首次 `setWidget` 异常后的幂等重绘。 |
| `startup-gate.test.ts` | 启动闸门结构与语义边界：`validateProposalInput`、当前会话 LLM 语义预审的拒绝/改写/fail-closed、旧 proposal 清理、冻结 `acceptanceCriteria` / `userReviewItems`、`buildProposePrompt`、确认 UI 摘要/明细切换。预审流式 idle timeout（持续事件续命、无事件超时）、技术失败（`isError:true`）与语义打回（`isError:false`）分离、`onUpdate` 活性输出。 |
| `startgoal-abort.test.ts` | 启动中断与语义预审中断：`ctx.abort`、启动闸门投递去重，以及预审中断后 goal 保持 pending、没有 active proposal。 |
| `check-event-classify.test.ts` | 切片4/5：建检活性纯函数—— `classifyCheckEvent` 识别 thinking/toolcall/text/message 与 Pi `tool_execution_*`；模型 idle 180s、工具执行 idle 1800s；`isAuditorError` 三态判定、`runCheckWithRetry` 候选单次切换（approved/rejected 不切换、共享预算耗尽不启动下一候选、候选耗尽 `auditor_error`）、`formatCheckLivenessLine`/`formatAuditTotalTimeout`/`summarizeCheckProgress` 中英文 i18n。 |
| `auditor-config.test.ts` | 审核器候选配置与预检：受信任项目链整体 > 全局链、同来源复数字段 > 单值字段 > 旧 `auditorModel`、`phaseAuditorModels` / `goalAuditorModels` 的 `null` 阻断、空/非法/重复/超限候选、custom/gateway 多段路径和 thinking 后缀、隔离 child 的结构化 Pi 注册表匹配、成功缓存/失败重试、预检不可用的跨字段/来源降级与预检失败保留候选；同时覆盖首次双 `null` 模板及 `ui.notify` 抛错容错。 |
| `auditor-fallback.test.ts` | 审核器候选链运行时回退：候选技术/协议错误或无终止标记部分输出时按顺序单次切换、有效 fallback 按 goal/审核范围持久复用、业务 REJECTED 与中断分流、候选耗尽 `audit_error` 及 `buildAuditorResultDetails()` 轨迹。 |
| `audit-checkpoint.test.ts` / `audit-checkpoint-runtime.test.ts` / `audit-checkpoint-resume.test.ts` / `audit-usage-ledger-production-path.test.ts` | 审核检查点：复合敏感字段、URL credentials、Cookie/session 脱敏；同 workspace fingerprint 的成功命令复用；untracked/ignored/读取失败 fail-closed；running/unknown/异常事件不算完成；真实审核路径与重启后注入边界。 |
| `audit-usage-ledger.test.ts` / `audit-usage-cross-repo.test.ts` | 审核 usage ledger（用量账本）的脱敏落盘、稳定去重和跨仓库聚合联动。 |
| `auditor-abort-listener.test.ts` | 审核中断监听器的注册、立即 abort 和正常结束清理。 |
| `auditor-workspace-cwd.test.ts` | 审核子进程工作目录推断：优先覆盖当前轮文件工具调用，再回退到会话里的最近文件工具调用；同仓库保持 `ctx.cwd`，并覆盖 goal 结束后不要把旧 worktree 泄漏到下一个 goal。 |
| `state-machine-and-prompt.test.ts` | 切片6/7：状态机 done/rejected/pauseReason + `buildPlanContextBlock` 注入 prompt、续跑时机判定。 |
| `tool-execute-integration.test.ts` | mock ctx + pending/active goal 调 `dgoal_` 工具 execute，验证 `currentGoal`、`pendingProposal`、预审 rejected/error/合法重提状态和 `persist` 调用。不依赖终审 spawn。 |
| `e2e-integration.test.ts` | 端到端集成（不 spawn 子进程，绕过 AUDITOR）：完整生命周期 startGoal→propose→confirm→plan→phase completed→done，`finalizeGoal` UI 边界容错，phase 建检 approved/rejected 真实分支 UI 抛错仍先持久化状态/反馈/复核项，blockedBy DAG。 |
| `soft-forgetting-e2e-smoke.test.ts` | ADR 0010 软遗忘端到端 smoke：走完整真实状态机路径（`proposalToPlan`→`applyPlanMutation`→`setPhaseCompleted`→`buildPlanContextBlock`），验证 phase done 后注入里只剩标题行、当前 phase 内 done task 仍注入。 |
| `command-aliases.test.ts` | `/dgoal` 子命令解析：全拼 / 单字母 `s/p/r/c`，以及移除 `stop` 别名后的行为。 |
| `help-command-routing.test.ts` | `/dgoal help` 在冷启动、paused、active、pending 状态下的路由。 |
| `prepare-arguments-schema.test.ts` | `dgoal_plan` / `dgoal_propose` 参数 coercion（类型归一化）与严格 schema（模式）校验接缝。 |
| `context-input-cap.test.ts` | 启动背景输入边界与验收 prompt 逻辑：`capPriorDiscussionText`、`buildContextBlock`、`buildContextPreview`、`buildStartPrompt`、冻结验收契约注入与 XML escape、审核范围不扩容回归（phase/goal prompt + system prompt 禁止从 AGENTS/README/人工体验扩容完成门）、用户复核提取。纯逻辑测试，不依赖 Pi。 |
| `context-summarizer-candidate-loop.test.ts` / `context-summarizer-fail-closed.test.ts` | ADR 0033 兼容 helper 的遗留测试：验证旧背景摘要接缝的候选/失败行为，不代表生产启动仍调用独立摘要链。 |
| `subprocess-supervision.test.ts` | 用真实 `child_process`（子进程）树复现“父进程退出但孙进程继承 pipe 导致 `close` 挂住”的场景，验证 dgoal 的 detached process group（独立进程组）终止逻辑能整体收尸。 |
| `paused-state-diagnostics.test.ts` | paused/missing/active 状态下工具的可读与可写边界：paused 下 list/get 只读、create/update/check/done 返回结构化 paused 结果与 resume 指引，不误报 noGoal；pauseReason 区分 user_abort/model_error；pending goal 不可完成（启动闸门保护）。 |
| `no-progress-stall.test.ts` | 无进展续跑熔断纯函数 `decideNoProgressPause`：有工具调用清零、无工具累计、达 3 轮暂停、`MAX_NO_PROGRESS_TURNS=3`。 |
| `no-progress-agent-end.test.ts` | 无进展续跑真实事件链集成：mock Pi 捕获 dgoal() 注册的 input → before_agent_start → tool_call/tool_execution_start → agent_end 回调，验证自然语言显式启动拒绝 `source=extension` / mid-run 输入并精确绑定 dgoal 观察到的 input/prompt、后续 transform fail-closed；同时覆盖隐式越界工具执行前 block、连续 3 轮无工具调用暂停、工具调用重置与 user_abort/model_error。 |
| `agent-pause-tool.test.ts` | `dgoal_pause` 主动暂停出口：active/rejected 状态立即进入 `paused(agent_blocked)`，reason 非空/有界，paused 结果可读，resume 清理 detail，UI 抛错仍先持久化，工具真实注册可见。 |
| `budget-policy-stall.test.ts` | v0.7.0 预算策略：bounded/unbounded、宽限判定与状态栏宽限标记。 |
| `final-only-phase-progress.test.ts` / `final-only-proposal-path.test.ts` | v0.7.0 `final_only`：阶段进度划线、拒绝 `dgoal_check`、真实 proposal 预审路径，以及 reviewer 在 approve/rewrite 返回空 `phaseAcceptanceCriteria: []` 时补齐 phase 层、不误判偷改也不再触发 `rewrittenLayers[layer]` 崩溃。 |
| `implicit-start-authorization.test.ts` | 启动授权：v0.7.0 隐式轻量启动的全局授权、项目越权拒绝、策略/预算边界、proposal 文本与运行时动作护栏；ADR 0036 祈使句/问句/引用/否定/token 边界的自然语言意图识别，以及冷会话提交 phased/外部动作计划仍进入普通 pending 确认。 |
| `phase-id-diagnostics.test.ts` | 新 plan phase ID 连续（proposalToPlan 预分配 1..N）、旧 plan（非连续 #1/#4/#8）兼容加载、phase 找不到时返回完整阶段列表（序号+真实 ID+标题，当前高亮）。 |
| `session-tree-resync.test.ts` | session 分支/压缩恢复：pending/active/rejected goal 重同步、stale session replacement 保护，以及三个 dgoal 工具的惰性恢复。 |
| `auditor-quota-fallback.test.ts` | 审核器配额文本错误（usage limit/quota exceeded/rate limit）触发候选回退（fallback），业务 REJECTED 不回退；未知非配额错误也只尝试当前候选一次后切换；`hasQuotaErrorHint` 排除 context length exceeded / billing address / credit card 等误报。 |
| `test-extension-rpc.py` | 用隔离配置目录 + `pi -e` 临时加载本包，通过 RPC 验证扩展真实加载、`/dgoal` 命令注册。覆盖命令注册断言。 |
| `test-ai-smoke-runtime.py` | AI smoke 的 Pi 运行时选择：模拟 npm PATH（路径）含项目旧 `node_modules/.bin/pi` 时跳过它并选择宿主 Pi；`PI_DGOAL_SMOKE_PI` 覆盖优先。 |
| `test-ai-smoke.py` | AI 驱动 smoke：跳过 npm 注入的项目 local Pi，使用宿主 Pi（可用 `PI_DGOAL_SMOKE_PI` 覆盖）；以 `-ne -e index.ts -ns -np --mode rpc` 隔离环境 + 真实模型跑 dgoal（默认单 phase，对齐 ADR 0017），自动回复启动闸门 select，追踪 `dgoal_propose/plan/check/done` 全工具链 + 文件产物核验。⚠️ 消耗真实 token，需网络与已配置 provider，不进 CI。 |
| `test-auditor-fallback-smoke.py` | 真实模型候选链运行时回退 smoke：候选链位于临时受信任项目 `.pi/pi-dgoal.json`；临时认证副本只含 ZAI 主候选（置为无效 key）和有效 MiniMax，主 agent 固定 MiniMax。预检识别两候选后，主候选真实 HTTP 401 → `auditorAttempts` 记录 `fallback` → MiniMax 备用候选完成 phase check / goal audit。断言 `tool_execution_update` 的 `candidate_fallback`、两次 phase 与一次 goal 的完整回退 attempts、备用模型和文件产物；Pi 以独立进程组收尾，认证与工作目录在正常退出或 `SIGTERM`（终止信号）时清理。⚠️ 消耗真实 token，不进 CI。 |
| `test-auditor-fallback-cleanup.py` | 不消耗 token 的 smoke 清理回归：假 Pi 长驻时检查临时认证仅复制 ZAI / MiniMax，向 driver 发送 `SIGTERM` 后断言退出码、临时目录和子进程均无残留。 |

## 边界

- 自动化测试覆盖背景固化逻辑、命令注册、子进程收尸监督，以及部分建检辅助逻辑（如审核进度摘要）。
- **AI 驱动 smoke**（`test-ai-smoke.py`）覆盖真实模型下的全工具链（propose/plan/check/done）与启动闸门 RPC 驱动，是介于离线 RPC 测试与人工 TUI smoke 之间的一档。
- 完整 TUI 交互行为（含真实 auditor 子进程内容、浮层/overlay/modal 渲染、终审 rejected 回环、aboveEditor 浮层显示）仍需在 Pi TUI 中用真实模型做人工 smoke test。
