import { goalRuntimeState } from "./state.ts";
import type { GoalState } from "./types.ts";

export type PersistGoalState = (goal: GoalState | null) => void;

/** Keep the in-memory goal assignment and its persisted counterpart adjacent. */
export function commitCurrentGoal(goal: GoalState, persist: PersistGoalState): GoalState {
  goalRuntimeState.currentGoal = goal;
  persist(goal);
  return goal;
}

/** Clear the active in-memory goal and persist the empty active-plan state. */
export function clearCurrentGoal(persist: PersistGoalState): void {
  goalRuntimeState.currentGoal = undefined;
  persist(null);
}
