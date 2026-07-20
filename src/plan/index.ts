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
  return (Array.isArray(phase.tasks) ? phase.tasks : []).filter((task) => isDonePlanStatus(task.status)).length;
}

export function flattenTasks(plan: TaskPlan | undefined): Task[] {
  return plan?.phases.flatMap((phase) => Array.isArray(phase.tasks) ? phase.tasks : []) ?? [];
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
export type TaskGraphNodeState = "ready" | "waiting" | "blocked" | "phase_blocked" | "done";

export interface TaskGraphNodeView {
  task: Task;
  state: TaskGraphNodeState;
  unresolvedDependencies: Task[];
  rootBlockers: Task[];
  /** Tasks that would become ready if this task alone moved to done now. */
  unblocks: Task[];
}

export interface TaskGraphView {
  phaseId: number;
  phaseBlocked: boolean;
  phaseBlockedReason?: string;
  nodes: TaskGraphNodeView[];
  ready: TaskGraphNodeView[];
  waiting: TaskGraphNodeView[];
  blocked: TaskGraphNodeView[];
  rootBlockers: Task[];
}

/**
 * Derive the executable graph view for one existing phase from Task.blockedBy.
 * This is a read model only: no graph state is persisted and no task is scheduled.
 */
export function deriveTaskGraph(plan: TaskPlan | undefined, phaseId: number): TaskGraphView | undefined {
  const phase = plan?.phases.find((item) => item.id === phaseId);
  if (!phase) return undefined;
  const phaseTasks = Array.isArray(phase.tasks) ? phase.tasks : [];
  const allTasks = flattenTasks(plan);
  const phaseBlocked = phase.status === "blocked";
  const byId = new Map(allTasks.map((task) => [task.id, task]));
  const unresolvedFor = (task: Task): Task[] => [...new Set(task.blockedBy ?? [])]
    .map((id) => byId.get(id))
    .filter((dependency): dependency is Task => Boolean(dependency && !isDonePlanStatus(dependency.status)));

  const rootBlockersFor = (task: Task): Task[] => {
    const roots = new Map<number, Task>();
    if (task.status === "blocked") roots.set(task.id, task);
    const visited = new Set<number>();
    const visit = (candidate: Task) => {
      if (visited.has(candidate.id)) return;
      visited.add(candidate.id);
      if (candidate.status === "blocked") {
        roots.set(candidate.id, candidate);
        return;
      }
      for (const dependency of unresolvedFor(candidate)) visit(dependency);
    };
    for (const dependency of unresolvedFor(task)) visit(dependency);
    return [...roots.values()];
  };

  const nodes: TaskGraphNodeView[] = phaseTasks.map((task) => {
    const unresolvedDependencies = unresolvedFor(task);
    const state: TaskGraphNodeState = isDonePlanStatus(task.status)
      ? "done"
      : phaseBlocked
        ? "phase_blocked"
        : task.status === "blocked"
          ? "blocked"
          : unresolvedDependencies.length
            ? "waiting"
            : "ready";
    const unblocks = state === "ready" ? phaseTasks.filter((candidate) => {
      if (candidate.id === task.id || isDonePlanStatus(candidate.status) || candidate.status === "blocked") return false;
      const unresolved = unresolvedFor(candidate);
      return unresolved.length === 1 && unresolved[0]?.id === task.id;
    }) : [];
    return { task, state, unresolvedDependencies, rootBlockers: rootBlockersFor(task), unblocks };
  });
  const rootBlockers = new Map<number, Task>();
  for (const node of nodes) {
    if (node.task.status === "blocked") rootBlockers.set(node.task.id, node.task);
    for (const blocker of node.rootBlockers) rootBlockers.set(blocker.id, blocker);
  }
  return {
    phaseId,
    phaseBlocked,
    ...(phaseBlocked && phase.blockedReason?.trim() ? { phaseBlockedReason: phase.blockedReason.trim() } : {}),
    nodes,
    ready: nodes.filter((node) => node.state === "ready"),
    waiting: nodes.filter((node) => node.state === "waiting"),
    blocked: nodes.filter((node) => node.state === "blocked" || node.state === "phase_blocked"),
    rootBlockers: [...rootBlockers.values()],
  };
}

export function recomputePhaseStatus(phase: Phase): PlanStatus {
  if (phase.tasks.length === 0) return phase.status;
  if (phase.tasks.some((task) => task.status === "in_progress")) return "in_progress";
  const hasBlocked = phase.tasks.some((task) => task.status === "blocked");
  const allTerminal = phase.tasks.every((task) => isDonePlanStatus(task.status) || task.status === "blocked");
  if (allTerminal && hasBlocked) return "blocked";
  return phase.status;
}
