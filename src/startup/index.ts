import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  workListTool,
  executionPlanTool,
  workCreateTool,
  workReadTool,
  workUpdateTool,
  goalPlanTool,
  stagedPlanTool,
  phaseCheckTool,
  goalCheckTool,
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
  markContinuationDelivered,
  trackFileToolExecutionStart,
  trackFileToolExecutionEnd,
  consumeCancelledContinuation,
  findFinalAssistantMessage,
  truncate,
  formatStatus,
  markGoalPaused,
  resumeExecutionPlanAfterModelErrorFromUserInput,
  sendContinuation,
  buildSoftWorkListContext,
  buildPlanContractContext,
  hasPlanContract,
  persistWorkGoal,
  isExecutionPlan,
  persistActiveGoal,
  buildNoProgressDetail,
  setupI18n,
  setApi,
  disposePlanOverlay,
  t,
  WORK_LIST_TOOL_NAME,
  EXECUTION_PLAN_TOOL_NAME,
  WORK_CREATE_TOOL_NAME,
  WORK_UPDATE_TOOL_NAME,
  GOAL_PLAN_TOOL_NAME,
  STAGED_PLAN_TOOL_NAME,
  PHASE_CHECK_TOOL_NAME,
  GOAL_CHECK_TOOL_NAME,
  MAX_ERROR_RETRIES,
  MODEL_ERROR_WARNING_THRESHOLD,
  MAX_NO_PROGRESS_TURNS,
  MAX_STALLED_PROGRESS_TURNS,
  type DgoalContext,
} from "../runtime/index.ts";
import {
  beginProgressTurn,
  completeProgressTurn,
  recordDurableProgress,
  recordToolActivity,
  resetProgressStreaks,
} from "../runtime/liveness.ts";
import {
  authorizeNaturalLanguageStart,
  authorizeExecutionPlanModelErrorRecovery,
  clearExplicitPlanUpgradeAuthorization,
  clearNaturalLanguageStartAuthorization,
  clearExecutionPlanModelErrorRecovery,
  goalRuntimeState,
} from "../goal-runtime/state.ts";
import { commitCurrentGoal } from "../goal-runtime/commit.ts";

const DGOAL_TOKEN_SOURCE = String.raw`(?<![A-Za-z0-9_])\/?dgoal\b`;
const DGOAL_TOKEN_PATTERN = new RegExp(DGOAL_TOKEN_SOURCE, "i");
const NATURAL_START_META_PATTERN = /(?:解释|含义|意思|示例|举例|讨论|分析|比较|评审|审查|为什么|为何|是否|能否|可否|可不可以|能不能|有没有|what\s+does|explain|example|discuss|whether|why|can\s+you|could\s+you|would\s+you|is\s+it|may\s+i|should\s+we)/i;
const NATURAL_START_NEGATED_PATTERN = new RegExp(
  String.raw`(?:不是(?:要|请)?|并非|不要|别|禁止|无需|不用|不准|没有授权|不(?:建议|推荐|允许|准备|打算|应该|应当|该)?|do\s+not|don't|never|must\s+not|should\s+not|without|not\s+going\s+to)\s*(?:(?:现在|再|继续|立即|直接|你|在本轮|currently|now|ever)\s*)*(?:用|使用|启动|开启|运行|执行|start|use|run|launch)?\s*${DGOAL_TOKEN_SOURCE}`,
  "i",
);
const NATURAL_START_PREFIX_SOURCE = String.raw`(?:(?:(?:请|麻烦|直接|现在|接下来|继续|再|我授权你|我同意你|你可以|可以|帮我)\s*){0,3}|而是\s*(?:(?:需要|希望|要)\s*)?(?:请\s*)?你(?:自己)?\s*)`;
const NATURAL_START_DIRECTIVE_PATTERNS = [
  new RegExp(String.raw`^${NATURAL_START_PREFIX_SOURCE}(?:用|使用|启动|开启|进入|运行|执行)(?:一下|下)?\s*${DGOAL_TOKEN_SOURCE}`, "i"),
  new RegExp(String.raw`^${NATURAL_START_PREFIX_SOURCE}(?:让|交给)\s*${DGOAL_TOKEN_SOURCE}\s*(?:来)?\s*(?:开始(?:工作)?|处理|完成|执行|解决|做|工作)`, "i"),
  new RegExp(String.raw`^${DGOAL_TOKEN_SOURCE}(?:\s*(?:模式|工作流|workflow))?\s*[,，]?\s*(?:开始(?:工作)?|启动|运行|执行|处理|工作|start|run|work)`, "i"),
  new RegExp(String.raw`^(?:(?:please|now|go\s+ahead\s+and|you\s+(?:may|can)|i\s+authorize\s+you\s+to)\s+){0,3}(?:use|start|launch|run|activate|enter)\s+(?:the\s+)?${DGOAL_TOKEN_SOURCE}(?:\s+(?:workflow|mode))?\b`, "i"),
];

function stripQuotedNaturalStartExamples(text: string): string {
  return text.replace(/```[\s\S]*?```|`[^`]*`|“[^”]*”|‘[^’]*’|「[^」]*」|『[^』]*』|"[^"]*"|'[^']*'/g, " ");
}

function naturalStartClauseIsDirective(clause: string, question: boolean): boolean {
  const trimmed = clause.trim();
  const dgoalIndex = trimmed.search(DGOAL_TOKEN_PATTERN);
  if (!trimmed || dgoalIndex < 0 || question || NATURAL_START_NEGATED_PATTERN.test(trimmed)) return false;
  if (NATURAL_START_META_PATTERN.test(trimmed.slice(0, dgoalIndex))) return false;
  return NATURAL_START_DIRECTIVE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export function isNaturalLanguageDgoalStartRequest(text: string): boolean {
  const unquoted = stripQuotedNaturalStartExamples(text);
  const sentences: string[] = unquoted.match(/[^。！？!?；;\r\n]+[。！？!?；;]?/g) ?? [];
  return sentences.some((rawSentence) => {
    const question = /[？?]\s*$/.test(rawSentence) || /(?:吗|么|呢)\s*[？?]?\s*$/.test(rawSentence);
    const sentence = rawSentence.replace(/[。！？!?；;]+\s*$/, "").trim();
    if (naturalStartClauseIsDirective(sentence, question)) return true;
    return !question && sentence.split(/[，,]+/).some((clause) => naturalStartClauseIsDirective(clause, false));
  });
}

export function buildNaturalLanguageStartGuidance(): string {
  return "<dgoal_natural_language_start>\n用户在本轮明确要求启动 /dgoal。请根据真实保障需求推荐 Goal Check Plan（只做 goal_check）或 Staged Check Plan（逐 Phase phase_check + goal_check），并调用 goal_plan / staged_plan 提交显式提案；两者都经过语义预审与用户确认。\n</dgoal_natural_language_start>";
}

export function buildWorkListDefaultGuidance(): string {
  return "<work_list_default>\n普通多步工作先用 work_list 建立唯一软性清单；清单跨 turn 保留，但不自动续跑。确实需要 Until Done 时用 execution_plan 在同一 Work List 上增加执行保障。需要独立终审或逐 Phase 建检时，说明理由并请用户显式授权 /dgoal；未经授权不得调用 goal_plan 或 staged_plan。纯讨论、解释、单步回答不建清单。\n</work_list_default>";
}

export function registerDgoal(pi: ExtensionAPI) {
  setApi(pi);
  setupI18n(pi);
  pi.registerTool(workListTool);
  pi.registerTool(executionPlanTool);
  pi.registerTool(goalPlanTool);
  pi.registerTool(stagedPlanTool);
  pi.registerTool(workCreateTool);
  pi.registerTool(workReadTool);
  pi.registerTool(workUpdateTool);
  pi.registerTool(phaseCheckTool);
  pi.registerTool(goalCheckTool);

  pi.registerCommand("dgoal", {
    description: t("command.description"),
    handler: (args, ctx) => handleDgoalCommand(args, pi, ctx),
  });

  pi.on("session_start", (event, ctx) => {
    clearNaturalLanguageStartAuthorization();
    clearExplicitPlanUpgradeAuthorization();
    clearExecutionPlanModelErrorRecovery();
    if (event.reason === "reload") clearAuditorModelRegistryCache();
    resyncGoalFromSession(ctx);
  });

  // /tree（navigateTree）原地切 session 分支：不发 session_shutdown/session_start，
  // 只发 session_tree 通知。不重同步会导致 goalRuntimeState.currentGoal 停在旧分支、overlay 显示陈旧状态
  // （阶段明明完成了还显示未完成，计时器也冻住）。与 session_start 复用同一套重同步。
  pi.on("session_tree", (_event, ctx) => {
    clearNaturalLanguageStartAuthorization();
    clearExplicitPlanUpgradeAuthorization();
    clearExecutionPlanModelErrorRecovery();
    resyncGoalFromSession(ctx);
  });

  // 会话压缩完成后主会话上下文可能重建，但 dgoal 状态仍在 custom entry；先重同步。
  // resync 会取消旧 continuation（它可能引用压缩前上下文）；若 Pi 不会自行重试当前 turn，
  // 必须为仍 active 的 goal 排入新 continuation，避免 Plan 保持计时却没有下一轮三选一决策。
  pi.on("session_compact", async (event, ctx) => {
    clearExecutionPlanModelErrorRecovery();
    clearExplicitPlanUpgradeAuthorization();
    resyncGoalFromSession(ctx);
    const goal = goalRuntimeState.currentGoal;
    if (goal && hasPlanContract(goal) && isGoalRunning(goal.status) && !event.willRetry) await sendContinuation(pi, ctx, goal);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    clearNaturalLanguageStartAuthorization();
    clearExplicitPlanUpgradeAuthorization();
    clearExecutionPlanModelErrorRecovery();
    if (goalRuntimeState.currentGoal) persistWorkGoal(goalRuntimeState.currentGoal);
    clearContinuation();
    clearCurrentCheckSnapshot();
    resetAuditorWorkspaceTracker();
    disposePlanOverlay();
    safeSetDgoalStatus(ctx, undefined);
  });

  pi.on("input", (event) => {
    if (event.source === "extension") {
      clearNaturalLanguageStartAuthorization();
      clearExplicitPlanUpgradeAuthorization();
      clearExecutionPlanModelErrorRecovery();
      if (consumeCancelledContinuation(event.text)) return { action: "handled" as const };
      return;
    }
    if (event.source !== "interactive" && event.source !== "rpc") {
      clearNaturalLanguageStartAuthorization();
      clearExplicitPlanUpgradeAuthorization();
      clearExecutionPlanModelErrorRecovery();
      return;
    }
    const directUserInput = event.streamingBehavior === undefined;
    const pausedExecutionPlan = goalRuntimeState.currentGoal;
    if (directUserInput && pausedExecutionPlan?.status === "paused" && pausedExecutionPlan.pauseReason === "model_error"
      && isExecutionPlan(pausedExecutionPlan)) {
      authorizeExecutionPlanModelErrorRecovery(pausedExecutionPlan.id, event.text);
    } else {
      clearExecutionPlanModelErrorRecovery();
    }
    const currentWorkUpgrade = Boolean(goalRuntimeState.currentGoal?.workList && goalRuntimeState.currentGoal.status === "active"
      && goalRuntimeState.currentGoal.contract?.profile !== "staged_check");
    const authorized = directUserInput
      && (!goalRuntimeState.currentGoal || currentWorkUpgrade)
      && isNaturalLanguageDgoalStartRequest(event.text);
    if (authorized) authorizeNaturalLanguageStart(event.text);
    else clearNaturalLanguageStartAuthorization();
  });

  pi.on("before_agent_start", async (event, ctx) => {
    markContinuationDelivered(event.prompt);
    // 真实 interactive/RPC 输入可一次性恢复同一个 paused(model_error) Execution Plan。
    const recovery = goalRuntimeState.executionPlanModelErrorRecovery;
    const recoveryGoal = goalRuntimeState.currentGoal;
    const shouldRecoverExecutionPlan = Boolean(recovery
      && recoveryGoal?.id === recovery.goalId
      && recoveryGoal.status === "paused"
      && recoveryGoal.pauseReason === "model_error"
      && isExecutionPlan(recoveryGoal)
      && event.prompt === recovery.input);
    clearExecutionPlanModelErrorRecovery();
    if (shouldRecoverExecutionPlan) resumeExecutionPlanAfterModelErrorFromUserInput(ctx);
    // 只接受 dgoal input handler 观察到的文本；后加载扩展若 transform 了 prompt，精确绑定会 fail-closed。
    if (!goalRuntimeState.currentGoal && goalRuntimeState.naturalLanguageStartAuthorized
      && event.prompt !== goalRuntimeState.naturalLanguageStartInput) {
      clearNaturalLanguageStartAuthorization();
    }
    // 只有 Plan Contract 进入结构化活性统计；软性 Work List 只跨 turn 保留。
    beginProgressTurn(goalRuntimeState, hasPlanContract(goalRuntimeState.currentGoal) ? goalRuntimeState.currentGoal : undefined);
    if (goalRuntimeState.currentGoal) {
      if (isGoalRunning(goalRuntimeState.currentGoal.status)) {
        const context = goalRuntimeState.currentGoal.contract
          ? buildPlanContractContext(goalRuntimeState.currentGoal)
          : buildSoftWorkListContext(goalRuntimeState.currentGoal);
        return { systemPrompt: `${event.systemPrompt}\n\n${context}` };
      }
      return;
    }

    // Cold sessions expose the unprivileged Work List default; explicit /dgoal authorization adds checked Plan entry guidance.
    const guidance = [buildWorkListDefaultGuidance()];
    if (goalRuntimeState.naturalLanguageStartAuthorized) guidance.push(buildNaturalLanguageStartGuidance());
    return {
      systemPrompt: `${event.systemPrompt}\n\n${guidance.join("\n\n")}`,
    };
  });

  pi.on("agent_settled", () => {
    clearNaturalLanguageStartAuthorization();
    clearExplicitPlanUpgradeAuthorization();
  });

  pi.on("tool_execution_start", (event, ctx) => {
    trackFileToolExecutionStart(event.toolCallId, event.toolName, event.args, ctx.cwd);
    // 任意工具只证明有 activity；是否产生 durable progress 在成功结束或 agent_end 状态差中判断。
    recordToolActivity(goalRuntimeState);
  });

  // Plan/check tools refresh the persistent projection after successful state changes.
  pi.on("tool_execution_end", (event) => {
    trackFileToolExecutionEnd(event.toolCallId, event.isError);
    if (event.isError) return;
    // edit/write 与真正写出 approved/rejected 的独立 check 终态是明确持久结果；bash/未知工具不解析语义。
    const details = event.result && typeof event.result === "object"
      ? (event.result as { details?: unknown }).details
      : undefined;
    const hasCheckTerminal = (event.toolName === PHASE_CHECK_TOOL_NAME || event.toolName === GOAL_CHECK_TOOL_NAME)
      && Boolean(details && typeof details === "object" && typeof (details as { approved?: unknown }).approved === "boolean");
    if (event.toolName === "edit" || event.toolName === "write" || hasCheckTerminal) {
      recordDurableProgress(goalRuntimeState);
    }
    // 成功工具推进证明模型仍可调用工具；不把短暂 fetch 失败跨进展累计。
    goalRuntimeState.consecutiveErrors = 0;
    const refreshTools = new Set([
      WORK_LIST_TOOL_NAME,
      EXECUTION_PLAN_TOOL_NAME,
      GOAL_PLAN_TOOL_NAME,
      STAGED_PLAN_TOOL_NAME,
      WORK_CREATE_TOOL_NAME,
      WORK_UPDATE_TOOL_NAME,
      PHASE_CHECK_TOOL_NAME,
      GOAL_CHECK_TOOL_NAME,
    ]);
    if (refreshTools.has(event.toolName)) safeUpdatePlanOverlay();
  });

  async function handleAgentEnd(event: { messages: unknown[] }, ctx: DgoalContext) {
    // 启动闸门阶段（Goal pending）——主代理应调 goal_plan 或 staged_plan 提交提案。
    // startGoal 初始化期间被中断的 agent_end 不与本函数自己的 propose 投递撞车。
    const gateGoal = goalRuntimeState.currentGoal;
    const hasPendingProposal = Boolean(gateGoal && goalRuntimeState.pendingProposal?.goalId === gateGoal.id);
    if (gateGoal && (gateGoal.status === "pending" || hasPendingProposal)) {
      if (gateGoal.status === "pending" && goalRuntimeState.startGoalInProgress) return;
      await handleStartupGate(pi, ctx, gateGoal);
      return;
    }

    if (!goalRuntimeState.currentGoal || !isGoalRunning(goalRuntimeState.currentGoal.status)) return;

    // 软性 Work List 只保留结构化事实，不参与 Until Done、重试或 no-progress 熔断。
    if (goalRuntimeState.currentGoal.workList && !goalRuntimeState.currentGoal.contract) {
      clearContinuation();
      resetProgressStreaks(goalRuntimeState);
      return;
    }

    const finalAssistant = findFinalAssistantMessage(event.messages);
    const errorDetail = finalAssistant?.errorMessage ? `：${truncate(finalAssistant.errorMessage)}` : "";

    // Execution Plan 下用户中断当前响应只停止这一轮；清掉旧 continuation，下一条真实输入可继续。
    if (finalAssistant?.stopReason === "aborted" && isExecutionPlan(goalRuntimeState.currentGoal)) {
      goalRuntimeState.consecutiveErrors = 0;
      resetProgressStreaks(goalRuntimeState);
      clearContinuation();
      return;
    }

    // 显式 dgoal 的用户中断：不重试，直接暂停，保留用户对高保障 Plan 的停止权。
    if (finalAssistant?.stopReason === "aborted") {
      goalRuntimeState.consecutiveErrors = 0;
      resetProgressStreaks(goalRuntimeState);
      commitCurrentGoal(markGoalPaused(goalRuntimeState.currentGoal, Date.now(), { pauseReason: "user_abort" }), persistActiveGoal);
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
      // 模型错误打断“连续正常空转”序列：不是正常结束，重置两类无进展计数。
      resetProgressStreaks(goalRuntimeState);
      if (goalRuntimeState.consecutiveErrors < MAX_ERROR_RETRIES) {
        if (goalRuntimeState.consecutiveErrors >= MODEL_ERROR_WARNING_THRESHOLD) {
          safeNotify(
            ctx,
            t("notify.modelRetry", { count: goalRuntimeState.consecutiveErrors, max: MAX_ERROR_RETRIES, detail: errorDetail }),
            "warning",
          );
        }
        await sendContinuation(pi, ctx, goalRuntimeState.currentGoal);
        return;
      }
      // 暂停后该 proposal 已失去当前 agent turn 的上下文，不能随暂停状态一起恢复。
      goalRuntimeState.pendingProposal = undefined;
      const retryCount = Math.max(0, goalRuntimeState.consecutiveErrors - 1);
      goalRuntimeState.consecutiveErrors = 0;
      commitCurrentGoal(markGoalPaused(goalRuntimeState.currentGoal, Date.now(), { pauseReason: "model_error" }), persistActiveGoal);
      clearContinuation();
      safeSetDgoalStatus(ctx, formatStatus(goalRuntimeState.currentGoal));
      safeUpdatePlanOverlay();
      safeNotify(
        ctx,
        t("notify.modelPaused", { count: retryCount, detail: errorDetail }),
        "warning",
      );
      return;
    }

    // length/toolUse/缺失原因保留原有续跑行为，继续下一次模型执行。
    if (finalAssistant?.stopReason !== "stop") {
      goalRuntimeState.consecutiveErrors = 0;
      resetProgressStreaks(goalRuntimeState);
      commitCurrentGoal({ ...goalRuntimeState.currentGoal, iteration: goalRuntimeState.currentGoal.iteration + 1, updatedAt: Date.now() }, persistActiveGoal);
      safeSetDgoalStatus(ctx, formatStatus(goalRuntimeState.currentGoal));
      await sendContinuation(pi, ctx, goalRuntimeState.currentGoal);
      return;
    }

    // 正常完成一轮：仅依据成功文件副作用与 Plan 结构差判断 durable progress。
    goalRuntimeState.consecutiveErrors = 0;
    const progress = completeProgressTurn(goalRuntimeState, goalRuntimeState.currentGoal);
    if (progress.pause) {
      commitCurrentGoal(markGoalPaused(goalRuntimeState.currentGoal, Date.now(), { pauseReason: "no_progress" }), persistActiveGoal);
      clearContinuation();
      safeSetDgoalStatus(ctx, formatStatus(goalRuntimeState.currentGoal));
      safeUpdatePlanOverlay();
      const activityOnly = progress.pauseKind === "activity_only";
      safeNotify(ctx, t(activityOnly ? "notify.stalledProgressPaused" : "notify.noProgressPaused", {
        max: activityOnly ? MAX_STALLED_PROGRESS_TURNS : MAX_NO_PROGRESS_TURNS,
        detail: buildNoProgressDetail(goalRuntimeState.currentGoal),
      }), "warning");
      return;
    }
    commitCurrentGoal({ ...goalRuntimeState.currentGoal, iteration: goalRuntimeState.currentGoal.iteration + 1, updatedAt: Date.now() }, persistActiveGoal);
    safeSetDgoalStatus(ctx, formatStatus(goalRuntimeState.currentGoal));

    await sendContinuation(pi, ctx, goalRuntimeState.currentGoal);
  }

  pi.on("agent_end", handleAgentEnd);
}
