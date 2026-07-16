// Isolated audit-child execution protocol. This module owns child lifecycle, JSONL
// streaming, liveness/timers, checkpoint facts, and usage-ledger side effects.

import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { APPROVED_MARKER, hasRejectedAuditorMarker, parseAuditorDecision } from "../audit/index.ts";
import { applyCheckpointEvent, buildPartialReport, type CheckpointState } from "../audit/checkpoint.ts";
import { appendAuditUsage, buildAuditUsageRecord } from "../audit/usage.ts";
import { buildCheckCliArgs, consumeBufferedLines } from "./index.ts";
import { getPiInvocation, spawnIsolatedPi, terminateIsolatedPi } from "./process.ts";

export type IsolatedCheckLivenessState =
  | "starting"
  | "thinking"
  | "tool_running"
  | "report_streaming"
  | "approved"
  | "rejected"
  | "auditor_error";

export interface IsolatedAuditorErrorInfo {
  kind: "http" | "network" | "timeout" | "aborted" | "spawn" | "exit" | "unknown";
  status?: number;
  code?: string;
  exitCode?: number | null;
}

export interface IsolatedCheckResult {
  approved: boolean;
  aborted: boolean;
  output: string;
  error?: string;
  errorInfo?: IsolatedAuditorErrorInfo;
  usage?: unknown;
  liveness?: IsolatedCheckLivenessState;
}

export interface IsolatedCheckSnapshot {
  liveness: IsolatedCheckLivenessState;
  currentTool?: string;
  lastSnippet?: string;
  idleSecondsLeft?: number;
  idleSecondsTotal?: number;
}

export interface IsolatedCheckUpdate {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
}

export interface RunIsolatedPiCheckArgs {
  cwd: string;
  signal?: AbortSignal;
  scope: "phase" | "goal";
  modelId?: string;
  systemPrompt: string;
  task: string;
  idleTimeoutMs?: number;
  totalTimeoutMs?: number;
  progressUpdateThrottleMs?: number;
  checkpoint?: CheckpointState;
  onCheckpoint?: (checkpoint: CheckpointState) => void;
  onUpdate?: (update: IsolatedCheckUpdate) => void;
  getIdleTimeoutMs: (liveness: IsolatedCheckLivenessState, modelIdleTimeoutMs: number) => number;
  formatLivenessLine: (snapshot: IsolatedCheckSnapshot) => string;
  summarizeProgress: (output: string) => string;
  messages: {
    interrupted: string;
    spawnFailed: string;
    piExitCode: (code: number | null) => string;
    totalTimeout: (timeoutMs: number) => string;
  };
  usageLedger?: {
    path: string;
    parentSessionId: string;
    project: string;
    attempt: number;
  };
}

const DEFAULT_PROGRESS_THROTTLE_MS = 1_000;
const NETWORK_ERROR_CODES = new Set([
  "ECONNABORTED", "ECONNREFUSED", "ECONNRESET", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "ENOTFOUND", "ETIMEDOUT",
]);

export function fingerprintAuditWorkspace(cwd: string): string | undefined {
  const runGit = (args: string[]) => {
    const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", timeout: 5_000, maxBuffer: 1_000_000 });
    return result.status === 0 && !result.error ? result.stdout : undefined;
  };
  const head = runGit(["rev-parse", "HEAD"]);
  const status = runGit(["status", "--porcelain=v1", "--untracked-files=all"]);
  const diff = runGit(["diff", "--no-ext-diff", "--binary", "HEAD"]);
  const untracked = runGit(["ls-files", "--others", "--exclude-standard", "-z", "--", ":!node_modules/**"]);
  const ignored = runGit(["ls-files", "--others", "--ignored", "--exclude-standard", "-z", "--", ":!node_modules/**"]);
  if (head === undefined || status === undefined || diff === undefined || untracked === undefined || ignored === undefined) return undefined;

  const untrackedFileDigests: string[] = [];
  for (const relativePath of `${untracked}${ignored}`.split("\0").filter(Boolean)) {
    try {
      const content = fs.readFileSync(resolveWorkspacePath(cwd, relativePath));
      const digest = createHash("sha256").update(content).digest("hex");
      untrackedFileDigests.push(`${relativePath}\0${digest}`);
    } catch {
      return undefined;
    }
  }
  return createHash("sha256").update([cwd, head, status, diff, untrackedFileDigests.join("\0")].join("\u0000")).digest("hex");
}

function resolveWorkspacePath(cwd: string, relativePath: string): string {
  // Keeping path resolution local avoids making protocol callers depend on Node path.
  return `${cwd}/${relativePath}`;
}

export function classifyCheckEvent(line: string):
  | {
    liveness: IsolatedCheckLivenessState;
    toolName?: string;
    delta?: string;
    isMessageEnd?: boolean;
    text?: string;
    errorMessage?: string;
    errorInfo?: IsolatedAuditorErrorInfo;
    aborted?: boolean;
  }
  | null {
  if (!line.trim()) return null;
  let event: {
    type?: string;
    assistantMessageEvent?: { type?: string; delta?: string; toolName?: string };
    toolName?: string;
    message?: {
      role?: string;
      content?: Array<{ type: string; text?: string }>;
      stopReason?: string;
      errorMessage?: string;
      diagnostics?: unknown;
    };
  };
  try { event = JSON.parse(line); } catch { return null; }
  const evtType = event.assistantMessageEvent?.type;
  if (event.type === "message_update" && (evtType === "thinking_start" || evtType === "thinking_delta" || evtType === "thinking_end")) return { liveness: "thinking" };
  if (event.type === "message_update" && (evtType === "toolcall_start" || evtType === "toolcall_delta" || evtType === "toolcall_end")) return { liveness: "tool_running", toolName: event.assistantMessageEvent?.toolName };
  if (event.type === "message_update" && evtType === "text_delta") return { liveness: "report_streaming", delta: typeof event.assistantMessageEvent?.delta === "string" ? event.assistantMessageEvent.delta : undefined };
  if (event.type === "tool_execution_start" || event.type === "tool_execution_update") return { liveness: "tool_running", toolName: event.toolName };
  if (event.type === "tool_execution_end") return { liveness: "thinking", toolName: event.toolName };
  if (event.type !== "message_end" || event.message?.role !== "assistant") return null;
  const text = (event.message.content ?? []).filter((part) => part.type === "text" && typeof part.text === "string").map((part) => part.text!).join("\n\n");
  const errorMessage = typeof event.message.errorMessage === "string" ? event.message.errorMessage : undefined;
  return {
    liveness: event.message.stopReason === "toolUse" ? "tool_running" : "report_streaming",
    isMessageEnd: true,
    text,
    aborted: event.message.stopReason === "aborted",
    errorMessage,
    errorInfo: extractAuditorErrorInfo(event.message.diagnostics) ?? extractStructuredProviderErrorInfo(errorMessage),
  };
}

export async function runIsolatedPiCheck(args: RunIsolatedPiCheckArgs): Promise<IsolatedCheckResult> {
  return await new Promise<IsolatedCheckResult>((resolve) => {
    const workspaceFingerprint = fingerprintAuditWorkspace(args.cwd) ?? `unavailable:${randomUUID()}`;
    let checkpoint = args.checkpoint?.workspaceFingerprint === workspaceFingerprint ? args.checkpoint : { workspaceFingerprint, records: [] };
    const procArgs = buildCheckCliArgs({ modelId: args.modelId, systemPrompt: args.systemPrompt, task: withAuditCheckpoint(args.task, checkpoint) });
    const invocation = getPiInvocation(procArgs);
    const proc = spawnIsolatedPi(invocation.command, invocation.args, args.cwd);
    let finalReport = "";
    let partialReport = "";
    let stderrText = "";
    let childError: string | undefined;
    let childErrorInfo: IsolatedAuditorErrorInfo | undefined;
    let childAborted = false;
    let abortReason: "user" | "idle_timeout" | "total_timeout" | undefined;
    let buffer = "";
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let totalTimer: ReturnType<typeof setTimeout> | undefined;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
    let activeIdleTimeoutMs = args.idleTimeoutMs ?? 0;
    let idleDeadlineMs = 0;
    let lastProgressUpdateAt = 0;
    let sawChildFeedback = false;
    let liveness: IsolatedCheckLivenessState = "starting";
    let currentTool: string | undefined;
    let lastSnippet: string | undefined;
    let childUsage: unknown;
    const pendingAuditToolArgs = new Map<string, { toolName: string; args: Record<string, unknown> }>();
    let removeAbortListener = () => {};

    const clearIdleTimer = () => { if (idleTimer) clearTimeout(idleTimer); idleTimer = undefined; };
    const clearTotalTimer = () => { if (totalTimer) clearTimeout(totalTimer); totalTimer = undefined; };
    const killProc = (reason: "user" | "idle_timeout" | "total_timeout") => {
      if (abortReason) return;
      abortReason = reason;
      forceKillTimer = terminateIsolatedPi(proc);
    };
    const armIdleTimer = () => {
      clearIdleTimer();
      if (!args.idleTimeoutMs) return;
      activeIdleTimeoutMs = args.getIdleTimeoutMs(liveness, args.idleTimeoutMs);
      idleDeadlineMs = Date.now() + activeIdleTimeoutMs;
      idleTimer = setTimeout(() => killProc("idle_timeout"), activeIdleTimeoutMs);
    };
    const snapshot = (nextLiveness = liveness): IsolatedCheckSnapshot => ({
      liveness: nextLiveness,
      currentTool,
      lastSnippet,
      idleSecondsLeft: idleDeadlineMs ? Math.max(0, Math.ceil((idleDeadlineMs - Date.now()) / 1000)) : undefined,
      idleSecondsTotal: args.idleTimeoutMs ? Math.round(activeIdleTimeoutMs / 1000) : undefined,
    });
    const emitProgress = (force = false) => {
      if (!args.onUpdate) return;
      const now = Date.now();
      if (!force && now - lastProgressUpdateAt < (args.progressUpdateThrottleMs ?? DEFAULT_PROGRESS_THROTTLE_MS)) return;
      lastProgressUpdateAt = now;
      const state = snapshot();
      args.onUpdate({ content: [{ type: "text", text: `${args.formatLivenessLine(state)}\n${args.summarizeProgress(finalReport || partialReport)}` }], details: { partial: true, snapshot: state } });
    };
    let countdownTicker: ReturnType<typeof setInterval> | undefined;
    const startCountdownTicker = () => {
      if (countdownTicker || !args.onUpdate) return;
      countdownTicker = setInterval(() => {
        if (liveness === "starting" || liveness === "thinking" || liveness === "tool_running" || liveness === "report_streaming") emitProgress(true);
      }, DEFAULT_PROGRESS_THROTTLE_MS);
    };
    const stopCountdownTicker = () => { if (countdownTicker) clearInterval(countdownTicker); countdownTicker = undefined; };
    const noteActivity = () => {
      sawChildFeedback = true;
      if (args.idleTimeoutMs) idleDeadlineMs = Date.now() + args.idleTimeoutMs;
      armIdleTimer();
    };
    const processLine = (line: string) => {
      processCheckpointLine(line, workspaceFingerprint, pendingAuditToolArgs, (next) => { checkpoint = next; args.onCheckpoint?.(checkpoint); }, checkpoint);
      // processCheckpointLine updates only through its callback; retain the local state for the next event.
      if (line.trim()) {
        try {
          const raw = JSON.parse(line) as { type?: unknown; message?: { role?: unknown; usage?: unknown } };
          if (raw.type === "message_end" && raw.message?.role === "assistant") childUsage = raw.message.usage;
        } catch { /* tolerant child stream */ }
      }
      const classified = classifyCheckEvent(line);
      if (!classified) return;
      liveness = classified.liveness;
      if (classified.toolName) currentTool = classified.toolName;
      noteActivity();
      if (classified.liveness === "report_streaming" && classified.delta) {
        partialReport += classified.delta;
        emitProgress();
        return;
      }
      if (classified.isMessageEnd) {
        if (classified.text?.trim()) finalReport = partialReport = classified.text;
        if (classified.errorMessage) childError = classified.errorMessage;
        if (classified.errorInfo) childErrorInfo = classified.errorInfo;
        if (classified.aborted) childAborted = true;
        emitProgress(true);
        return;
      }
      emitProgress();
    };
    const finish = (result: IsolatedCheckResult) => {
      clearIdleTimer(); clearTotalTimer(); stopCountdownTicker();
      if (forceKillTimer) clearTimeout(forceKillTimer);
      removeAbortListener();
      proc.removeAllListeners(); proc.stdout?.removeAllListeners(); proc.stderr?.removeAllListeners();
      const finalLiveness: IsolatedCheckLivenessState = result.error ? "auditor_error" : (result.approved ? "approved" : (result.output ? "rejected" : "auditor_error"));
      const completed = { ...result, ...(childUsage !== undefined ? { usage: childUsage } : {}), liveness: result.liveness ?? finalLiveness };
      if (completed.usage && typeof completed.usage === "object" && args.usageLedger) {
        const record = buildAuditUsageRecord({ parentSessionId: args.usageLedger.parentSessionId, project: args.usageLedger.project, scope: args.scope, model: args.modelId ?? "current-session", attempt: args.usageLedger.attempt, usage: completed.usage });
        void appendAuditUsage(args.usageLedger.path, record).catch(() => {});
      }
      if (args.onUpdate && (completed.output || partialReport || completed.error)) {
        const state = snapshot(completed.liveness!);
        args.onUpdate({ content: [{ type: "text", text: args.summarizeProgress(completed.output || partialReport) }], details: { partial: false, approved: completed.approved, aborted: completed.aborted, error: completed.error, snapshot: state } });
      }
      resolve(completed);
    };

    proc.stdout?.on("data", (data) => { buffer = consumeBufferedLines(buffer, data.toString(), processLine, noteActivity); });
    proc.stderr?.on("data", (data) => { noteActivity(); stderrText += data.toString(); });
    proc.on("close", (code) => {
      if (buffer.trim()) processLine(buffer);
      const output = (finalReport || partialReport).trim();
      if (abortReason === "user" || childAborted) return finish({ approved: false, aborted: true, output, error: output ? undefined : args.messages.interrupted, errorInfo: { kind: "aborted" } });
      if (abortReason === "total_timeout") return finish({ approved: false, aborted: false, output, error: args.messages.totalTimeout(args.totalTimeoutMs ?? 0), errorInfo: { kind: "timeout" } });
      if (abortReason === "idle_timeout") {
        const whileTool = liveness === "tool_running";
        const label = sawChildFeedback ? (whileTool ? "审核工具空闲超时" : "审核空闲超时") : "审核启动超时";
        const detail = sawChildFeedback ? "无新反馈" : "无首个反馈";
        return finish({ approved: false, aborted: false, output, error: `${label}（${activeIdleTimeoutMs}ms ${detail}${whileTool && currentTool ? `；工具=${currentTool}` : ""}）`, errorInfo: { kind: "timeout" } });
      }
      if (childError) return hasExplicitAuditorDecision(output)
        ? finish({ approved: parseAuditorDecision(output), aborted: false, output })
        : finish({ approved: false, aborted: false, output, error: childError, errorInfo: childErrorInfo ?? { kind: "unknown" } });
      if (code !== 0 && !output) return finish({ approved: false, aborted: false, output: "", error: truncate(stderrText) || args.messages.piExitCode(code), errorInfo: { kind: "exit", exitCode: code } });
      finish({ approved: parseAuditorDecision(output), aborted: false, output });
    });
    proc.on("error", () => { if (!abortReason) finish({ approved: false, aborted: false, output: "", error: args.messages.spawnFailed, errorInfo: { kind: "spawn" } }); });
    removeAbortListener = bindAbort(args.signal, () => killProc("user"));
    if (args.totalTimeoutMs) totalTimer = setTimeout(() => killProc("total_timeout"), args.totalTimeoutMs);
    armIdleTimer(); startCountdownTicker();
  });
}

function processCheckpointLine(
  line: string,
  workspaceFingerprint: string,
  pending: Map<string, { toolName: string; args: Record<string, unknown> }>,
  update: (checkpoint: CheckpointState) => void,
  checkpoint: CheckpointState,
): void {
  if (!line.trim()) return;
  try {
    const raw = JSON.parse(line) as { type?: unknown; toolCallId?: unknown; toolName?: unknown; args?: unknown; isError?: unknown };
    const id = typeof raw.toolCallId === "string" ? raw.toolCallId : undefined;
    const toolName = typeof raw.toolName === "string" ? raw.toolName : undefined;
    const toolArgs = isRecord(raw.args) ? raw.args : undefined;
    if (raw.type === "tool_execution_start" && id && toolName && toolArgs) {
      pending.set(id, { toolName, args: toolArgs });
      update(applyCheckpointEvent(checkpoint, { workspaceFingerprint, toolName, args: toolArgs, phase: "start", status: "running" }));
    }
    if (raw.type === "tool_execution_end" && id && toolName) {
      const started = pending.get(id);
      if (started && started.toolName === toolName) {
        update(applyCheckpointEvent(checkpoint, { workspaceFingerprint, toolName: started.toolName, args: started.args, phase: "end", status: raw.isError === false ? "success" : raw.isError === true ? "failed" : "unknown" }));
        pending.delete(id);
      }
    }
  } catch { /* classifyCheckEvent is intentionally tolerant of malformed lines. */ }
}

function withAuditCheckpoint(task: string, checkpoint: CheckpointState): string {
  const report = buildPartialReport(checkpoint);
  if (!report) return task;
  return [task, "", "<audit_checkpoint>", "以下是同一工作区内由独立审核 child 记录的工具执行事实。status=success 的精确命令已经完成，不得重复执行；未完成或 unknown 不能视为通过，应检查其产物后只补跑尚未覆盖的验收条件。", escapeXml(report), "</audit_checkpoint>"].join("\n");
}

// The audit lifecycle and its test-facing alias must share this listener implementation.
export function bindAbort(signal: AbortSignal | undefined, onAbort: () => void): () => void {
  if (!signal) return () => {};
  if (signal.aborted) { onAbort(); return () => {}; }
  const listener = () => onAbort();
  signal.addEventListener("abort", listener, { once: true });
  return () => signal.removeEventListener("abort", listener);
}

function hasExplicitAuditorDecision(output: string): boolean {
  return output.includes(APPROVED_MARKER) !== hasRejectedAuditorMarker(output);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function truncate(value: string, max = 160): string {
  return value.length > max ? `${value.slice(0, Math.max(0, max - 3))}...` : value;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function structuredHttpStatus(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599) return value;
  if (typeof value === "string" && /^\d{3}$/.test(value)) return Number(value);
  return undefined;
}

function extractAuditorErrorInfo(diagnostics: unknown): IsolatedAuditorErrorInfo | undefined {
  if (!Array.isArray(diagnostics)) return undefined;
  for (const diagnostic of [...diagnostics].reverse()) {
    if (!diagnostic || typeof diagnostic !== "object") continue;
    const { type, error, details } = diagnostic as { type?: unknown; error?: { code?: unknown }; details?: Record<string, unknown> };
    const status = structuredHttpStatus(error?.code) ?? structuredHttpStatus(details?.status) ?? structuredHttpStatus(details?.statusCode) ?? structuredHttpStatus(details?.httpStatus) ?? structuredHttpStatus(details?.httpStatusCode);
    if (status !== undefined) return { kind: "http", status };
    const code = typeof error?.code === "string" ? error.code : undefined;
    if (type === "provider_transport_failure" || (code && NETWORK_ERROR_CODES.has(code))) return { kind: "network", code };
  }
  return undefined;
}

function extractStructuredProviderErrorInfo(errorMessage: unknown): IsolatedAuditorErrorInfo | undefined {
  if (typeof errorMessage !== "string") return undefined;
  const match = /^(\d{3}):\s*(\{.*\})$/s.exec(errorMessage.trim());
  if (!match) return undefined;
  try {
    const status = structuredHttpStatus(match[1]);
    return status !== undefined && structuredHttpStatus((JSON.parse(match[2]) as { code?: unknown }).code) === status ? { kind: "http", status } : undefined;
  } catch { return undefined; }
}
