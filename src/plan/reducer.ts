// Pure Plan mutation core. Runtime injects its translator and owns persistence/UI effects.

import {
  detectPlanCycle,
  findPhaseByTask,
  flattenTasks,
  isDonePlanStatus,
  recomputePhaseStatus,
  type Phase,
  type PlanStatus,
  type Task,
  type TaskPlan,
} from "./index.ts";

export type PlanAction = "create" | "update" | "list" | "get";

export type PlanOp =
  | { kind: "create"; taskId: number; phaseId: number }
  | { kind: "update"; taskId: number; fromStatus: PlanStatus; toStatus: PlanStatus }
  | { kind: "list"; tasks: Task[] }
  | { kind: "get"; task: Task }
  | { kind: "error"; message: string };

export interface PlanReducerGoal {
  plan?: TaskPlan;
  updatedAt: number;
}

export interface PlanApplyResult<G extends PlanReducerGoal = PlanReducerGoal> {
  goal: G;
  op: PlanOp;
}

export type PlanTranslator = (key: string, params?: Record<string, string | number>) => string;

function planError<G extends PlanReducerGoal>(goal: G, message: string): PlanApplyResult<G> {
  return { goal, op: { kind: "error", message } };
}

export function isTaskTransitionValid(from: PlanStatus, to: PlanStatus): boolean {
  if (from === to) return true;
  if (from === "pending") return to === "in_progress" || to === "blocked";
  if (from === "in_progress") return to === "done" || to === "blocked";
  if (from === "blocked") return to === "in_progress";
  return false;
}

function enforcePhaseOrder<G extends PlanReducerGoal>(goal: G, action: PlanAction, params: Record<string, unknown>): string | null {
  if (!goal.plan || goal.plan.phases.length <= 1) return null;
  if (action === "list" || action === "get") return null;

  const firstIncompleteIdx = goal.plan.phases.findIndex((phase) => !isDonePlanStatus(phase.status));
  if (firstIncompleteIdx < 0) return null;

  let targetPhaseIdx = -1;
  if (action === "create") {
    const phaseId = Number(params.phaseId);
    targetPhaseIdx = goal.plan.phases.findIndex((phase) => phase.id === phaseId);
  } else {
    const taskId = Number(params.id);
    for (let index = 0; index < goal.plan.phases.length; index += 1) {
      if (goal.plan.phases[index].tasks.some((task) => task.id === taskId)) {
        targetPhaseIdx = index;
        break;
      }
    }
  }
  if (targetPhaseIdx < 0 || targetPhaseIdx === firstIncompleteIdx) return null;

  const currentPhase = goal.plan.phases[firstIncompleteIdx];
  const targetPhase = goal.plan.phases[targetPhaseIdx];
  return `阶段顺序违规：phase #${currentPhase.id}（${currentPhase.subject}）尚未完成。必须先完成当前 phase，才能操作 phase #${targetPhase.id}（${targetPhase.subject}）。`;
}

export function coerceNumberArray(value: unknown): number[] {
  if (value == null) return [];
  if (typeof value === "number") return Number.isFinite(value) ? [value] : [];
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return [];
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed.map((item) => Number(item)).filter((item): item is number => Number.isFinite(item)) : [];
    } catch {
      return [];
    }
  }
  if (Array.isArray(value)) {
    return value.map((item) => Number(item)).filter((item): item is number => Number.isFinite(item));
  }
  return [];
}

export function applyPlanMutation<G extends PlanReducerGoal>(
  goal: G,
  action: PlanAction,
  params: Record<string, unknown>,
  translate: PlanTranslator,
): PlanApplyResult<G> {
  if (!goal.plan) return planError(goal, translate("plan.error.noPlan"));
  const phaseOrderError = enforcePhaseOrder(goal, action, params);
  if (phaseOrderError) return planError(goal, phaseOrderError);

  switch (action) {
    case "create": {
      const subject = String(params.subject ?? "").trim();
      if (!subject) return planError(goal, translate("plan.error.subjectRequiredForCreate"));
      const description = String(params.description ?? "").trim();
      if (!description) return planError(goal, translate("plan.error.descriptionRequiredForCreate"));
      const phaseId = Number(params.phaseId);
      const phaseIndex = goal.plan.phases.findIndex((phase) => phase.id === phaseId);
      if (phaseIndex === -1) return planError(goal, translate("plan.error.phaseNotFound", { phaseId }));
      const initialBlockedBy = coerceNumberArray(params.blockedBy);
      const allTasks = flattenTasks(goal.plan);
      for (const dependencyId of initialBlockedBy) {
        const dependency = allTasks.find((task) => task.id === dependencyId);
        if (!dependency) return planError(goal, translate("plan.error.blockedByTaskNotFound", { taskId: dependencyId }));
        if (findPhaseByTask(goal.plan, dependencyId) > phaseIndex) {
          return planError(goal, translate("plan.error.futurePhaseDependency", { taskId: dependencyId }));
        }
      }
      if (initialBlockedBy.length && detectPlanCycle(allTasks, -1, initialBlockedBy)) {
        return planError(goal, translate("plan.error.blockedByCycle"));
      }
      const newTask: Task = { id: goal.plan.nextId, subject, description, status: "pending" };
      if (initialBlockedBy.length) newTask.blockedBy = [...initialBlockedBy];
      const phases = goal.plan.phases.map((phase, index) =>
        index === phaseIndex ? { ...phase, tasks: [...phase.tasks, newTask] } : phase,
      );
      return {
        goal: { ...goal, plan: { ...goal.plan, phases, nextId: goal.plan.nextId + 1 }, updatedAt: Date.now() } as G,
        op: { kind: "create", taskId: newTask.id, phaseId },
      };
    }
    case "update": {
      const id = Number(params.id);
      if (!Number.isFinite(id)) return planError(goal, translate("plan.error.idRequiredForUpdate"));
      const phaseIndex = findPhaseByTask(goal.plan, id);
      if (phaseIndex === -1) return planError(goal, translate("plan.error.taskNotFound", { taskId: id }));
      const phase = goal.plan.phases[phaseIndex];
      const taskIndex = phase.tasks.findIndex((task) => task.id === id);
      const current = phase.tasks[taskIndex];

      const addList = coerceNumberArray(params.addBlockedBy);
      const removeList = coerceNumberArray(params.removeBlockedBy);
      if (params.subject !== undefined && !String(params.subject).trim()) {
        return planError(goal, translate("plan.error.subjectCannotBeBlank"));
      }
      if (params.description !== undefined && !String(params.description).trim()) {
        return planError(goal, translate("plan.error.descriptionCannotBeBlank"));
      }
      const hasMutation =
        params.subject !== undefined ||
        params.description !== undefined ||
        params.status !== undefined ||
        params.evidence !== undefined ||
        params.blockedReason !== undefined ||
        addList.length > 0 ||
        removeList.length > 0;
      if (!hasMutation) return planError(goal, translate("plan.error.updateRequiresMutableField"));

      let newStatus = current.status;
      if (params.status !== undefined) {
        const target = String(params.status) as PlanStatus;
        if (!isTaskTransitionValid(current.status, target)) {
          return planError(goal, translate("plan.error.illegalTransition", { from: current.status, to: target }));
        }
        newStatus = target;
      }
      const requestedBlockedReason = params.blockedReason === undefined ? undefined : String(params.blockedReason).trim();
      const requestedEvidence = params.evidence === undefined ? undefined : String(params.evidence).trim();
      if (newStatus === "blocked" && !(requestedBlockedReason ?? current.blockedReason?.trim())) {
        return planError(goal, translate("plan.error.blockedNeedsReason"));
      }
      if (isDonePlanStatus(newStatus) && !(requestedEvidence ?? current.evidence?.trim())) {
        return planError(goal, translate("plan.error.doneNeedsEvidence"));
      }

      let newBlockedBy = current.blockedBy ? [...current.blockedBy] : [];
      const removeSet = new Set<number>(removeList);
      if (removeSet.size) newBlockedBy = newBlockedBy.filter((dependency) => !removeSet.has(dependency));
      if (addList.length) {
        const allTasks = flattenTasks(goal.plan);
        for (const dependencyId of addList) {
          if (dependencyId === current.id) return planError(goal, translate("plan.error.cannotBlockSelf", { taskId: current.id }));
          const dependency = allTasks.find((task) => task.id === dependencyId);
          if (!dependency) return planError(goal, translate("plan.error.addBlockedByTaskNotFound", { taskId: dependencyId }));
          if (findPhaseByTask(goal.plan, dependencyId) > phaseIndex) {
            return planError(goal, translate("plan.error.futurePhaseDependency", { taskId: dependencyId }));
          }
          if (!newBlockedBy.includes(dependencyId)) newBlockedBy.push(dependencyId);
        }
        if (detectPlanCycle(flattenTasks(goal.plan), current.id, newBlockedBy)) {
          return planError(goal, translate("plan.error.addBlockedByCycle"));
        }
      }
      if ((newStatus === "in_progress" || isDonePlanStatus(newStatus)) && newBlockedBy.length) {
        const allTasks = flattenTasks(goal.plan);
        const unresolved = newBlockedBy.find((dependencyId) => {
          const dependency = allTasks.find((task) => task.id === dependencyId);
          return !dependency || !isDonePlanStatus(dependency.status);
        });
        if (unresolved !== undefined) return planError(goal, translate("plan.error.blockedByUnresolved", { taskId: unresolved }));
      }

      const updated: Task = { ...current, status: newStatus };
      if (params.subject !== undefined) updated.subject = String(params.subject).trim();
      if (params.description !== undefined) updated.description = String(params.description).trim();
      if (params.evidence !== undefined) {
        if (requestedEvidence) updated.evidence = requestedEvidence;
        else delete updated.evidence;
      }
      if (newStatus === "blocked") updated.blockedReason = requestedBlockedReason ?? current.blockedReason?.trim();
      else delete updated.blockedReason;
      if (newBlockedBy.length) updated.blockedBy = newBlockedBy;
      else delete updated.blockedBy;

      const tasks = [...phase.tasks];
      tasks[taskIndex] = updated;
      const nextPhase: Phase = { ...phase, tasks };
      nextPhase.status = recomputePhaseStatus(nextPhase);
      if (nextPhase.status !== "blocked") delete nextPhase.blockedReason;
      const phases = goal.plan.phases.map((candidate, index) => index === phaseIndex ? nextPhase : candidate);
      return {
        goal: { ...goal, plan: { ...goal.plan, phases }, updatedAt: Date.now() } as G,
        op: { kind: "update", taskId: id, fromStatus: current.status, toStatus: newStatus },
      };
    }
    case "list": {
      let tasks = flattenTasks(goal.plan);
      if (params.phaseId !== undefined) {
        const phaseIndex = goal.plan.phases.findIndex((phase) => phase.id === Number(params.phaseId));
        if (phaseIndex === -1) return planError(goal, translate("plan.error.phaseNotFound", { phaseId: Number(params.phaseId) }));
        tasks = goal.plan.phases[phaseIndex].tasks;
      }
      if (params.status !== undefined) {
        const status = String(params.status) as PlanStatus;
        tasks = tasks.filter((task) => task.status === status);
      }
      return { goal, op: { kind: "list", tasks } };
    }
    case "get": {
      const id = Number(params.id);
      if (!Number.isFinite(id)) return planError(goal, translate("plan.error.idRequiredForGet"));
      const task = flattenTasks(goal.plan).find((candidate) => candidate.id === id);
      if (!task) return planError(goal, translate("plan.error.taskNotFound", { taskId: id }));
      return { goal, op: { kind: "get", task } };
    }
  }
}
