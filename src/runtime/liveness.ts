import type { GoalRuntimeState } from "../goal-runtime/state.ts";
import type { GoalState } from "../goal-runtime/types.ts";

export const MAX_NO_PROGRESS_TURNS = 3;
export const MAX_STALLED_PROGRESS_TURNS = 8;

export type NoProgressPauseKind = "no_tool" | "activity_only";

type ProgressRuntimeState = Pick<
  GoalRuntimeState,
  | "consecutiveNoProgressTurns"
  | "consecutiveNoDurableProgressTurns"
  | "turnHadToolExecution"
  | "turnHadDurableProgress"
  | "turnStartProgressFingerprint"
>;

export interface NoProgressDecision {
  continue_: boolean;
  newCount: number;
  newNoDurableProgressCount: number;
  pause: boolean;
  pauseKind?: NoProgressPauseKind;
}

export function buildDurableProgressFingerprint(goal: GoalState | undefined): string | undefined {
  if (!goal) return undefined;
  return JSON.stringify({
    id: goal.id,
    status: goal.status,
    planType: goal.planType ?? "goal",
    phases: goal.plan?.phases.map((phase) => ({
      id: phase.id,
      status: phase.status,
      blockedReason: phase.blockedReason,
      tasks: phase.tasks.map((task) => ({
        id: task.id,
        status: task.status,
        blockedBy: task.blockedBy,
        evidence: task.evidence,
        blockedReason: task.blockedReason,
      })),
    })),
  });
}

export function buildContinuationProgressNudge(noToolTurns: number, stalledTurns: number): string {
  if (noToolTurns >= MAX_NO_PROGRESS_TURNS - 1) {
    return "\n\n已连续两轮没有调用工具。下一轮必须直接执行或委派当前合法任务；只有确实需要用户决策时，才用 plan_update(target=goal,status=paused,reason=...) 结构化暂停。不要只汇报状态。";
  }
  if (noToolTurns === 1) {
    return "\n\n上一轮没有调用工具。当前 task 有合法动作时请直接执行，不要只汇报尚未完成。";
  }
  if (stalledTurns >= Math.ceil(MAX_STALLED_PROGRESS_TURNS / 2)) {
    return `\n\n已连续 ${stalledTurns} 轮只有工具活动、没有观察到文件或 Plan 持久进展。不要重复读取或查询状态；请实施、委派 fresh worker，或在真实用户决策死锁时结构化暂停。`;
  }
  return "";
}

export function decideNoProgressPause(state: {
  hadToolExecution: boolean;
  hadDurableProgress: boolean;
  consecutiveNoProgress: number;
  consecutiveNoDurableProgress: number;
}): NoProgressDecision {
  if (state.hadDurableProgress) {
    return { continue_: true, newCount: 0, newNoDurableProgressCount: 0, pause: false };
  }
  const newCount = state.hadToolExecution ? 0 : state.consecutiveNoProgress + 1;
  const newNoDurableProgressCount = state.consecutiveNoDurableProgress + 1;
  const pauseKind = newCount >= MAX_NO_PROGRESS_TURNS
    ? "no_tool"
    : newNoDurableProgressCount >= MAX_STALLED_PROGRESS_TURNS
      ? "activity_only"
      : undefined;
  return {
    continue_: pauseKind === undefined,
    newCount,
    newNoDurableProgressCount,
    pause: pauseKind !== undefined,
    pauseKind,
  };
}

export function resetProgressStreaks(state: ProgressRuntimeState): void {
  state.consecutiveNoProgressTurns = 0;
  state.consecutiveNoDurableProgressTurns = 0;
}

export function resetProgressTurn(state: ProgressRuntimeState): void {
  state.turnHadToolExecution = false;
  state.turnHadDurableProgress = false;
  state.turnStartProgressFingerprint = undefined;
}

export function resetProgressTracking(state: ProgressRuntimeState): void {
  resetProgressStreaks(state);
  resetProgressTurn(state);
}

export function beginProgressTurn(state: ProgressRuntimeState, goal: GoalState | undefined): void {
  resetProgressTurn(state);
  state.turnStartProgressFingerprint = buildDurableProgressFingerprint(goal);
}

export function recordToolActivity(state: ProgressRuntimeState): void {
  state.turnHadToolExecution = true;
}

export function recordDurableProgress(state: ProgressRuntimeState): void {
  state.turnHadDurableProgress = true;
}

export function resetNoToolProgressStreak(state: ProgressRuntimeState): void {
  state.consecutiveNoProgressTurns = 0;
}

export function recordGoalProgressSince(
  state: ProgressRuntimeState,
  beforeFingerprint: string | undefined,
  goal: GoalState | undefined,
): void {
  if (buildDurableProgressFingerprint(goal) !== beforeFingerprint) recordDurableProgress(state);
}

export function completeProgressTurn(state: ProgressRuntimeState, goal: GoalState | undefined): NoProgressDecision {
  if (state.turnStartProgressFingerprint !== undefined) {
    recordGoalProgressSince(state, state.turnStartProgressFingerprint, goal);
  }
  const progress = decideNoProgressPause({
    hadToolExecution: state.turnHadToolExecution,
    hadDurableProgress: state.turnHadDurableProgress,
    consecutiveNoProgress: state.consecutiveNoProgressTurns,
    consecutiveNoDurableProgress: state.consecutiveNoDurableProgressTurns,
  });
  state.consecutiveNoProgressTurns = progress.newCount;
  state.consecutiveNoDurableProgressTurns = progress.newNoDurableProgressCount;
  return progress;
}
