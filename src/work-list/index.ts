// ADR 0051 / v0.8.1 Work List pure data layer.
//
// One Goal owns a single logical Work List. The list carries root Work Items
// plus optional real Phases whose only members are Work Items (a Phase never
// nests). Work Item IDs are unique across the whole list; Phase IDs live in an
// independent 1-based namespace. This module never touches Pi, session or TUI.

export type WorkItemStatus = "pending" | "in_progress" | "done" | "blocked" | "abandoned";
export type WorkPhaseStatus = "pending" | "in_progress" | "done" | "blocked";

export interface AcceptanceCriterion {
  criterion: string;
  evidence: string;
}

export interface WorkDeliverable {
  /** A file, command, or externally observable state this Work Item must deliver. */
  target: string;
  /** What must be true of the target when this Work Item is complete. */
  description: string;
}

export interface WorkDeliverableEvidence {
  /** Must exactly match one declared WorkDeliverable target. */
  target: string;
  /** Reproducible evidence that the declared deliverable is satisfied. */
  evidence: string;
}

export interface WorkItem {
  id: number;
  subject: string;
  /** Optional while the Work List stays soft; required (non-empty) once it enters any Plan Contract. */
  description?: string;
  status: WorkItemStatus;
  /** Plan-global Work Item IDs that must reach a terminal state before this item proceeds. */
  blockedBy?: number[];
  /** Reproducible evidence; required when status === "done". */
  evidence?: string;
  /** Optional declared outputs for items whose completion spans named artifacts or states. */
  deliverables?: WorkDeliverable[];
  /** Per-deliverable evidence; required for done items that declared deliverables. */
  deliverableEvidence?: WorkDeliverableEvidence[];
  /** Required when status === "blocked". */
  blockedReason?: string;
  /** Required when status === "abandoned". */
  abandonedReason?: string;
}

export interface WorkCheckRecord {
  status: "approved" | "rejected" | "audit_error";
  report?: string;
  modelId?: string;
  checkedAt?: number;
  /** Phase-local revision checked by the auditor. */
  revision: number;
}

export interface WorkPhase {
  id: number;
  subject: string;
  /** Real phases must carry subject and description. */
  description: string;
  status: WorkPhaseStatus;
  /** Monotonic phase-local revision; unrelated phases do not invalidate this phase's approval. */
  revision?: number;
  /** Member Work Items only; a phase never contains nested phases. */
  items: WorkItem[];
  /** Staged Check Plan: frozen independent acceptance criteria per phase. */
  acceptanceCriteria?: AcceptanceCriterion[];
  check?: WorkCheckRecord;
  feedback?: { report: string; createdAt: number };
  blockedReason?: string;
}

export interface WorkList {
  /** Root-level flat Work Items that do not belong to any phase. */
  items: WorkItem[];
  /** Real phases, strictly serial by array position. */
  phases: WorkPhase[];
  /** Next plan-global Work Item ID; 1-based, never reset per phase. */
  nextItemId: number;
  /** Next Phase ID; independent 1-based namespace. */
  nextPhaseId: number;
  /** Monotonic structural/state revision used by Plan Contract checks. */
  revision: number;
}

/** Fresh soft Work List with both ID spaces seeded at 1. */
export function createEmptyWorkList(): WorkList {
  return { items: [], phases: [], nextItemId: 1, nextPhaseId: 1, revision: 0 };
}

/** done and abandoned are both terminal; done does not regress. */
export function isTerminalItemStatus(status: WorkItemStatus): boolean {
  return status === "done" || status === "abandoned";
}

export function isDoneItemStatus(status: WorkItemStatus): boolean {
  return status === "done";
}

/** Every Work Item in the list, root items first then phase members in phase order. */
export function flattenWorkItems(list: WorkList | undefined): WorkItem[] {
  if (!list) return [];
  const phaseItems = list.phases.flatMap((phase) => (Array.isArray(phase.items) ? phase.items : []));
  return [...(Array.isArray(list.items) ? list.items : []), ...phaseItems];
}

/** Index into list.phases for the phase that owns itemId, or -1 for a root item. */
export function findPhaseIndexByItem(list: WorkList | undefined, itemId: number): number {
  if (!list) return -1;
  return list.phases.findIndex(
    (phase) => Array.isArray(phase.items) && phase.items.some((item) => item.id === itemId),
  );
}

export function findItem(list: WorkList | undefined, itemId: number): WorkItem | undefined {
  return flattenWorkItems(list).find((item) => item.id === itemId);
}

/**
 * Would applying `newBlockedBy` to `itemId` close a dependency cycle?
 * Callers pass the target item's final blockedBy set after add/remove.
 */
export function detectWorkItemCycle(
  allItems: readonly WorkItem[],
  itemId: number,
  newBlockedBy: readonly number[],
): boolean {
  const edges = new Map<number, number[]>();
  for (const item of allItems) {
    edges.set(
      item.id,
      item.id === itemId ? [...new Set(newBlockedBy)] : [...(item.blockedBy ?? [])],
    );
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

/**
 * Does `dependingItemId` depending on `dependencyId` reach into a later phase,
 * which would let work bypass strict serial phase order?
 * Root items (on either side) are not phase-gated and never trip this rule.
 */
export function dependencyEntersFuturePhase(
  list: WorkList,
  dependingItemId: number,
  dependencyId: number,
): boolean {
  const selfPhaseIdx = findPhaseIndexByItem(list, dependingItemId);
  const depPhaseIdx = findPhaseIndexByItem(list, dependencyId);
  if (selfPhaseIdx === -1) return false;
  if (depPhaseIdx === -1) return false;
  return depPhaseIdx > selfPhaseIdx;
}

/** Every declared deliverable has one matching piece of per-target evidence. */
export function hasEvidenceForEveryDeliverable(
  item: Pick<WorkItem, "deliverables" | "deliverableEvidence">,
): boolean {
  const deliverables = item.deliverables ?? [];
  if (!deliverables.length) return true;
  const evidence = item.deliverableEvidence ?? [];
  return (
    evidence.length === deliverables.length &&
    evidence.every((entry) => deliverables.some((deliverable) => deliverable.target === entry.target))
  );
}

/**
 * Derived Phase status from member Work Items. It can surface in_progress/blocked
 * but it NEVER writes "done" — Phase completion is always an explicit close.
 * A phase whose members are exhausted therefore stays on the "awaiting close"
 * frontier instead of auto-finishing.
 */
export function recomputeWorkPhaseStatus(phase: WorkPhase): WorkPhaseStatus {
  if (!Array.isArray(phase.items) || phase.items.length === 0) return phase.status;
  if (phase.items.some((item) => item.status === "in_progress")) return "in_progress";
  const unsettled = phase.items.filter((item) => !isTerminalItemStatus(item.status));
  if (unsettled.length > 0 && unsettled.every((item) => item.status === "blocked")) return "blocked";
  return phase.status;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = new Set(allowed);
  return Object.keys(value).every((key) => keys.has(key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}


export interface WorkListValidation {
  ok: boolean;
  errors: string[];
}

/**
 * Strict planned-state validation for entering any Plan Contract. This function
 * also validates untrusted persisted data, so malformed scalar/container shapes
 * must return errors rather than throwing.
 */
export function validateWorkList(list: WorkList | undefined, options: { planned?: boolean } = {}): WorkListValidation {
  const errors: string[] = [];
  if (!isRecord(list)) return { ok: false, errors: ["Work List 缺失或结构无效"] };
  if (!hasOnlyKeys(list, ["items", "phases", "nextItemId", "nextPhaseId", "revision"])) errors.push("Work List 包含未知字段");
  if (!Array.isArray(list.items) || !Array.isArray(list.phases)) {
    return { ok: false, errors: ["Work List 的 items/phases 必须是数组"] };
  }
  if (!Number.isInteger(list.nextItemId) || list.nextItemId < 1) errors.push("nextItemId 必须是正整数");
  if (!Number.isInteger(list.nextPhaseId) || list.nextPhaseId < 1) errors.push("nextPhaseId 必须是正整数");
  if (!Number.isInteger(list.revision) || list.revision < 0) errors.push("revision 必须是非负整数");

  const phaseIds = new Set<number>();
  const validPhases: WorkPhase[] = [];
  for (const [phaseIndex, rawPhase] of list.phases.entries()) {
    if (!isRecord(rawPhase) || !Array.isArray(rawPhase.items)) {
      errors.push(`第 ${phaseIndex + 1} 个 Phase 结构无效`);
      continue;
    }
    const phase = rawPhase as unknown as WorkPhase;
    if (!hasOnlyKeys(rawPhase, ["id", "subject", "description", "status", "revision", "items", "acceptanceCriteria", "check", "feedback", "blockedReason"])) errors.push(`phase #${String(phase.id)} 包含未知字段`);
    validPhases.push(phase);
    if (!Number.isInteger(phase.id) || phase.id < 1 || phaseIds.has(phase.id)) {
      errors.push(`Phase ID #${String(phase.id)} 无效或重复`);
    } else {
      phaseIds.add(phase.id);
    }
    if (!isNonEmptyString(phase.subject) || !isNonEmptyString(phase.description)) errors.push(`phase #${String(phase.id)} 缺少 subject 或 description`);
    if (!["pending", "in_progress", "done", "blocked"].includes(String(phase.status))) errors.push(`phase #${String(phase.id)} 状态无效`);
    if (phase.revision !== undefined && (!Number.isInteger(phase.revision) || phase.revision < 0)) errors.push(`phase #${String(phase.id)} revision 必须是非负整数`);
    if (phase.check !== undefined) {
      const check = phase.check as unknown;
      if (!isRecord(check) || !hasOnlyKeys(check, ["status", "report", "modelId", "checkedAt", "revision"])
        || !["approved", "rejected", "audit_error"].includes(String(check.status))
        || !Number.isInteger(check.revision) || Number(check.revision) < 0
        || Number(check.revision) !== (phase.revision ?? 0)
        || (check.report !== undefined && typeof check.report !== "string")
        || (check.modelId !== undefined && typeof check.modelId !== "string")
        || (check.checkedAt !== undefined && (typeof check.checkedAt !== "number" || !Number.isFinite(check.checkedAt)))) {
        errors.push(`phase #${String(phase.id)} check 结构无效或 revision 已失效`);
      }
    }
    if (phase.feedback !== undefined) {
      const feedback = phase.feedback as unknown;
      if (!isRecord(feedback) || !hasOnlyKeys(feedback, ["report", "createdAt"]) || !isNonEmptyString(feedback.report)
        || typeof feedback.createdAt !== "number" || !Number.isFinite(feedback.createdAt)) {
        errors.push(`phase #${String(phase.id)} feedback 结构无效`);
      }
    }
    const blockedReasonValid = phase.blockedReason === undefined || isNonEmptyString(phase.blockedReason);
    if (!blockedReasonValid || (phase.status === "blocked" ? !isNonEmptyString(phase.blockedReason) : phase.blockedReason !== undefined)) {
      errors.push(`phase #${String(phase.id)} 的 blockedReason 与状态不一致`);
    }
    if (phaseIndex > 0 && list.phases.slice(0, phaseIndex).some((candidate) => !isRecord(candidate) || candidate.status !== "done")) {
      const membersPending = phase.items.every((item) => isRecord(item) && item.status === "pending");
      if (phase.status !== "pending" || !membersPending) errors.push(`phase #${String(phase.id)} 在前序 Phase 完成前被推进`);
    }
  }

  const locatedItems: Array<{ item: WorkItem; where: string; phaseIndex: number }> = [];
  const collectItem = (rawItem: unknown, where: string, phaseIndex: number) => {
    if (!isRecord(rawItem)) {
      errors.push(`${where} 包含无效 Work Item`);
      return;
    }
    if (!hasOnlyKeys(rawItem, ["id", "subject", "description", "status", "blockedBy", "evidence", "deliverables", "deliverableEvidence", "blockedReason", "abandonedReason"])) errors.push(`${where} 包含未知字段`);
    locatedItems.push({ item: rawItem as unknown as WorkItem, where, phaseIndex });
  };
  list.items.forEach((item, index) => collectItem(item, `root item ${index + 1}`, -1));
  validPhases.forEach((phase, phaseIndex) => phase.items.forEach((item, index) => collectItem(item, `phase #${String(phase.id)} item ${index + 1}`, phaseIndex)));

  const seenIds = new Map<number, string>();
  const phaseByItemId = new Map<number, number>();
  for (const { item, where, phaseIndex } of locatedItems) {
    const previous = seenIds.get(item.id);
    if (!Number.isInteger(item.id) || item.id < 1 || previous !== undefined) {
      errors.push(`Work Item ID #${String(item.id)} 无效或重复${previous ? `（${previous} 与 ${String(item.subject)}）` : ""}`);
    } else {
      seenIds.set(item.id, typeof item.subject === "string" ? item.subject : where);
      phaseByItemId.set(item.id, phaseIndex);
    }
  }
  if (locatedItems.some(({ item }) => Number.isInteger(item.id) && item.id >= list.nextItemId)) errors.push("nextItemId 必须大于现有全部 Work Item ID");
  if (validPhases.some((phase) => Number.isInteger(phase.id) && phase.id >= list.nextPhaseId)) errors.push("nextPhaseId 必须大于现有全部 Phase ID");

  let dependencyShapesValid = true;
  const sanitizedItems: WorkItem[] = [];
  for (const { item, where, phaseIndex } of locatedItems) {
    if (!isNonEmptyString(item.subject)) errors.push(`${where} #${String(item.id)} 缺少 subject`);
    if (item.description !== undefined && typeof item.description !== "string") errors.push(`${where} #${String(item.id)} description 必须是字符串`);
    if (options.planned && !isNonEmptyString(item.description)) errors.push(`${where} #${String(item.id)}（${String(item.subject)}）缺少计划态 description`);
    if (!["pending", "in_progress", "done", "blocked", "abandoned"].includes(String(item.status))) errors.push(`${where} #${String(item.id)} 状态无效`);
    if (item.evidence !== undefined && typeof item.evidence !== "string") errors.push(`${where} #${String(item.id)} evidence 必须是字符串`);
    if (options.planned && item.status === "done" && !isNonEmptyString(item.evidence)) errors.push(`${where} #${String(item.id)}（${String(item.subject)}）done 缺少可复验 evidence`);

    const abandonedReasonValid = item.abandonedReason === undefined || isNonEmptyString(item.abandonedReason);
    if (!abandonedReasonValid || (item.status === "abandoned" ? !isNonEmptyString(item.abandonedReason) : item.abandonedReason !== undefined)) errors.push(`${where} #${String(item.id)}（${String(item.subject)}）的 abandonedReason 与状态不一致`);
    const blockedReasonValid = item.blockedReason === undefined || isNonEmptyString(item.blockedReason);
    if (!blockedReasonValid || (item.status === "blocked" ? !isNonEmptyString(item.blockedReason) : item.blockedReason !== undefined)) errors.push(`${where} #${String(item.id)}（${String(item.subject)}）的 blockedReason 与状态不一致`);

    const deliverables = item.deliverables === undefined ? [] : item.deliverables;
    const deliverableTargets = new Set<string>();
    if (!Array.isArray(deliverables) || deliverables.length === 0 && item.deliverables !== undefined) {
      errors.push(`${where} #${String(item.id)} 的 deliverables 必须是非空数组`);
    } else {
      for (const deliverable of deliverables) {
        if (!isRecord(deliverable) || !hasOnlyKeys(deliverable, ["target", "description"]) || !isNonEmptyString(deliverable.target) || !isNonEmptyString(deliverable.description) || deliverableTargets.has(deliverable.target)) {
          errors.push(`${where} #${String(item.id)} 的 deliverables 无效或 target 重复`);
          continue;
        }
        deliverableTargets.add(deliverable.target);
      }
    }
    const deliverableEvidence = item.deliverableEvidence === undefined ? [] : item.deliverableEvidence;
    const evidenceTargets = new Set<string>();
    if (!Array.isArray(deliverableEvidence)) {
      errors.push(`${where} #${String(item.id)} 的 deliverableEvidence 必须是数组`);
    } else {
      for (const evidence of deliverableEvidence) {
        if (!isRecord(evidence) || !hasOnlyKeys(evidence, ["target", "evidence"]) || !isNonEmptyString(evidence.target) || !isNonEmptyString(evidence.evidence)
          || evidenceTargets.has(evidence.target) || !deliverableTargets.has(evidence.target)) {
          errors.push(`${where} #${String(item.id)} 的 deliverableEvidence 与声明不匹配`);
          continue;
        }
        evidenceTargets.add(evidence.target);
      }
    }
    if (options.planned && item.status === "done" && deliverableTargets.size > 0
      && (evidenceTargets.size !== deliverableTargets.size || [...deliverableTargets].some((target) => !evidenceTargets.has(target)))) {
      errors.push(`${where} #${String(item.id)}（${String(item.subject)}）done 缺少每个声明 deliverable 的逐项证据`);
    }

    const blockedBy = item.blockedBy === undefined ? [] : item.blockedBy;
    if (!Array.isArray(blockedBy) || blockedBy.some((id) => !Number.isInteger(id) || id < 1)) {
      errors.push(`${where} #${String(item.id)}（${String(item.subject)}）blockedBy 必须是正整数数组`);
      dependencyShapesValid = false;
      sanitizedItems.push({ ...item, blockedBy: [] });
      continue;
    }
    if (new Set(blockedBy).size !== blockedBy.length) errors.push(`${where} #${String(item.id)}（${String(item.subject)}）blockedBy 存在重复依赖`);
    for (const dependencyId of new Set(blockedBy)) {
      if (dependencyId === item.id) errors.push(`${where} #${String(item.id)}（${String(item.subject)}）不能依赖自身`);
      else if (!seenIds.has(dependencyId)) errors.push(`${where} #${String(item.id)}（${String(item.subject)}）依赖不存在的 Work Item #${dependencyId}`);
      else if (phaseIndex >= 0 && (phaseByItemId.get(dependencyId) ?? -1) > phaseIndex) errors.push(`${where} #${String(item.id)}（${String(item.subject)}）依赖了未来 Phase 内的 Work Item #${dependencyId}`);
    }
    sanitizedItems.push({ ...item, blockedBy: [...blockedBy] });
  }

  if (dependencyShapesValid && detectWorkItemCycle(sanitizedItems, -1, [])) errors.push("Work List 存在依赖环");
  return { ok: errors.length === 0, errors };
}

export function validatePlannedWorkList(list: WorkList | undefined): WorkListValidation {
  return validateWorkList(list, { planned: true });
}
