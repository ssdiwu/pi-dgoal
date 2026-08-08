import type { CheckpointState } from "../audit/checkpoint.ts";
import type { AcceptanceCriterion, WorkCheckRecord, WorkList } from "../work-list/index.ts";

export type CheckRecord = WorkCheckRecord;

export type GoalStatus = "pending" | "active" | "paused" | "done";
export type PauseReason = "user_abort" | "model_error" | "audit_error" | "no_progress" | "agent_blocked";
export type AuditorScope = "phase" | "goal";
export type AssuranceProfile = "execution" | "goal_check" | "staged_check";

export interface AssuranceTransition {
  from?: AssuranceProfile;
  to: AssuranceProfile;
  at: number;
  revision: number;
}

export interface PlanContract {
  id: string;
  profile: AssuranceProfile;
  startedAt: number;
  /** Current Work List revision governed by this contract. */
  revision: number;
  transitions: AssuranceTransition[];
  verification?: string;
  acceptanceCriteria?: AcceptanceCriterion[];
  userReviewItems?: string[];
  nonGoals?: string[];
  guardrails?: string[];
  goalCheck?: CheckRecord;
  rejectedCount?: number;
  finalFeedback?: FinalCheckFeedback;
  finalAuditHistory?: FinalAuditHistoryEntry[];
  auditorCandidates?: { phase?: AuditorCandidateState; goal?: AuditorCandidateState };
  auditCheckpoints?: { phase?: CheckpointState; goal?: CheckpointState };
  auditErrorScope?: AuditorScope;
}

export interface VerificationBundle {
  changes: string;
  acceptanceEvidence: string;
  selfTest: string;
  risks: string;
}

export type FinalAuditMode = "diagnostic" | "narrow_confirmation";

export interface AuditorCandidateState {
  selectedModelId?: string;
  failedModelIds?: string[];
}

export interface CheckFeedback {
  report: string;
  createdAt: number;
}

export interface FinalCheckFeedback extends CheckFeedback {
  rejectedCount: number;
}

export interface FinalAuditHistoryEntry {
  attempt: number;
  report: string;
  summary: string;
  verification: string;
  whatChanged?: string[];
  userReview?: string;
  auditMode?: FinalAuditMode;
  verificationBundle?: VerificationBundle;
  workspaceFingerprint?: string;
  createdAt: number;
}

export type PlanRunTerminalReason = "done" | "cleared" | "superseded";

export interface PlanHistoryCheckRecord {
  status: "approved" | "rejected" | "audit_error";
  modelId?: string;
  checkedAt?: number;
  revision: number;
}

export interface PlanHistoryContract {
  id: string;
  profile: AssuranceProfile;
  startedAt: number;
  revision: number;
  transitions: AssuranceTransition[];
  verification?: string;
  acceptanceCriteria?: AcceptanceCriterion[];
  userReviewItems?: string[];
  nonGoals?: string[];
  guardrails?: string[];
  goalCheck?: PlanHistoryCheckRecord;
}

export interface PlanRunHistoryRecord {
  /** Stable Plan Run identity; also the de-duplication key. */
  id: string;
  goalId: string;
  objective: string;
  description: string;
  goalStartedAt: number;
  endedAt: number;
  terminalReason: PlanRunTerminalReason;
  workList: WorkList;
  contract: PlanHistoryContract;
  summary?: string;
  verification?: string;
  whatChanged?: string[];
  userReview?: string;
}

export interface GoalState {
  id: string;
  objective: string;
  /** Why this goal exists, why this approach is chosen, and which method drift to avoid. */
  description: string;
  status: GoalStatus;
  startedAt: number;
  updatedAt: number;
  iteration: number;
  /** ADR 0051: the Goal's single Work List; soft while contract is absent. */
  workList?: WorkList;
  /** Until Done / independent-check assurance attached to the same Work List. */
  contract?: PlanContract;
  pauseReason?: PauseReason;
  pauseReasonDetail?: string;
  pausedTotalMs?: number;
  pauseStartedAt?: number;
}

export interface PlanProposal {
  objective: string;
  description: string;
  assuranceProfile: "goal_check" | "staged_check";
  /** Atomic Work List snapshot proposed for confirmation. */
  workList: WorkList;
  verification: string;
  acceptanceCriteria: AcceptanceCriterion[];
  userReviewItems?: string[];
  nonGoals?: string[];
  guardrails?: string[];
  /** Semantic-review projection of the real Phase backbone. */
  phases: Array<{
    subject: string;
    description: string;
    acceptanceCriteria?: AcceptanceCriterion[];
  }>;
}
