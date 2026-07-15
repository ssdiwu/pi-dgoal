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
  loadDgoalConfig,
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
import {
  authorizeNaturalLanguageStart,
  clearNaturalLanguageStartAuthorization,
  goalRuntimeState,
} from "../goal-runtime/state.ts";

const DGOAL_TOKEN_SOURCE = String.raw`(?<![A-Za-z0-9_])\/?dgoal\b`;
const DGOAL_TOKEN_PATTERN = new RegExp(DGOAL_TOKEN_SOURCE, "i");
const NATURAL_START_META_PATTERN = /(?:解释|含义|意思|示例|举例|讨论|分析|比较|评审|审查|为什么|为何|是否|能否|可否|可不可以|能不能|有没有|what\s+does|explain|example|discuss|whether|why|can\s+you|could\s+you|would\s+you|is\s+it|may\s+i|should\s+we)/i;
const NATURAL_START_NEGATED_PATTERN = new RegExp(
  String.raw`(?:不是(?:要|请)?|并非|不要|别|禁止|无需|不用|不准|没有授权|不(?:建议|推荐|允许|准备|打算|应该|应当|该)?|do\s+not|don't|never|must\s+not|should\s+not|without|not\s+going\s+to)\s*(?:(?:现在|再|继续|立即|直接|你|在本轮|currently|now|ever)\s*)*(?:用|使用|启动|开启|运行|执行|start|use|run|launch)?\s*${DGOAL_TOKEN_SOURCE}`,
  "i",
);
const NATURAL_START_PREFIX_SOURCE = String.raw`(?:(?:请|麻烦|直接|现在|接下来|继续|再|我授权你|我同意你|你可以|可以|帮我)\s*){0,3}`;
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
  const sentences = unquoted.match(/[^。！？!?；;\r\n]+[。！？!?；;]?/g) ?? [];
  return sentences.some((rawSentence) => {
    const question = /[？?]\s*$/.test(rawSentence) || /(?:吗|么|呢)\s*[？?]?\s*$/.test(rawSentence);
    const sentence = rawSentence.replace(/[。！？!?；;]+\s*$/, "").trim();
    if (naturalStartClauseIsDirective(sentence, question)) return true;
    return !question && sentence.split(/[，,]+/).some((clause) => naturalStartClauseIsDirective(clause, false));
  });
}

export function buildNaturalLanguageStartGuidance(): string {
  return "<dgoal_natural_language_start>\n用户在本轮自然语言中明确要求使用或启动 dgoal。冷会话下可直接调用 dgoal_propose，不设置 implicit；运行时会创建 pending 显式目标，并保留语义预审与用户确认 UI。该路径可提交 phased / unbounded 或包含外部动作的计划，不要求用户补输 /dgoal。若任务同时满足全局隐式轻量边界，仍可选择 implicit=true。\n</dgoal_natural_language_start>";
}

export function buildImplicitStartGuidance(): string {
  return "<dgoal_implicit_start>\n全局已授权受限的隐式 dgoal 启动。只有用户明确要求启动 dgoal 时，才可直接调用 dgoal_propose 并设置 implicit=true；任务还必须具体、可独立验收，且不涉及破坏整个工作仓库或 .git、外部写入、发布、推送、权限或付费动作。隐式目标可运行本地测试、构建、脚本、项目文件修改与本地 Git 变更。必须使用 final_only + bounded，并提供可由命令/测试独立复验的 acceptanceCriteria。若用户已自然语言明确要求 dgoal、但任务不满足隐式边界，应调用 dgoal_propose 且不设置 implicit，进入显式 pending 确认路径；不要再要求用户补输 /dgoal。没有明确用户目标时不要自行启动。\n</dgoal_implicit_start>";
}

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
    clearNaturalLanguageStartAuthorization();
    if (event.reason === "reload") clearAuditorModelRegistryCache();
    resyncGoalFromSession(ctx);
  });

  // /tree（navigateTree）原地切 session 分支：不发 session_shutdown/session_start，
  // 只发 session_tree 通知。不重同步会导致 goalRuntimeState.currentGoal 停在旧分支、overlay 显示陈旧状态
  // （阶段明明完成了还显示未完成，计时器也冻住）。与 session_start 复用同一套重同步。
  pi.on("session_tree", (_event, ctx) => {
    clearNaturalLanguageStartAuthorization();
    resyncGoalFromSession(ctx);
  });

  // 会话压缩完成后主会话上下文可能重建，但 dgoal 状态仍在 custom entry；复用统一恢复路径。
  pi.on("session_compact", (_event, ctx) => {
    resyncGoalFromSession(ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    clearNaturalLanguageStartAuthorization();
    if (goalRuntimeState.currentGoal) persistGoal(goalRuntimeState.currentGoal);
    clearContinuation();
    clearCurrentCheckSnapshot();
    resetAuditorWorkspaceTracker();
    disposePlanOverlay();
    safeSetDgoalStatus(ctx, undefined);
  });

  pi.on("input", (event) => {
    if (event.source === "extension") {
      clearNaturalLanguageStartAuthorization();
      if (consumeCancelledContinuation(event.text)) return { action: "handled" as const };
      return;
    }
    if (event.source !== "interactive" && event.source !== "rpc") {
      clearNaturalLanguageStartAuthorization();
      return;
    }
    const authorized = !goalRuntimeState.currentGoal
      && event.streamingBehavior === undefined
      && isNaturalLanguageDgoalStartRequest(event.text);
    if (authorized) authorizeNaturalLanguageStart(event.text);
    else clearNaturalLanguageStartAuthorization();
  });

  pi.on("before_agent_start", async (event, ctx) => {
    markContinuationDelivered(event.prompt);
    // 只接受 dgoal input handler 观察到的文本；后加载扩展若 transform 了 prompt，精确绑定会 fail-closed。
    if (!goalRuntimeState.currentGoal && goalRuntimeState.naturalLanguageStartAuthorized
      && event.prompt !== goalRuntimeState.naturalLanguageStartInput) {
      clearNaturalLanguageStartAuthorization();
    }
    // 新 agent turn 重置本轮工具调用标记。
    goalRuntimeState.turnHadToolExecution = false;
    // Phase 是用户确认过的进度主干，完成后仍持久显示；不在 agent_start 自动隐藏。
    if (goalRuntimeState.currentGoal) {
      if (isGoalRunning(goalRuntimeState.currentGoal.status)) {
        return {
          systemPrompt: `${event.systemPrompt}\n\n${buildSystemPrompt(goalRuntimeState.currentGoal)}`,
        };
      }
      return;
    }

    // 冷启动时分别注入本轮自然语言显式授权与全局隐式授权；二者都仍经过 dgoal_propose 的结构/语义校验。
    const guidance: string[] = [];
    if (goalRuntimeState.naturalLanguageStartAuthorized) guidance.push(buildNaturalLanguageStartGuidance());
    const loaded = await loadDgoalConfig(ctx).catch(() => undefined);
    if (loaded?.globalConfig.implicitFinalOnlyStart) guidance.push(buildImplicitStartGuidance());
    if (!guidance.length) return;
    return {
      systemPrompt: `${event.systemPrompt}\n\n${guidance.join("\n\n")}`,
    };
  });

  pi.on("agent_settled", () => {
    if (!goalRuntimeState.currentGoal) clearNaturalLanguageStartAuthorization();
  });

  pi.on("tool_call", (event, ctx) => {
    // tool_call 是 Pi 保证的执行前 preflight；必须在这里 block，不能等 tool_execution_start 后再 abort。
    const goal = goalRuntimeState.currentGoal;
    if (!goal?.implicitStart || !isGoalRunning(goal.status)) return;
    const violation = validateImplicitToolAction(event.toolName, event.input, ctx.cwd);
    if (!violation) return;
    goalRuntimeState.currentGoal = markGoalPaused(goal, Date.now(), {
      pauseReason: "agent_blocked",
      pauseReasonDetail: violation,
    });
    persistGoal(goalRuntimeState.currentGoal);
    clearContinuation();
    safeSetDgoalStatus(ctx, formatStatus(goalRuntimeState.currentGoal));
    safeUpdatePlanOverlay();
    safeNotify(ctx, `Implicit dgoal paused: ${violation}. Use explicit /dgoal to authorize this action.`, "warning");
    return { block: true, reason: `Implicit dgoal blocked before execution: ${violation}` };
  });

  pi.on("tool_execution_start", (event, ctx) => {
    trackFileToolExecutionStart(event.toolCallId, event.toolName, event.args, ctx.cwd);
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

    // 每次 active goal 的主模型 agent_end 都计入执行预算；pending 启动闸门和用户主动中断不在此入口计数。
    // toolUse/length/error 也会触发后续模型执行，不能只统计 stop，否则会低估真实调用次数。
    if (finalAssistant?.stopReason !== "aborted" && consumeRuntimeBudget(ctx)) return;

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

    // length/toolUse/缺失原因保留原有续跑行为：继续下一次模型执行，但本轮预算已在 agent_end 入口计入。
    if (finalAssistant?.stopReason !== "stop") {
      goalRuntimeState.consecutiveErrors = 0;
      goalRuntimeState.consecutiveNoProgressTurns = 0;
      goalRuntimeState.currentGoal = { ...goalRuntimeState.currentGoal, iteration: goalRuntimeState.currentGoal.iteration + 1, updatedAt: Date.now() };
      persistGoal(goalRuntimeState.currentGoal);
      safeSetDgoalStatus(ctx, formatStatus(goalRuntimeState.currentGoal));
      await sendContinuation(pi, ctx, goalRuntimeState.currentGoal);
      return;
    }

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
