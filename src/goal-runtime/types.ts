import type { CheckpointState } from "../audit/checkpoint.ts";
import type {
  AcceptanceCriterion,
  CheckRecord,
  PlanType,
  TaskPlan,
} from "../plan/index.ts";

export type GoalStatus = "pending" | "active" | "paused" | "done";
export type PauseReason = "user_abort" | "model_error" | "audit_error" | "no_progress" | "agent_blocked";
export type AuditorScope = "phase" | "goal";

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

export interface PhaseCheckFeedback extends CheckFeedback {
  phaseId: number;
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

export interface GoalState {
  id: string;
  objective: string;
  /** Why this goal exists, why this approach is chosen, and which method drift to avoid. */
  description: string;
  status: GoalStatus;
  /** Three product forms: automatic Task Plan, explicit Phase Plan, explicit Goal Plan. */
  planType?: PlanType;
  startedAt: number;
  updatedAt: number;
  iteration: number;
  plan?: TaskPlan;
  verification?: string;
  acceptanceCriteria?: AcceptanceCriterion[];
  userReviewItems?: string[];
  nonGoals?: string[];
  guardrails?: string[];
  pauseReason?: PauseReason;
  pauseReasonDetail?: string;
  auditErrorScope?: AuditorScope;
  pausedTotalMs?: number;
  pauseStartedAt?: number;
  rejectedCount?: number;
  phaseFeedbackById?: Record<string, PhaseCheckFeedback>;
  finalFeedback?: FinalCheckFeedback;
  finalAuditHistory?: FinalAuditHistoryEntry[];
  auditorCandidates?: {
    phase?: AuditorCandidateState;
    goal?: AuditorCandidateState;
  };
  auditCheckpoints?: {
    phase?: CheckpointState;
    goal?: CheckpointState;
  };
  goalCheck?: CheckRecord;
}

export interface PlanProposal {
  objective: string;
  description: string;
  /** Explicit audited Plan form. Task Plans bypass proposal review entirely. */
  planType?: Exclude<PlanType, "task">;
  verification?: string;
  acceptanceCriteria?: AcceptanceCriterion[];
  userReviewItems?: string[];
  nonGoals?: string[];
  guardrails?: string[];
  phases: Array<{
    subject: string;
    description: string;
    acceptanceCriteria?: AcceptanceCriterion[];
    tasks?: Array<{ subject: string; description: string; blockedBy?: number[] }>;
  }>;
}
