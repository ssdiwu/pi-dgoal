// Persistable, sanitized facts emitted by an isolated audit child.
// This module deliberately knows nothing about Pi, Goal Runtime, or process state.

import { createHash } from "node:crypto";

export type CheckpointStatus = "running" | "success" | "failed" | "unknown";
export type CheckpointEventPhase = "start" | "end";

export interface CheckpointEvent {
  workspaceFingerprint: string;
  toolName: string;
  args: Record<string, unknown>;
  phase: CheckpointEventPhase;
  status: CheckpointStatus;
}

export interface CheckpointRecord {
  toolName: string;
  // Sanitized for GoalState persistence and model-facing recovery context.
  args: Record<string, unknown>;
  argsFingerprint: string;
  started: boolean;
  ended: boolean;
  status: CheckpointStatus;
}

export interface CheckpointState {
  workspaceFingerprint: string;
  records: CheckpointRecord[];
}

export function applyCheckpointEvent(state: CheckpointState, event: CheckpointEvent): CheckpointState {
  // A record from another workspace cannot support reuse after a source change.
  if (state.workspaceFingerprint !== event.workspaceFingerprint) {
    return createCheckpointState(event);
  }

  const argsFingerprint = fingerprintArgs(event.args);
  const index = state.records.findIndex((record) => record.toolName === event.toolName && record.argsFingerprint === argsFingerprint);
  const nextRecord: CheckpointRecord = {
    toolName: event.toolName,
    args: sanitizeArgs(event.args),
    argsFingerprint,
    started: event.phase === "start",
    ended: event.phase === "end",
    status: event.status,
  };

  if (index < 0) {
    return { ...state, records: [...state.records, nextRecord] };
  }

  const previous = state.records[index];
  const records = [...state.records];
  records[index] = {
    ...previous,
    args: nextRecord.args,
    started: previous.started || nextRecord.started,
    ended: previous.ended || nextRecord.ended,
    status: event.status,
  };
  return { ...state, records };
}

export function isCheckpointReusable(
  state: CheckpointState | undefined,
  target: Pick<CheckpointEvent, "workspaceFingerprint" | "toolName" | "args">,
): boolean {
  if (!state || state.workspaceFingerprint !== target.workspaceFingerprint) return false;
  const argsFingerprint = fingerprintArgs(target.args);
  return state.records.some((record) => (
    record.toolName === target.toolName
    && record.argsFingerprint === argsFingerprint
    && record.ended
    && record.status === "success"
  ));
}

export function buildPartialReport(state: CheckpointState | undefined, options: { maxLength?: number } = {}): string {
  if (!state?.records.length) return "";
  const maxLength = options.maxLength ?? 6_000;
  const lines = state.records.map((record) => (
    `- ${record.toolName} ${JSON.stringify(record.args)}: ${record.status}${record.ended ? "" : " (未完成)"}`
  ));
  return cap(lines.join("\n"), maxLength);
}

function createCheckpointState(event: CheckpointEvent): CheckpointState {
  const argsFingerprint = fingerprintArgs(event.args);
  return {
    workspaceFingerprint: event.workspaceFingerprint,
    records: [{
      toolName: event.toolName,
      args: sanitizeArgs(event.args),
      argsFingerprint,
      started: event.phase === "start",
      ended: event.phase === "end",
      status: event.status,
    }],
  };
}

function fingerprintArgs(args: Record<string, unknown>): string {
  return createHash("sha256").update(stableSerialize(args)).digest("hex");
}

function sanitizeArgs(value: Record<string, unknown>): Record<string, unknown> {
  return sanitizeValue(value) as Record<string, unknown>;
}

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [
    key,
    /(?:api[_-]?key|token|password|secret|authorization|credential|private[_-]?key|session|cookie)/i.test(key)
      ? "[REDACTED]"
      : (key === "command" && typeof child === "string" ? redactCommand(child) : sanitizeValue(child)),
  ]));
}

function redactCommand(command: string): string {
  return command
    .replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/gi, "[REDACTED PRIVATE KEY]")
    .replace(/((?:[a-z][a-z0-9+.-]*):\/\/[^\/\s'\":]+:)([^\/\s'\"]*)@/gi, "$1[REDACTED]@")
    .replace(/(--(?:token|password|secret|authorization|cookie|credential|private[-_]?key|session|api[-_]?key|api[-_]?token|access[-_]?token|client[-_]?secret)(?:\s+|=|:))(?:\"[^\"]*\"|'[^']*'|[^\s;&|]+)/gi, "$1[REDACTED]")
    .replace(/((?:^|[\s'\";&|])(?:[a-z0-9_-]*(?:api[-_]?key|api[-_]?token|access[-_]?key|access[-_]?token|client[-_]?secret|token|password|secret|authorization|credential|private[-_]?key|session)[a-z0-9_-]*)\s*=\s*)(?:\"[^\"]*\"|'[^']*'|[^\s;&|]+)/gi, "$1[REDACTED]")
    .replace(/((?:^|[\s'\";&|])(?:cookie|set-cookie)\s*:\s*)(?:\"[^\"]*\"|'[^']*'|[^'\";&|]+)/gi, "$1[REDACTED]")
    .replace(/((?:^|[\s'\";&|])authorization\s*:\s*)(?:\"[^\"]*\"|'[^']*'|[^'\";&|]+)/gi, "$1[REDACTED]")
    .replace(/((?:^|[\s'\";&|])(?:x[-_])?(?:api[-_]?key|api[-_]?token|auth[-_]?token|token|password|secret|session|credential|private[-_]?key)\s*:\s*)(?:\"[^\"]*\"|'[^']*'|[^\s;&|]+)/gi, "$1[REDACTED]")
    .replace(/(authorization:\s*bearer\s+)(?:\"[^\"]*\"|'[^']*'|[^\s;&|]+)/gi, "$1[REDACTED]")
    .replace(/([?&](?:[a-z0-9_-]*(?:api[-_]?key|api[-_]?token|access[-_]?key|access[-_]?token|client[-_]?secret|token|password|secret|authorization|credential|private[-_]?key|session)[a-z0-9_-]*)=)([^&\s'\"]+)/gi, "$1[REDACTED]");
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${stableSerialize(child)}`)
    .join(",")}}`;
}

function cap(value: string, maxLength: number): string {
  if (maxLength <= 0) return "";
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}
