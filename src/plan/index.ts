// Task Plan domain primitives: shared types and pure status/dependency helpers.

export type PlanStatus = "pending" | "in_progress" | "done" | "blocked";
export type PlanType = "task" | "phase" | "goal";
export type CheckStatus = "approved" | "rejected" | "audit_error";

export interface CheckRecord {
  status: CheckStatus;
  report?: string;
  modelId?: string;
  checkedAt?: number;
  /** Plan revision that was checked. Any later mutation invalidates the approval. */
  revision?: number;
}

export function isDonePlanStatus(status: PlanStatus): boolean {
  return status === "done";
}

export interface AcceptanceCriterion {
  criterion: string;
  evidence: string;
}

export interface Task {
  id: number;
  subject: string;
  /** Why this task exists, how it serves the goal, and the chosen approach boundary. */
  description: string;
  status: PlanStatus;
  blockedBy?: number[];
  evidence?: string;
  blockedReason?: string;
}

export interface Phase {
  id: number;
  subject: string;
  /** Why this phase exists, how it advances the goal, and the chosen approach boundary. */
  description: string;
  acceptanceCriteria?: AcceptanceCriterion[];
  /** Goal Plan only: local mutation counter for phase_check validity. */
  revision?: number;
  /** Goal Plan only: latest independent phase_check result. */
  check?: CheckRecord;
  status: PlanStatus;
  tasks: Task[];
  blockedReason?: string;
}

export interface TaskPlan {
  phases: Phase[];
  /** Next plan-global task ID; phases use a separate 1-based ID namespace. */
  nextId: number;
  /** Monotonic mutation counter used to invalidate stale check approvals and tool calls. */
  revision?: number;
}

export function countDoneTasks(phase: Phase): number {
  return phase.tasks.filter((task) => isDonePlanStatus(task.status)).length;
}

export function flattenTasks(plan: TaskPlan | undefined): Task[] {
  return plan?.phases.flatMap((phase) => phase.tasks) ?? [];
}

export function findPhaseByTask(plan: TaskPlan | undefined, taskId: number): number {
  if (!plan) return -1;
  return plan.phases.findIndex((phase) => phase.tasks.some((task) => task.id === taskId));
}

export function detectPlanCycle(allTasks: readonly Task[], taskId: number, newBlockedBy: readonly number[]): boolean {
  const edges = new Map<number, number[]>();
  for (const task of allTasks) {
    // Callers provide the target task's final dependency set after applying any removals/additions.
    edges.set(task.id, task.id === taskId
      ? [...new Set(newBlockedBy)]
      : [...(task.blockedBy ?? [])]);
  }
  const visiting = new Set<number>();
  const visited = new Set<number>();
  const hasCycleFrom = (node: number): boolean => {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    for (const dependency of edges.get(node) ?? []) {
      if (hasCycleFrom(dependency)) return true;
    }
    visiting.delete(node);
    visited.add(node);
    return false;
  };
  return [...edges.keys()].some(hasCycleFrom);
}

export function recomputePhaseStatus(phase: Phase): PlanStatus {
  if (phase.tasks.length === 0) return phase.status;
  if (phase.tasks.some((task) => task.status === "in_progress")) return "in_progress";
  const hasBlocked = phase.tasks.some((task) => task.status === "blocked");
  const allTerminal = phase.tasks.every((task) => isDonePlanStatus(task.status) || task.status === "blocked");
  if (allTerminal && hasBlocked) return "blocked";
  return phase.status;
}
