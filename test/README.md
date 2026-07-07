# test/

pi-dgoal 的测试。两类：背景固化逻辑测试（bun test）和扩展加载 RPC 测试（python）。

## 运行

```bash
npm run test:context   # bun test test/context-input-cap.test.ts
npm run test:rpc       # python3 test/test-extension-rpc.py
npm run test:smoke     # python3 test/test-ai-smoke.py（AI 驱动 smoke，消耗真实 token）
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
| `show-status.test.ts` | v0.4.2 `/dgoal s` 入口回归：`showStatus` 的空 dgoal modal、非 TUI 兜底、overlay 参数、同步 throw / async reject 错误边界。 |
| `startup-gate.test.ts` | 切片4：启动闸门纯函数—— `validateProposalInput`、`formatProposalForConfirm`、`buildProposalConfirmationOptions`、确认 UI 摘要/明细切换。 |
| `check-event-classify.test.ts` | 切片4/5：建检活性纯函数—— `classifyCheckEvent` 事件识别（thinking/toolcall/text/message → 活性）、`CHECK_IDLE_TIMEOUT_SECONDS=120`、`isAuditorError` 三态判定、`runCheckWithRetry` 透明重试（approved/rejected 不重试、auditor_error 3 次）、`formatCheckLivenessLine`/`summarizeCheckProgress` 中英文 i18n。 |
| `auditor-config.test.ts` | v0.5.3 审核器选模配置：`getDgoalConfigPaths` 路径解析、`loadDgoalConfig` 项目级（仅 trusted）> 全局 > 回退、`auditorModel` 非法降级、无配置时一次性提示、`normalizeAuditorModelId` 格式校验。 |
| `auditor-workspace-cwd.test.ts` | 审核子进程工作目录推断：优先覆盖当前轮文件工具调用，再回退到会话里的最近文件工具调用；同仓库保持 `ctx.cwd`，并覆盖 goal 结束后不要把旧 worktree 泄漏到下一个 goal。 |
| `state-machine-and-prompt.test.ts` | 切片6/7：状态机 done/rejected/pauseReason + `buildPlanContextBlock` 注入 prompt、续跑时机判定。 |
| `tool-execute-integration.test.ts` | mock ctx + active goal 调 `dgoal_` 工具 execute，验证 `currentGoal` 真实变化 + `persist` 调用。不依赖终审 spawn。 |
| `e2e-integration.test.ts` | 端到端集成（不 spawn 子进程，绕过 AUDITOR）：完整生命周期 startGoal→propose→confirm→plan→phase completed→done，`finalizeGoal` UI 边界容错，blockedBy DAG。 |
| `soft-forgetting-e2e-smoke.test.ts` | ADR 0010 软遗忘端到端 smoke：走完整真实状态机路径（`proposalToPlan`→`applyPlanMutation`→`setPhaseCompleted`→`buildPlanContextBlock`），验证 phase done 后注入里只剩标题行、当前 phase 内 done task 仍注入。 |
| `command-aliases.test.ts` | `/dgoal` 子命令解析：全拼 / 单字母 `s/p/r/c`，以及移除 `stop` 别名后的行为。 |
| `context-input-cap.test.ts` | 启动背景固化的文本截断 / 摘要逻辑：`capPriorDiscussionText`、`buildContextBlock`、`buildContextPreview`、`buildStartPrompt`、`buildContextSummarizerTask`、`isRetryableSubprocessError`。纯逻辑测试，不依赖 Pi。 |
| `subprocess-supervision.test.ts` | 用真实 `child_process`（子进程）树复现“父进程退出但孙进程继承 pipe 导致 `close` 挂住”的场景，验证 dgoal 的 detached process group（独立进程组）终止逻辑能整体收尸。 |
| `test-extension-rpc.py` | 用隔离配置目录 + `pi -e` 临时加载本包，通过 RPC 验证扩展真实加载、`/dgoal` 命令注册。覆盖命令注册断言。 |
| `test-ai-smoke.py` | AI 驱动 smoke：`pi -ne -e index.ts -ns -np --mode rpc` 隔离环境 + 真实模型跑多 phase dgoal，自动回复启动闸门 select，追踪 `dgoal_propose/plan/check/done` 全工具链 + 文件产物核验。⚠️ 消耗真实 token，需网络与已配置 provider，不进 CI。 |

## 边界

- 自动化测试覆盖背景固化逻辑、命令注册、子进程收尸监督，以及部分建检辅助逻辑（如审核进度摘要）。
- **AI 驱动 smoke**（`test-ai-smoke.py`）覆盖真实模型下的全工具链（propose/plan/check/done）与启动闸门 RPC 驱动，是介于离线 RPC 测试与人工 TUI smoke 之间的一档。
- 完整 TUI 交互行为（含真实 auditor 子进程内容、浮层/overlay/modal 渲染、终审 rejected 回环、aboveEditor 浮层显示）仍需在 Pi TUI 中用真实模型做人工 smoke test。
