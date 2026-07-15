import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  dgoalDoneTool,
  dgoalPlanTool,
  dgoalProposeTool,
  dgoalCheckTool,
  dgoalPauseTool,
  handleDgoalCommand,
  resyncGoalFromSession,
  clearAuditorModelRegistryCache,
  handleStartupGate,
  safeSetDgoalStatus,
  safeUpdatePlanOverlay,
  clearContinuation,
  clearCurrentCheckSnapshot,
  resetAuditorWorkspaceTracker,
  safeNotify,
  isGoalRunning,
  buildSystemPrompt,
  markContinuationDelivered,
  trackFileToolExecutionStart,
  trackFileToolExecutionEnd,
  consumeCancelledContinuation,
  findFinalAssistantMessage,
  truncate,
  formatStatus,
  markGoalPaused,
  persistGoal,
  sendContinuation,
  decideNoProgressPause,
  decideBudgetPause,
  validateImplicitToolAction,
  buildNoProgressDetail,
  setupI18n,
  setApi,
  disposePlanOverlay,
  t,
  DGOAL_PLAN_TOOL_NAME,
  DGOAL_CHECK_TOOL_NAME,
  MAX_ERROR_RETRIES,
  MAX_NO_PROGRESS_TURNS,
  type DgoalContext,
} from "../runtime/index.ts";
import { goalRuntimeState } from "../goal-runtime/state.ts";


export function registerDgoal(pi: ExtensionAPI) {
  setApi(pi);
  setupI18n(pi);
  pi.registerTool(dgoalDoneTool);
  pi.registerTool(dgoalPlanTool);
  pi.registerTool(dgoalProposeTool);
  pi.registerTool(dgoalCheckTool);
  pi.registerTool(dgoalPauseTool);

  pi.registerCommand("dgoal", {
    description: t("command.description"),
    handler: (args, ctx) => handleDgoalCommand(args, pi, ctx),
  });

  pi.on("session_start", (event, ctx) => {
    if (event.reason === "reload") clearAuditorModelRegistryCache();
    resyncGoalFromSession(ctx);
  });

  // /tree（navigateTree）原地切 session 分支：不发 session_shutdown/session_start，
  // 只发 session_tree 通知。不重同步会导致 goalRuntimeState.currentGoal 停在旧分支、overlay 显示陈旧状态
  // （阶段明明完成了还显示未完成，计时器也冻住）。与 session_start 复用同一套重同步。
  pi.on("session_tree", (_event, ctx) => {
    resyncGoalFromSession(ctx);
  });

  // 会话压缩完成后主会话上下文可能重建，但 dgoal 状态仍在 custom entry；复用统一恢复路径。
  pi.on("session_compact", (_event, ctx) => {
    resyncGoalFromSession(ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (goalRuntimeState.currentGoal) persistGoal(goalRuntimeState.currentGoal);
    clearContinuation();
    clearCurrentCheckSnapshot();
    resetAuditorWorkspaceTracker();
    disposePlanOverlay();
    safeSetDgoalStatus(ctx, undefined);
  });

  pi.on("input", (event) => {
    if (event.source !== "extension") return;
    if (consumeCancelledContinuation(event.text)) return { action: "handled" as const };
  });

  pi.on("before_agent_start", (event) => {
    markContinuationDelivered(event.prompt);
    // 新 agent turn 重置本轮工具调用标记。
    goalRuntimeState.turnHadToolExecution = false;
    // Phase 是用户确认过的进度主干，完成后仍持久显示；不在 agent_start 自动隐藏。
    if (!goalRuntimeState.currentGoal || !isGoalRunning(goalRuntimeState.currentGoal.status)) return;

    return {
      systemPrompt: `${event.systemPrompt}\n\n${buildSystemPrompt(goalRuntimeState.currentGoal)}`,
    };
  });

  pi.on("tool_execution_start", (event, ctx) => {
    trackFileToolExecutionStart(event.toolCallId, event.toolName, event.args, ctx.cwd);
    // 隐式轻量启动拥有的是运行时动作许可，不只是 proposal 文本许可；越界工具一旦开始即安全暂停，且不再自动续跑。
    const goal = goalRuntimeState.currentGoal;
    if (goal?.implicitStart && isGoalRunning(goal.status)) {
      const violation = validateImplicitToolAction(event.toolName, event.args, ctx.cwd);
      if (violation) {
        // 事件到达时 Pi 可能刚开始执行工具；立即中断当前 turn，并把暂停状态先落盘。
        ctx.abort?.();
        goalRuntimeState.currentGoal = markGoalPaused(goal, Date.now(), {
          pauseReason: "agent_blocked",
          pauseReasonDetail: violation,
        });
        persistGoal(goalRuntimeState.currentGoal);
        clearContinuation();
        safeSetDgoalStatus(ctx, formatStatus(goalRuntimeState.currentGoal));
        safeUpdatePlanOverlay();
        safeNotify(ctx, `Implicit dgoal paused: ${violation}. Use explicit /dgoal to authorize this action.`, "warning");
        return;
      }
    }
    // 本轮有工具调用，说明有实际推进，不计入空转。
    goalRuntimeState.turnHadToolExecution = true;
  });

  // 切片3：plan 相关工具执行后刷新浮层（tool_execution_end 只读 goalRuntimeState.currentGoal，不 replay）
  pi.on("tool_execution_end", (event) => {
    trackFileToolExecutionEnd(event.toolCallId, event.isError);
    if (event.isError) return;
    if (event.toolName !== DGOAL_PLAN_TOOL_NAME && event.toolName !== DGOAL_CHECK_TOOL_NAME) return;
    safeUpdatePlanOverlay();
  });

  function consumeRuntimeBudget(ctx: DgoalContext): boolean {
    const goal = goalRuntimeState.currentGoal;
    if (!goal) return false;
    const turnUsage = (goal.budgetUsage?.turns ?? 0) + 1;
    goalRuntimeState.currentGoal = {
      ...goal,
      budgetUsage: { turns: turnUsage, repairAttempts: goal.budgetUsage?.repairAttempts ?? 0 },
    };
    const turnBase = goal.budgetPolicy === "bounded" ? goal.runtimeBudget?.maxTurns : undefined;
    if (!goalRuntimeState.currentGoal.budgetInGrace && turnBase !== undefined && turnUsage >= turnBase) {
      goalRuntimeState.currentGoal = { ...goalRuntimeState.currentGoal, budgetInGrace: true, budgetGraceUsed: true };
      persistGoal(goalRuntimeState.currentGoal);
      safeNotify(ctx, "Bounded turn budget reached; entering one preauthorized grace window.", "warning");
    }
    const wallLimit = goalRuntimeState.currentGoal.budgetPolicy === "bounded" ? goalRuntimeState.currentGoal.runtimeBudget?.maxWallClockMinutes : undefined;
    const activeElapsedMs = Math.max(0, Date.now() - (goalRuntimeState.currentGoal.startedAt || Date.now()) - (goalRuntimeState.currentGoal.pausedTotalMs ?? 0));
    const wallBaseReached = wallLimit !== undefined && activeElapsedMs >= wallLimit * 60_000;
    if (!goalRuntimeState.currentGoal.budgetInGrace && wallBaseReached) {
      goalRuntimeState.currentGoal = { ...goalRuntimeState.currentGoal, budgetInGrace: true, budgetGraceUsed: true };
      persistGoal(goalRuntimeState.currentGoal);
      safeNotify(ctx, "Bounded wall-clock budget reached; entering one preauthorized grace window.", "warning");
    }
    const wallGraceMinutes = goalRuntimeState.currentGoal.runtimeBudget?.grace?.maxWallClockMinutes ?? wallLimit;
    const wallGraceExceeded = goalRuntimeState.currentGoal.budgetInGrace && wallLimit !== undefined
      && wallGraceMinutes !== undefined && activeElapsedMs >= (wallLimit + wallGraceMinutes) * 60_000;
    const overTurns = decideBudgetPause(goalRuntimeState.currentGoal, "turns");
    if (overTurns.pause || wallGraceExceeded) {
      goalRuntimeState.currentGoal = markGoalPaused(goalRuntimeState.currentGoal, Date.now(), { pauseReason: "budget_exhausted" });
      persistGoal(goalRuntimeState.currentGoal);
      clearContinuation();
      safeSetDgoalStatus(ctx, formatStatus(goalRuntimeState.currentGoal));
      safeUpdatePlanOverlay();
      safeNotify(ctx, "Bounded budget exhausted after grace; paused.", "warning");
      return true;
    }
    return false;
  }

  async function handleAgentEnd(event: { messages: unknown[] }, ctx: DgoalContext) {
    // 切片4：启动闸门阶段（goal pending）——主代理应调 dgoal_propose 提交计划。
    // startGoal 初始化期间（创建 pending → 投递 propose）跳过：被中断 turn 的 agent_end
    // 会看到 pending goal，不跳过会与 startGoal 自己的 propose 投递撞车（双发）。
    if (goalRuntimeState.currentGoal && goalRuntimeState.currentGoal.status === "pending") {
      if (goalRuntimeState.startGoalInProgress) return;
      await handleStartupGate(pi, ctx, goalRuntimeState.currentGoal);
      return;
    }

    if (!goalRuntimeState.currentGoal || !isGoalRunning(goalRuntimeState.currentGoal.status)) return;

    const finalAssistant = findFinalAssistantMessage(event.messages);
    const errorDetail = finalAssistant?.errorMessage ? `：${truncate(finalAssistant.errorMessage)}` : "";

    // 用户主动中断：不重试，直接暂停。
    if (finalAssistant?.stopReason === "aborted") {
      goalRuntimeState.consecutiveErrors = 0;
      goalRuntimeState.consecutiveNoProgressTurns = 0;
      goalRuntimeState.currentGoal = markGoalPaused(goalRuntimeState.currentGoal, Date.now(), { pauseReason: "user_abort" });
      persistGoal(goalRuntimeState.currentGoal);
      clearContinuation();
      safeSetDgoalStatus(ctx, formatStatus(goalRuntimeState.currentGoal));
      safeUpdatePlanOverlay();
      safeNotify(ctx, t("notify.abortedPaused", { detail: errorDetail }), "error");
      return;
    }

    // 模型错误：先自动重试 MAX_ERROR_RETRIES 次，仍失败再暂停，避免瞬时错误直接打断 dgoal。
    // 不要 clearContinuation + sendContinuation——前一个 followUp 还未消费时重发会堆 N 条。
    // sendContinuation 本身的 guard（goalRuntimeState.pendingContinuation?.goalId === goal.id）会去重。
    if (finalAssistant?.stopReason === "error") {
      goalRuntimeState.consecutiveErrors += 1;
      // 模型错误打断“连续正常空转”序列：不是正常结束，重置无进展计数。
      goalRuntimeState.consecutiveNoProgressTurns = 0;
      if (goalRuntimeState.consecutiveErrors <= MAX_ERROR_RETRIES) {
        safeNotify(
          ctx,
          t("notify.modelRetry", { count: goalRuntimeState.consecutiveErrors, max: MAX_ERROR_RETRIES, detail: errorDetail }),
          "warning",
        );
        await sendContinuation(pi, ctx, goalRuntimeState.currentGoal);
        return;
      }
      goalRuntimeState.consecutiveErrors = 0;
      goalRuntimeState.currentGoal = markGoalPaused(goalRuntimeState.currentGoal, Date.now(), { pauseReason: "model_error" });
      persistGoal(goalRuntimeState.currentGoal);
      clearContinuation();
      safeSetDgoalStatus(ctx, formatStatus(goalRuntimeState.currentGoal));
      safeUpdatePlanOverlay();
      safeNotify(
        ctx,
        t("notify.modelPaused", { max: MAX_ERROR_RETRIES, detail: errorDetail }),
        "warning",
      );
      return;
    }

    // length/toolUse/缺失原因保留原有续跑行为：不计入正常轮次预算，也不触发预算暂停。
    if (finalAssistant?.stopReason !== "stop") {
      goalRuntimeState.consecutiveErrors = 0;
      goalRuntimeState.consecutiveNoProgressTurns = 0;
      goalRuntimeState.currentGoal = { ...goalRuntimeState.currentGoal, iteration: goalRuntimeState.currentGoal.iteration + 1, updatedAt: Date.now() };
      persistGoal(goalRuntimeState.currentGoal);
      safeSetDgoalStatus(ctx, formatStatus(goalRuntimeState.currentGoal));
      await sendContinuation(pi, ctx, goalRuntimeState.currentGoal);
      return;
    }

    // 只有明确 stop 的正常轮次才计入运行预算。
    if (consumeRuntimeBudget(ctx)) return;

    // 正常完成一轮：先判是否真正有推进。
    goalRuntimeState.consecutiveErrors = 0;
    const progress = decideNoProgressPause({
      hadToolExecution: goalRuntimeState.turnHadToolExecution,
      consecutiveNoProgress: goalRuntimeState.consecutiveNoProgressTurns,
    });
    goalRuntimeState.consecutiveNoProgressTurns = progress.newCount;
    if (progress.pause) {
      goalRuntimeState.currentGoal = markGoalPaused(goalRuntimeState.currentGoal, Date.now(), { pauseReason: "no_progress" });
      persistGoal(goalRuntimeState.currentGoal);
      clearContinuation();
      safeSetDgoalStatus(ctx, formatStatus(goalRuntimeState.currentGoal));
      safeUpdatePlanOverlay();
      safeNotify(ctx, t("notify.noProgressPaused", { max: MAX_NO_PROGRESS_TURNS, detail: buildNoProgressDetail(goalRuntimeState.currentGoal) }), "warning");
      return;
    }
    goalRuntimeState.currentGoal = { ...goalRuntimeState.currentGoal, iteration: goalRuntimeState.currentGoal.iteration + 1, updatedAt: Date.now() };
    persistGoal(goalRuntimeState.currentGoal);
    safeSetDgoalStatus(ctx, formatStatus(goalRuntimeState.currentGoal));

    await sendContinuation(pi, ctx, goalRuntimeState.currentGoal);
  }

  pi.on("agent_end", handleAgentEnd);
}
