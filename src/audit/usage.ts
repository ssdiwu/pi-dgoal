import { createHash } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export interface AuditUsageRecord {
  timestamp: string;
  parentSessionId: string;
  project: string;
  scope: "phase" | "goal";
  model: string;
  attempt: number;
  usage: Record<string, unknown>;
  dedupKey: string;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function sanitizeAuditUsage(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  const raw = value as Record<string, unknown>;
  const cost = raw.cost && typeof raw.cost === "object" ? raw.cost as Record<string, unknown> : undefined;
  const usage: Record<string, unknown> = {};
  for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"]) {
    const number = finiteNumber(raw[key]);
    if (number !== undefined) usage[key] = number;
  }
  if (cost) {
    const cleanCost: Record<string, number> = {};
    for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"]) {
      const number = finiteNumber(cost[key]);
      if (number !== undefined) cleanCost[key] = number;
    }
    if (Object.keys(cleanCost).length) usage.cost = cleanCost;
  }
  return usage;
}

export function buildAuditUsageRecord(args: {
  timestamp?: string;
  parentSessionId: string;
  project: string;
  scope: "phase" | "goal";
  model: string;
  attempt: number;
  usage: unknown;
}): AuditUsageRecord {
  const timestamp = args.timestamp ?? new Date().toISOString();
  const usage = sanitizeAuditUsage(args.usage);
  const identity = JSON.stringify({
    timestamp,
    parentSessionId: args.parentSessionId,
    project: args.project,
    scope: args.scope,
    model: args.model,
    attempt: args.attempt,
    usage,
  });
  return {
    timestamp,
    parentSessionId: args.parentSessionId,
    project: args.project,
    scope: args.scope,
    model: args.model,
    attempt: args.attempt,
    usage,
    dedupKey: createHash("sha256").update(identity).digest("hex").slice(0, 32),
  };
}

export async function appendAuditUsage(path: string, record: AuditUsageRecord): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(record)}\n`, { encoding: "utf-8", mode: 0o600 });
}
