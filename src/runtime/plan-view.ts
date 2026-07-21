import { countDoneTasks, flattenTasks, isDonePlanStatus, type Phase, type Task } from "../plan/index.ts";
import type { GoalState } from "../goal-runtime/types.ts";

export interface PlanViewModel {
  planType: "task" | "phase" | "goal";
  phases: Phase[];
  tasks: Task[];
  taskPlanTasks: Task[];
  donePhases: number;
  totalPhases: number;
  doneTasks: number;
  totalTasks: number;
}

/** Shared read model for public tool, widget, and modal progress projections. */
export function derivePlanView(goal: Pick<GoalState, "plan" | "planType">): PlanViewModel | undefined {
  if (!goal.plan || goal.plan.phases.length === 0) return undefined;
  const planType = goal.planType ?? "goal";
  const phases = goal.plan.phases;
  const tasks = flattenTasks(goal.plan);
  const taskPlanTasks = Array.isArray(phases[0]?.tasks) ? phases[0].tasks : [];
  return {
    planType,
    phases,
    tasks,
    taskPlanTasks,
    donePhases: phases.filter((phase) => isDonePlanStatus(phase.status)).length,
    totalPhases: phases.length,
    doneTasks: phases.reduce((sum, phase) => sum + countDoneTasks(phase), 0),
    totalTasks: tasks.length,
  };
}

export function formatPlanProgress(view: PlanViewModel): string {
  return view.planType === "task"
    ? `${view.doneTasks}/${view.totalTasks} tasks`
    : `${view.donePhases}/${view.totalPhases} phases · ${view.doneTasks}/${view.totalTasks} tasks`;
}

export function formatCompactPlanProgress(view: PlanViewModel): string {
  return view.planType === "task"
    ? `${view.doneTasks}/${view.totalTasks}`
    : `${view.donePhases}/${view.totalPhases}p ${view.doneTasks}/${view.totalTasks}t`;
}
