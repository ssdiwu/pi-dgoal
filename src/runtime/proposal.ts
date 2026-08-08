import type { AcceptanceCriterion } from "../work-list/index.ts";

export type ProposalReadinessLevel = "L0" | "L1" | "L2" | "L3";
export type ProposalReadinessGap = "objective" | "verification" | "acceptanceCriteria" | "phases" | "nonGoals" | "guardrails";

export interface ProposalReadinessAssessment {
  level: ProposalReadinessLevel;
  gaps: ProposalReadinessGap[];
}

export interface ProposalValidationInput {
  objective: string;
  description?: string;
  verification?: string;
  assuranceProfile: "goal_check" | "staged_check";
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
  assuranceProfile: "goal_check" | "staged_check";
  nonGoals?: string[];
  guardrails?: string[];
}): ProposalReadinessAssessment {
  const gaps: ProposalReadinessGap[] = [];
  const hasObjective = Boolean(input.objective?.trim());
  const hasVerification = Boolean(input.verification?.trim());
  const hasAcceptanceCriteria = Boolean(input.acceptanceCriteria?.length);
  const hasPhases = (input.phaseCount ?? 0) > 0;
  const phaseCriteriaRequired = input.assuranceProfile === "staged_check";
  const hasPhaseAcceptanceCriteria = !phaseCriteriaRequired
    ? true
    : hasPhases
      && (input.phaseAcceptanceCriteria ?? []).length === input.phaseCount
      && (input.phaseAcceptanceCriteria ?? []).every((criteria) => Boolean(criteria?.length));
  const hasNonGoals = Boolean(input.nonGoals?.length);
  const hasGuardrails = Boolean(input.guardrails?.length);

  if (!hasObjective) gaps.push("objective");
  if (!hasVerification) gaps.push("verification");
  if (!hasAcceptanceCriteria || !hasPhaseAcceptanceCriteria) gaps.push("acceptanceCriteria");
  if (!hasPhases && input.assuranceProfile === "staged_check") gaps.push("phases");
  if (!hasNonGoals) gaps.push("nonGoals");
  if (!hasGuardrails) gaps.push("guardrails");

  if (!hasObjective) return { level: "L0", gaps };
  if (!hasVerification || (!hasPhases && input.assuranceProfile === "staged_check") || !hasAcceptanceCriteria || !hasPhaseAcceptanceCriteria) return { level: "L1", gaps };
  if (hasNonGoals && hasGuardrails) return { level: "L3", gaps };
  return { level: "L2", gaps };
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
  if (input.phaseCount === 0 && input.assuranceProfile !== "goal_check") {
    return { error: "no phases", message: translate("proposal.validate.noPhases") };
  }
  const hasValidCriteria = (criteria: AcceptanceCriterion[] | undefined) => Boolean(criteria?.length)
    && criteria!.every((item) => Boolean(item.criterion?.trim()) && Boolean(item.evidence?.trim()));
  const hasGoalCriteria = hasValidCriteria(input.acceptanceCriteria);
  const requiresPhaseCriteria = input.assuranceProfile === "staged_check";
  const hasPhaseCriteria = !requiresPhaseCriteria || (input.phaseAcceptanceCriteria?.length === input.phaseCount
    && input.phaseAcceptanceCriteria.every((criteria) => hasValidCriteria(criteria)));
  if (!hasGoalCriteria || !hasPhaseCriteria) {
    return { error: "no acceptance criteria", message: translate("proposal.validate.noAcceptanceCriteria") };
  }
  if (!input.description || !input.description.trim()) {
    return { error: "no description", message: translate("proposal.validate.noDescription") };
  }
  return null;
}
