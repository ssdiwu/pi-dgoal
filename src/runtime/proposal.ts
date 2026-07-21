import type { AcceptanceCriterion, Phase, PlanStatus, PlanType, Task, TaskPlan } from "../plan/index.ts";
import { coerceNumberArray } from "../plan/reducer.ts";
import type { PlanProposal } from "../goal-runtime/types.ts";

export type ProposalReadinessLevel = "L0" | "L1" | "L2" | "L3";
export type ProposalReadinessGap = "objective" | "verification" | "acceptanceCriteria" | "phases" | "nonGoals" | "guardrails";

export interface ProposalReadinessAssessment {
  level: ProposalReadinessLevel;
  gaps: ProposalReadinessGap[];
}

export interface ProposalValidationInput {
  objective: string;
  description?: string;
  planType?: Exclude<PlanType, "task">;
  verification?: string;
  acceptanceCriteria?: AcceptanceCriterion[];
  phaseCount: number;
  phaseAcceptanceCriteria?: Array<AcceptanceCriterion[] | undefined>;
}

export type ProposalTranslator = (key: string, params?: Record<string, string | number>) => string;

export function trimOptionalText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function normalizeStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const normalized = value
    .map((item) => typeof item === "string" ? item.trim() : "")
    .filter(Boolean);
  return normalized.length ? normalized : undefined;
}

export function normalizeAcceptanceCriteria(value: unknown): AcceptanceCriterion[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const normalized: AcceptanceCriterion[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return undefined;
    const criterion = trimOptionalText((item as Record<string, unknown>).criterion);
    const evidence = trimOptionalText((item as Record<string, unknown>).evidence);
    if (!criterion || !evidence) return undefined;
    normalized.push({ criterion, evidence });
  }
  return normalized;
}

export function assessProposalReadiness(input: {
  objective?: string;
  verification?: string;
  acceptanceCriteria?: AcceptanceCriterion[];
  phaseCount?: number;
  phaseAcceptanceCriteria?: Array<AcceptanceCriterion[] | undefined>;
  planType?: Exclude<PlanType, "task">;
  nonGoals?: string[];
  guardrails?: string[];
}): ProposalReadinessAssessment {
  const gaps: ProposalReadinessGap[] = [];
  const hasObjective = Boolean(input.objective?.trim());
  const hasVerification = Boolean(input.verification?.trim());
  const hasAcceptanceCriteria = Boolean(input.acceptanceCriteria?.length);
  const hasPhases = (input.phaseCount ?? 0) > 0;
  const hasPhaseAcceptanceCriteria = input.planType === "phase"
    ? true
    : hasPhases
      && (input.phaseAcceptanceCriteria ?? []).length === input.phaseCount
      && (input.phaseAcceptanceCriteria ?? []).every((criteria) => Boolean(criteria?.length));
  const hasNonGoals = Boolean(input.nonGoals?.length);
  const hasGuardrails = Boolean(input.guardrails?.length);

  if (!hasObjective) gaps.push("objective");
  if (!hasVerification) gaps.push("verification");
  if (!hasAcceptanceCriteria || !hasPhaseAcceptanceCriteria) gaps.push("acceptanceCriteria");
  if (!hasPhases) gaps.push("phases");
  if (!hasNonGoals) gaps.push("nonGoals");
  if (!hasGuardrails) gaps.push("guardrails");

  if (!hasObjective) return { level: "L0", gaps };
  if (!hasVerification || !hasPhases || !hasAcceptanceCriteria || !hasPhaseAcceptanceCriteria) return { level: "L1", gaps };
  if (hasNonGoals && hasGuardrails) return { level: "L3", gaps };
  return { level: "L2", gaps };
}

export function proposalToPlan(proposal: PlanProposal): TaskPlan {
  let nextId = 1;
  const phaseIds = proposal.phases.map((_, index) => index + 1);
  const phases: Phase[] = proposal.phases.map((phase, phaseIndex) => {
    const phaseId = phaseIds[phaseIndex];
    const rawTasks = phase.tasks ?? [];
    const taskGlobalIds = rawTasks.map(() => nextId++);
    const tasks: Task[] = rawTasks.map((task, taskIndex) => {
      const mappedBlockedBy = coerceNumberArray(task.blockedBy)
        .map((localOneBased) => taskGlobalIds[localOneBased - 1])
        .filter((id): id is number => typeof id === "number");
      return {
        id: taskGlobalIds[taskIndex],
        subject: task.subject,
        description: task.description,
        status: "pending" as PlanStatus,
        ...(mappedBlockedBy.length ? { blockedBy: mappedBlockedBy } : {}),
      };
    });
    return {
      id: phaseId,
      subject: phase.subject,
      description: phase.description,
      status: "pending" as PlanStatus,
      tasks,
      ...(phase.acceptanceCriteria?.length ? { acceptanceCriteria: phase.acceptanceCriteria } : {}),
    };
  });
  return { phases, nextId };
}

export function validateProposalInputCore(
  input: ProposalValidationInput,
  translate: ProposalTranslator,
): { error: string; message: string } | null {
  if (!input.objective.trim()) {
    return { error: "no objective", message: translate("proposal.validate.noObjective") };
  }
  if (!input.verification || !input.verification.trim()) {
    return { error: "no verification", message: translate("proposal.validate.noVerification") };
  }
  if (input.phaseCount === 0) {
    return { error: "no phases", message: translate("proposal.validate.noPhases") };
  }
  const hasValidCriteria = (criteria: AcceptanceCriterion[] | undefined) => Boolean(criteria?.length)
    && criteria!.every((item) => Boolean(item.criterion?.trim()) && Boolean(item.evidence?.trim()));
  const hasGoalCriteria = hasValidCriteria(input.acceptanceCriteria);
  const hasPhaseCriteria = input.phaseAcceptanceCriteria?.length === input.phaseCount
    && input.phaseAcceptanceCriteria.every((criteria) => hasValidCriteria(criteria));
  if (!hasGoalCriteria || (input.planType !== "phase" && !hasPhaseCriteria)) {
    return { error: "no acceptance criteria", message: translate("proposal.validate.noAcceptanceCriteria") };
  }
  if (!input.description || !input.description.trim()) {
    return { error: "no description", message: translate("proposal.validate.noDescription") };
  }
  return null;
}
