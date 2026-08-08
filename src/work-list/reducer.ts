// Pure Work List mutation core. Runtime owns persistence, contract guards and UI effects.

import {
  dependencyEntersFuturePhase,
  detectWorkItemCycle,
  findItem,
  findPhaseIndexByItem,
  flattenWorkItems,
  hasEvidenceForEveryDeliverable,
  isTerminalItemStatus,
  recomputeWorkPhaseStatus,
  type WorkDeliverable,
  type WorkDeliverableEvidence,
  type WorkItem,
  type WorkItemStatus,
  type WorkList,
  type WorkPhase,
} from "./index.ts";

export type WorkListAction = "create_item" | "create_phase" | "update_item" | "list_items" | "get_item";

export type WorkListOp =
  | { kind: "create_item"; itemId: number; phaseId?: number }
  | { kind: "create_phase"; phaseId: number }
  | { kind: "update_item"; itemId: number; fromStatus: WorkItemStatus; toStatus: WorkItemStatus }
  | { kind: "list_items"; items: WorkItem[] }
  | { kind: "get_item"; item: WorkItem }
  | { kind: "error"; message: string };

export interface WorkListMutationOptions {
  /** Plan Contract mode: descriptions and completion evidence become mandatory. */
  planned?: boolean;
}

export interface WorkListApplyResult {
  list: WorkList;
  op: WorkListOp;
}

export function coerceNumberArray(value: unknown): number[] {
  if (value == null) return [];
  if (typeof value === "number") return Number.isFinite(value) ? [value] : [];
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed.map(Number).filter(Number.isFinite) : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(value) ? value.map(Number).filter(Number.isFinite) : [];
}

type ItemLocation =
  | { kind: "root"; itemIndex: number }
  | { kind: "phase"; phaseIndex: number; itemIndex: number };

function error(list: WorkList, message: string): WorkListApplyResult {
  return { list, op: { kind: "error", message } };
}

function positiveInteger(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

export function coerceWorkItemIds(value: unknown): number[] {
  if (value == null) return [];
  if (typeof value === "number") return Number.isFinite(value) ? [value] : [];
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      return coerceWorkItemIds(JSON.parse(trimmed));
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0))];
}

export function normalizeWorkDeliverables(value: unknown): { deliverables?: WorkDeliverable[]; error?: string } {
  if (value === undefined) return {};
  if (!Array.isArray(value) || value.length === 0) return { error: "deliverables must be a non-empty array when provided" };
  const targets = new Set<string>();
  const deliverables: WorkDeliverable[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return { error: "each deliverable requires target and description" };
    const record = item as Record<string, unknown>;
    const target = String(record.target ?? "").trim();
    const description = String(record.description ?? "").trim();
    if (!target || !description || targets.has(target)) return { error: "deliverable targets must be unique and non-empty" };
    targets.add(target);
    deliverables.push({ target, description });
  }
  return { deliverables };
}

export function normalizeWorkDeliverableEvidence(value: unknown): { evidence?: WorkDeliverableEvidence[]; error?: string } {
  if (value === undefined) return {};
  if (!Array.isArray(value)) return { error: "deliverableEvidence must be an array" };
  const targets = new Set<string>();
  const evidence: WorkDeliverableEvidence[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return { error: "each deliverable evidence entry requires target and evidence" };
    const record = item as Record<string, unknown>;
    const target = String(record.target ?? "").trim();
    const detail = String(record.evidence ?? "").trim();
    if (!target || !detail || targets.has(target)) return { error: "deliverable evidence targets must be unique and non-empty" };
    targets.add(target);
    evidence.push({ target, evidence: detail });
  }
  return { evidence };
}

function locateItem(list: WorkList, itemId: number): ItemLocation | undefined {
  const rootIndex = list.items.findIndex((item) => item.id === itemId);
  if (rootIndex >= 0) return { kind: "root", itemIndex: rootIndex };
  for (let phaseIndex = 0; phaseIndex < list.phases.length; phaseIndex += 1) {
    const itemIndex = list.phases[phaseIndex].items.findIndex((item) => item.id === itemId);
    if (itemIndex >= 0) return { kind: "phase", phaseIndex, itemIndex };
  }
  return undefined;
}

function replaceItem(list: WorkList, location: ItemLocation, item: WorkItem): WorkList {
  if (location.kind === "root") {
    const items = [...list.items];
    items[location.itemIndex] = item;
    return { ...list, items };
  }
  const phase = list.phases[location.phaseIndex];
  const items = [...phase.items];
  items[location.itemIndex] = item;
  const nextPhase: WorkPhase = { ...phase, items };
  nextPhase.status = recomputeWorkPhaseStatus(nextPhase);
  if (nextPhase.status !== "blocked") delete nextPhase.blockedReason;
  const phases = [...list.phases];
  phases[location.phaseIndex] = nextPhase;
  return { ...list, phases };
}

function currentPhaseIndex(list: WorkList): number {
  return list.phases.findIndex((phase) => phase.status !== "done");
}

function phaseWriteError(list: WorkList, phaseIndex: number): string | undefined {
  const current = currentPhaseIndex(list);
  if (current < 0 || phaseIndex === current) return undefined;
  const expected = list.phases[current];
  const target = list.phases[phaseIndex];
  return `阶段顺序违规：phase #${expected.id}（${expected.subject}）尚未完成，不能操作 phase #${target.id}（${target.subject}）`;
}

function isWorkItemTransitionValid(from: WorkItemStatus, to: WorkItemStatus): boolean {
  if (from === to) return true;
  if (from === "pending") return to === "in_progress" || to === "blocked" || to === "abandoned";
  if (from === "in_progress") return to === "done" || to === "blocked" || to === "abandoned";
  if (from === "blocked") return to === "in_progress" || to === "abandoned";
  return false;
}

function validateDependencies(list: WorkList, itemId: number, blockedBy: number[]): string | undefined {
  const allItems = flattenWorkItems(list);
  for (const dependencyId of blockedBy) {
    if (dependencyId === itemId) return `Work Item #${itemId} 不能依赖自身`;
    if (!findItem(list, dependencyId)) return `依赖的 Work Item #${dependencyId} 不存在`;
    if (dependencyEntersFuturePhase(list, itemId, dependencyId)) return `Work Item #${itemId} 不能依赖未来 Phase 内的 Work Item #${dependencyId}`;
  }
  if (detectWorkItemCycle(allItems, itemId, blockedBy)) return "blockedBy 会形成依赖环";
  return undefined;
}

function unresolvedDependency(list: WorkList, blockedBy: number[]): number | undefined {
  return blockedBy.find((dependencyId) => findItem(list, dependencyId)?.status !== "done");
}

export function applyWorkListMutation(
  list: WorkList,
  action: WorkListAction,
  params: Record<string, unknown>,
  options: WorkListMutationOptions = {},
): WorkListApplyResult {
  switch (action) {
    case "create_phase": {
      const subject = String(params.subject ?? "").trim();
      const description = String(params.description ?? "").trim();
      if (!subject || !description) return error(list, "Phase requires subject and description");
      const phase: WorkPhase = {
        id: list.nextPhaseId,
        subject,
        description,
        status: "pending",
        revision: 0,
        items: [],
      };
      return {
        list: { ...list, phases: [...list.phases, phase], nextPhaseId: list.nextPhaseId + 1, revision: list.revision + 1 },
        op: { kind: "create_phase", phaseId: phase.id },
      };
    }
    case "create_item": {
      const subject = String(params.subject ?? "").trim();
      if (!subject) return error(list, "Work Item requires subject");
      const description = params.description === undefined ? undefined : String(params.description).trim();
      if (options.planned && !description) return error(list, "planned Work Item requires description");
      const normalizedDeliverables = normalizeWorkDeliverables(params.deliverables);
      if (normalizedDeliverables.error) return error(list, normalizedDeliverables.error);
      const phaseId = params.phaseId === undefined ? undefined : positiveInteger(params.phaseId);
      let phaseIndex = -1;
      if (params.phaseId !== undefined) {
        if (phaseId === undefined) return error(list, "phaseId must be a positive integer");
        phaseIndex = list.phases.findIndex((phase) => phase.id === phaseId);
        if (phaseIndex < 0) return error(list, `phase #${phaseId} does not exist`);
        const orderError = phaseWriteError(list, phaseIndex);
        if (orderError) return error(list, orderError);
        if (list.phases[phaseIndex].status === "done") return error(list, `phase #${phaseId} is already done`);
      }
      const item: WorkItem = { id: list.nextItemId, subject, status: "pending" };
      if (description) item.description = description;
      if (normalizedDeliverables.deliverables) item.deliverables = normalizedDeliverables.deliverables;
      const blockedBy = coerceWorkItemIds(params.blockedBy);
      if (blockedBy.length) item.blockedBy = blockedBy;
      let candidate: WorkList;
      if (phaseIndex < 0) candidate = { ...list, items: [...list.items, item] };
      else {
        const phases = [...list.phases];
        const phase = phases[phaseIndex];
        phases[phaseIndex] = { ...phase, revision: (phase.revision ?? 0) + 1, items: [...phase.items, item] };
        delete phases[phaseIndex].check;
        candidate = { ...list, phases };
      }
      const dependencyError = validateDependencies(candidate, item.id, blockedBy);
      if (dependencyError) return error(list, dependencyError);
      return {
        list: { ...candidate, nextItemId: list.nextItemId + 1, revision: list.revision + 1 },
        op: { kind: "create_item", itemId: item.id, ...(phaseId === undefined ? {} : { phaseId }) },
      };
    }
    case "update_item": {
      const itemId = positiveInteger(params.id);
      if (itemId === undefined) return error(list, "update_item requires a positive id");
      const location = locateItem(list, itemId);
      if (!location) return error(list, `Work Item #${itemId} does not exist`);
      if (location.kind === "phase") {
        const orderError = phaseWriteError(list, location.phaseIndex);
        if (orderError) return error(list, orderError);
        if (list.phases[location.phaseIndex].status === "done") return error(list, `phase #${list.phases[location.phaseIndex].id} is already done`);
      }
      const current = findItem(list, itemId)!;
      if (params.subject !== undefined && !String(params.subject).trim()) return error(list, "subject cannot be blank");
      if (params.description !== undefined && !String(params.description).trim()) return error(list, "description cannot be blank");
      const add = coerceWorkItemIds(params.addBlockedBy);
      const remove = new Set(coerceWorkItemIds(params.removeBlockedBy));
      const normalizedEvidence = normalizeWorkDeliverableEvidence(params.deliverableEvidence);
      if (normalizedEvidence.error) return error(list, normalizedEvidence.error);
      if (params.deliverableEvidence !== undefined && !current.deliverables?.length) return error(list, "deliverableEvidence requires declared deliverables");
      if (normalizedEvidence.evidence?.some((entry) => !current.deliverables!.some((deliverable) => deliverable.target === entry.target))) {
        return error(list, "deliverableEvidence targets must match declared deliverables");
      }
      const hasMutation = ["subject", "description", "status", "evidence", "deliverableEvidence", "blockedReason", "abandonedReason"]
        .some((key) => params[key] !== undefined) || add.length > 0 || remove.size > 0;
      if (!hasMutation) return error(list, "update_item requires a mutable field");

      const requestedStatus = params.status === undefined ? current.status : String(params.status) as WorkItemStatus;
      if (!["pending", "in_progress", "done", "blocked", "abandoned"].includes(requestedStatus)) return error(list, `invalid Work Item status ${requestedStatus}`);
      if (!isWorkItemTransitionValid(current.status, requestedStatus)) return error(list, `illegal Work Item transition ${current.status} → ${requestedStatus}`);
      const blockedBy = (current.blockedBy ?? []).filter((id) => !remove.has(id));
      for (const id of add) if (!blockedBy.includes(id)) blockedBy.push(id);
      const dependencyError = validateDependencies(list, itemId, blockedBy);
      if (dependencyError) return error(list, dependencyError);
      if (requestedStatus === "in_progress" || requestedStatus === "done") {
        const unresolved = unresolvedDependency(list, blockedBy);
        if (unresolved !== undefined) return error(list, `Work Item #${unresolved} dependency is unresolved`);
      }

      const blockedReason = params.blockedReason === undefined ? current.blockedReason?.trim() : String(params.blockedReason).trim();
      const abandonedReason = params.abandonedReason === undefined ? current.abandonedReason?.trim() : String(params.abandonedReason).trim();
      const evidence = params.evidence === undefined ? current.evidence?.trim() : String(params.evidence).trim();
      const deliverableEvidence = normalizedEvidence.evidence ?? current.deliverableEvidence;
      if (requestedStatus === "blocked" && !blockedReason) return error(list, "blocked requires blockedReason");
      if (requestedStatus === "abandoned" && !abandonedReason) return error(list, "abandoned requires abandonedReason");
      if (options.planned && requestedStatus === "done" && !evidence) return error(list, "planned done requires evidence");
      if (options.planned && requestedStatus === "done" && !hasEvidenceForEveryDeliverable({ deliverables: current.deliverables, deliverableEvidence })) {
        return error(list, "planned done requires evidence for every declared deliverable");
      }

      const updated: WorkItem = { ...current, status: requestedStatus };
      if (params.subject !== undefined) updated.subject = String(params.subject).trim();
      if (params.description !== undefined) updated.description = String(params.description).trim();
      if (params.evidence !== undefined) {
        if (evidence) updated.evidence = evidence;
        else delete updated.evidence;
      }
      if (params.deliverableEvidence !== undefined) {
        if (deliverableEvidence?.length) updated.deliverableEvidence = deliverableEvidence;
        else delete updated.deliverableEvidence;
      }
      if (blockedBy.length) updated.blockedBy = blockedBy;
      else delete updated.blockedBy;
      if (requestedStatus === "blocked") updated.blockedReason = blockedReason;
      else delete updated.blockedReason;
      if (requestedStatus === "abandoned") updated.abandonedReason = abandonedReason;
      else delete updated.abandonedReason;
      if (options.planned && !String(updated.description ?? "").trim()) return error(list, "planned Work Item requires description");
      let nextList = replaceItem(list, location, updated);
      if (location.kind === "phase") {
        const phases = [...nextList.phases];
        const phase = phases[location.phaseIndex];
        phases[location.phaseIndex] = { ...phase, revision: (phase.revision ?? 0) + 1 };
        delete phases[location.phaseIndex].check;
        nextList = { ...nextList, phases };
      }
      return {
        list: { ...nextList, revision: list.revision + 1 },
        op: { kind: "update_item", itemId, fromStatus: current.status, toStatus: requestedStatus },
      };
    }
    case "list_items": {
      let items = flattenWorkItems(list);
      if (params.phaseId !== undefined) {
        const phaseId = positiveInteger(params.phaseId);
        const phase = list.phases.find((candidate) => candidate.id === phaseId);
        if (!phase) return error(list, `phase #${params.phaseId} does not exist`);
        items = phase.items;
      }
      if (params.root === true) items = list.items;
      if (params.status !== undefined) items = items.filter((item) => item.status === params.status);
      return { list, op: { kind: "list_items", items } };
    }
    case "get_item": {
      const itemId = positiveInteger(params.id);
      if (itemId === undefined) return error(list, "get_item requires a positive id");
      const item = findItem(list, itemId);
      return item ? { list, op: { kind: "get_item", item } } : error(list, `Work Item #${itemId} does not exist`);
    }
  }
}
