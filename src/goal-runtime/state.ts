// Goal Runtime 独占可变会话状态（ADR 0025）。
// 当前 goal、pending proposal、续跑、计数器、终审反馈、修复账本等所有可变 session 状态
// 集中在此模块的单例对象中。其他模块只通过此对象读写状态，不自行维护可变 session 状态。

import type { GoalState, PlanProposal } from "../plan/index.ts";

export interface ContinuationState {
  goalId: string;
  marker: string;
  sent: boolean;
}

export interface PendingProposalState {
  goalId: string;
  proposal: PlanProposal;
  /** Only true when this proposal passed the global-only implicit-start gate. */
  implicitStart?: boolean;
}

export interface GoalRuntimeState {
  currentGoal: GoalState | undefined;
  pendingProposal: PendingProposalState | undefined;
  proposalRetryCount: number;
  startGoalInProgress: boolean;
  /** One-shot authorization from the latest user input observed by dgoal that explicitly asks to use/start dgoal. */
  naturalLanguageStartAuthorized: boolean;
  /** Exact observed input, used to reject later input-transform changes before agent start. Never persisted. */
  naturalLanguageStartInput: string | undefined;
  consecutiveErrors: number;
  consecutiveNoProgressTurns: number;
  turnHadToolExecution: boolean;
  pendingContinuation: ContinuationState | undefined;
  continuationDeliveryTimer: ReturnType<typeof setTimeout> | undefined;
  cancelledMarkers: Set<string>;
  latestSuccessfulModifiedFilePath: string | undefined;
  latestSuccessfulReadFilePath: string | undefined;
}

function createInitialGoalRuntimeState(): GoalRuntimeState {
  return {
    currentGoal: undefined,
    pendingProposal: undefined,
    proposalRetryCount: 0,
    startGoalInProgress: false,
    naturalLanguageStartAuthorized: false,
    naturalLanguageStartInput: undefined,
    consecutiveErrors: 0,
    consecutiveNoProgressTurns: 0,
    turnHadToolExecution: false,
    pendingContinuation: undefined,
    continuationDeliveryTimer: undefined,
    cancelledMarkers: new Set(),
    latestSuccessfulModifiedFilePath: undefined,
    latestSuccessfulReadFilePath: undefined,
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

// 重置全部可变状态（测试 / session_shutdown 用）。
export function resetGoalRuntimeState(): void {
  // 先清理 timer 再 Object.assign：Object.assign 会用 fresh（timer=undefined）覆盖，
  // 如果先 assign 再检查，timer 引用已丢失，clearTimeout 永远不执行，活跃 timer 泄漏。
  if (goalRuntimeState.continuationDeliveryTimer) {
    clearTimeout(goalRuntimeState.continuationDeliveryTimer);
  }
  Object.assign(goalRuntimeState, createInitialGoalRuntimeState());
}
