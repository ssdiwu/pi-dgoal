// Goal Runtime 独占可变会话状态（ADR 0025）。
// 当前 goal、pending proposal、续跑、计数器、终审反馈、修复账本等所有可变 session 状态
// 集中在此模块的单例对象中。其他模块只通过此对象读写状态，不自行维护可变 session 状态。

import type { GoalState, PlanProposal, PlanRunHistoryRecord } from "./types.ts";

export type CheckLivenessState =
  | "starting"
  | "thinking"
  | "tool_running"
  | "report_streaming"
  | "approved"
  | "rejected"
  | "auditor_error";

export interface CheckLivenessSnapshot {
  liveness: CheckLivenessState;
  currentTool?: string;
  lastSnippet?: string;
  idleSecondsLeft?: number;
  idleSecondsTotal?: number;
  attempt?: number;
  attemptTotal?: number;
}

export interface PendingFileToolExecution {
  toolName: "read" | "write" | "edit";
  path: string;
}

export interface ContinuationState {
  goalId: string;
  marker: string;
  /** Ephemeral session generation captured when scheduling; never persisted, but encoded into the continuation marker. */
  sessionGeneration: number;
  sent: boolean;
}

export interface PendingProposalState {
  goalId: string;
  proposal: PlanProposal;
  /** Hash of the existing Goal/Work List/Contract this upgrade was derived from. Absent only for a new pending Goal. */
  baseFingerprint?: string;
}

export interface GoalRuntimeGuardSnapshot {
  pendingProposal: PendingProposalState | undefined;
  sessionGeneration: number;
  goalId: string;
  goalStatus: GoalState["status"];
  goalUpdatedAt: number;
  pauseReason: GoalState["pauseReason"];
  contractId?: string;
  revision?: number;
}

export type PendingPlanDelivery =
  | {
    kind: "start" | "resume";
    marker: string;
    cleanPrompt: string;
    prompt: string;
    phase: "queued" | "sent" | "input_observed" | "preflight_validated";
    guard: GoalRuntimeGuardSnapshot;
    targetGoal: GoalState;
    /** Safe durable checkpoint written at input interception before START is allowed onward. */
    preparedCheckpoint?: GoalState;
  }
  | {
    kind: "feedback";
    marker: string;
    cleanPrompt: string;
    prompt: string;
    phase: "queued" | "sent" | "input_observed" | "preflight_validated";
    guard: GoalRuntimeGuardSnapshot;
    preserveExistingWorkGoal: boolean;
  };

export interface PlanDeliveryRun {
  outcome: "accepted" | "rejected";
  prompt: string;
  kind?: PendingPlanDelivery["kind"];
}

export interface ProposalFeedbackFlow {
  goalId: string;
  sessionGeneration: number;
  baseline: PendingProposalState;
}

export interface UncertainSessionScope {
  sessionId: string;
  branchAnchorMode: "contains_entry" | "exact_leaf";
  originEntryId?: string;
  originEntryIds?: string[];
  exactLeafId?: string | null;
}

export interface DurabilityQuarantine {
  sessionId?: string;
  sessionGeneration?: number;
  /** contains_entry survives descendants on the same branch; exact_leaf prevents ancestor/sibling ambiguity. */
  branchAnchorMode?: "contains_entry" | "exact_leaf";
  originEntryId?: string;
  /** All leaves that may contain an uncertain append from this transition. */
  originEntryIds?: string[];
  exactLeafId?: string | null;
  safeGoal?: GoalState;
  unsafeGoal?: GoalState;
  safePendingProposal?: PendingProposalState;
  unsafePendingProposal?: PendingProposalState;
}

export interface ProposalReviewLock {
  pending: PendingProposalState;
}
export interface ExecutionPlanModelErrorRecoveryAuthorization {
  goalId: string;
  input: string;
}

export interface PendingExecutionPlanUserResume {
  prompt: string;
  guard: GoalRuntimeGuardSnapshot;
  targetGoal: GoalState;
}

export interface ExecutionPlanUserResumeRun {
  prompt: string;
  outcome: "accepted" | "rejected";
}


export interface GoalRuntimeState {
  currentGoal: GoalState | undefined;
  pendingProposal: PendingProposalState | undefined;
  /** Fresh proposal/start authorization for the current process only. Restored proposals require explicit /dgoal review. */
  startupGateGoalId: string | undefined;
  /** Unique per-dialog lock. Prevents an older dialog from releasing a newer review of the same proposal object. Never persisted. */
  proposalReviewInProgress: ProposalReviewLock | undefined;
  /** Read-only terminal Plan Run snapshots for the current Pi session branch. */
  planHistory: PlanRunHistoryRecord[];
  proposalRetryCount: number;
  startGoalInProgress: boolean;
  /** One-shot authorization from the latest user input observed by dgoal that explicitly asks to use/start dgoal. */
  naturalLanguageStartAuthorized: boolean;
  /** Exact observed input, used to reject later input-transform changes before agent start. Never persisted. */
  naturalLanguageStartInput: string | undefined;
  /** Explicit /dgoal command authorization to upgrade the current Work List without replacing it first. */
  explicitPlanUpgradeGoalId: string | undefined;
  /** One-shot real-user authorization to resume the same Execution Plan after model_error. Never persisted. */
  executionPlanModelErrorRecovery: ExecutionPlanModelErrorRecoveryAuthorization | undefined;
  /** Exact real-user model_error recovery waiting for cancellable user message_end commit. */
  pendingExecutionPlanUserResume: PendingExecutionPlanUserResume | undefined;
  /** Direct recovery run retained through agent_settled so a session switch can abort stale Plan context. */
  executionPlanUserResumeRun: ExecutionPlanUserResumeRun | undefined;
  consecutiveErrors: number;
  /** Consecutive normal turns with no tool execution at all. */
  consecutiveNoProgressTurns: number;
  /** Consecutive normal turns with no durable file/Plan progress, including pure idle turns. */
  consecutiveNoDurableProgressTurns: number;
  turnHadToolExecution: boolean;
  turnHadDurableProgress: boolean;
  turnStartProgressFingerprint: string | undefined;
  pendingContinuation: ContinuationState | undefined;
  continuationDeliveryTimer: ReturnType<typeof setTimeout> | undefined;
  cancelledMarkers: Set<string>;
  /** A START/resume/feedback state change waiting for the host to observe its marked extension input. */
  pendingPlanDelivery: PendingPlanDelivery | undefined;
  /** The marked run currently crossing Pi's agent_start/message_end boundary. */
  planDeliveryRun: PlanDeliveryRun | undefined;
  /** Markers invalidated by session switches or replacement requests; late host inputs are consumed. */
  cancelledPlanDeliveryMarkers: Set<string>;
  /** Exact transformed prompts rejected at preflight and waiting for cancellable user message_end. */
  rejectedPlanDeliveryPrompts: Map<string, number>;
  /** Run-order rejection tokens for later message_end transforms that no longer preserve the rejected prompt text. */
  rejectedPlanDeliveryRuns: number;
  /** Old proposal retained until feedback produces and durably supersedes it. */
  proposalFeedbackBaseline: PendingProposalState | undefined;
  /** Tracks one feedback rewrite turn so agent_end never falls through into Plan execution continuation. */
  proposalFeedbackFlow: ProposalFeedbackFlow | undefined;
  /** Fail-closed checkpoint used when appendEntry may have changed the branch before throwing. */
  durabilityQuarantines: DurabilityQuarantine[];
  /** Branch-scoped fork markers whose append may have advanced SessionManager memory without durable persistence. */
  uncertainSessionScopes: UncertainSessionScope[];
  latestSuccessfulModifiedFilePath: string | undefined;
  latestSuccessfulReadFilePath: string | undefined;
  pendingFileToolExecutions: Map<string, PendingFileToolExecution>;
  currentCheckSnapshot: CheckLivenessSnapshot | undefined;
  /** Increments before every session/tree resync attempt; even a stale read must invalidate old async work. */
  sessionGeneration: number;
  /** False after a stale/failed resync or shutdown; mutation paths must fail closed. */
  sessionProjectionValid: boolean;
  /** Closes a status modal whose captured Goal/History belongs to an invalidated session projection. */
  dismissStatusDialog: (() => void) | undefined;
}

function createInitialGoalRuntimeState(): GoalRuntimeState {
  return {
    currentGoal: undefined,
    pendingProposal: undefined,
    startupGateGoalId: undefined,
    proposalReviewInProgress: undefined,
    planHistory: [],
    proposalRetryCount: 0,
    startGoalInProgress: false,
    naturalLanguageStartAuthorized: false,
    naturalLanguageStartInput: undefined,
    explicitPlanUpgradeGoalId: undefined,
    executionPlanModelErrorRecovery: undefined,
    pendingExecutionPlanUserResume: undefined,
    executionPlanUserResumeRun: undefined,
    consecutiveErrors: 0,
    consecutiveNoProgressTurns: 0,
    consecutiveNoDurableProgressTurns: 0,
    turnHadToolExecution: false,
    turnHadDurableProgress: false,
    turnStartProgressFingerprint: undefined,
    pendingContinuation: undefined,
    continuationDeliveryTimer: undefined,
    cancelledMarkers: new Set(),
    pendingPlanDelivery: undefined,
    planDeliveryRun: undefined,
    cancelledPlanDeliveryMarkers: new Set(),
    rejectedPlanDeliveryPrompts: new Map(),
    rejectedPlanDeliveryRuns: 0,
    proposalFeedbackBaseline: undefined,
    proposalFeedbackFlow: undefined,
    durabilityQuarantines: [],
    uncertainSessionScopes: [],
    latestSuccessfulModifiedFilePath: undefined,
    latestSuccessfulReadFilePath: undefined,
    pendingFileToolExecutions: new Map(),
    currentCheckSnapshot: undefined,
    sessionGeneration: 0,
    sessionProjectionValid: true,
    dismissStatusDialog: undefined,
  };
}

// 单例：整个进程生命周期内只有一个 Goal Runtime 状态实例。
export const goalRuntimeState: GoalRuntimeState = createInitialGoalRuntimeState();

export function authorizeNaturalLanguageStart(input: string): void {
  goalRuntimeState.naturalLanguageStartAuthorized = true;
  goalRuntimeState.naturalLanguageStartInput = input;
}

export function clearNaturalLanguageStartAuthorization(): void {
  goalRuntimeState.naturalLanguageStartAuthorized = false;
  goalRuntimeState.naturalLanguageStartInput = undefined;
}

export function authorizeExplicitPlanUpgrade(goalId: string): void {
  goalRuntimeState.explicitPlanUpgradeGoalId = goalId;
}

export function clearExplicitPlanUpgradeAuthorization(): void {
  goalRuntimeState.explicitPlanUpgradeGoalId = undefined;
}

export function authorizeExecutionPlanModelErrorRecovery(goalId: string, input: string): void {
  goalRuntimeState.executionPlanModelErrorRecovery = { goalId, input };
}

export function clearExecutionPlanModelErrorRecovery(): void {
  goalRuntimeState.executionPlanModelErrorRecovery = undefined;
}

// 重置全部可变状态（测试 / session_shutdown 用）。
export function resetGoalRuntimeState(): void {
  // 先清理 timer 再 Object.assign：Object.assign 会用 fresh（timer=undefined）覆盖，
  // 如果先 assign 再检查，timer 引用已丢失，clearTimeout 永远不执行，活跃 timer 泄漏。
  if (goalRuntimeState.continuationDeliveryTimer) {
    clearTimeout(goalRuntimeState.continuationDeliveryTimer);
  }
  Object.assign(goalRuntimeState, createInitialGoalRuntimeState());
}
