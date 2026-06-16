import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

type LoopStatus = "active" | "paused" | "complete";

type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";

interface LoopGoal {
  id: string;
  objective: string;
  status: LoopStatus;
  startedAt: number;
  updatedAt: number;
  iteration: number;
}

interface LoopStateEntryData {
  goal?: LoopGoal | null;
}

interface AssistantMessageLike {
  role: "assistant";
  stopReason?: StopReason;
  errorMessage?: string;
}

interface LoopContext {
  cwd: string;
  ui: {
    confirm: (title: string, message: string) => Promise<boolean>;
    notify: (message: string, level?: "info" | "warning" | "error") => void;
    setStatus: (key: string, value: string | undefined) => void;
  };
  isIdle?: () => boolean;
  hasPendingMessages?: () => boolean;
  sessionManager?: unknown;
}

const STATUS_KEY = "loops";
const STATE_ENTRY_TYPE = "loops-state";
const MAX_OBJECTIVE_LENGTH = 8_000;
const CONTINUATION_MARKER_PREFIX = "pi-loops-continuation:";

let currentGoal: LoopGoal | undefined;
let api: ExtensionAPI | undefined;
let pendingContinuation: { goalId: string; marker: string } | undefined;
const cancelledMarkers = new Set<string>();

const loopCompleteTool = defineTool({
  name: "loop_complete",
  label: "Loop Complete",
  description:
    "Mark the active /loops goal as complete. Only call this after the goal is fully done and verified.",
  promptSnippet: "Mark the active /loops goal as complete after full verification",
  promptGuidelines: [
    "When a /loops goal is active, keep working until it is complete; do not stop with only a plan, TODO list, or partial progress.",
    "Call loop_complete only after auditing every requirement against current files, command output, tests, or external state.",
  ],
  parameters: Type.Object({
    summary: Type.String({ description: "What was completed." }),
    verification: Type.String({ description: "Evidence that proves the goal is complete." }),
  }),
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    const completedGoal = currentGoal;
    if (completedGoal) {
      currentGoal = { ...completedGoal, status: "complete", updatedAt: Date.now() };
      persistGoal(currentGoal);
    }

    clearActiveGoal(ctx);

    return {
      content: [
        {
          type: "text",
          text: `Loop complete.\nSummary: ${params.summary.trim()}\nVerification: ${params.verification.trim()}`,
        },
      ],
      details: {
        goal: completedGoal?.objective,
        summary: params.summary.trim(),
        verification: params.verification.trim(),
      },
      terminate: true,
    };
  },
});

export default function loops(pi: ExtensionAPI) {
  api = pi;
  pi.registerTool(loopCompleteTool);

  pi.registerCommand("loops", {
    description: "持续推进目标直到完成：/loops <goal> | pause | resume | clear | status",
    handler: (args, ctx) => handleLoopCommand(args, pi, ctx),
  });

  pi.registerCommand("loop", {
    description: "Alias for /loops",
    handler: (args, ctx) => handleLoopCommand(args, pi, ctx),
  });

  pi.registerCommand("loop-goal", {
    description: "启动持续目标模式：/loop-goal <goal>",
    handler: (args, ctx) => handleLoopCommand(args, pi, ctx),
  });

  pi.on("session_start", (_event, ctx) => {
    clearContinuation();
    currentGoal = loadGoal(ctx);
    ctx.ui.setStatus(STATUS_KEY, formatStatus(currentGoal));
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (currentGoal) persistGoal(currentGoal);
    clearContinuation();
    ctx.ui.setStatus(STATUS_KEY, undefined);
  });

  pi.on("input", (event) => {
    if (event.source !== "extension") return;
    if (consumeCancelledContinuation(event.text)) return { action: "handled" as const };
  });

  pi.on("before_agent_start", (event) => {
    markContinuationDelivered(event.prompt);
    if (!currentGoal || currentGoal.status !== "active") return;

    return {
      systemPrompt: `${event.systemPrompt}\n\n${buildSystemPrompt(currentGoal)}`,
    };
  });

  pi.on("agent_end", async (event, ctx) => {
    if (!currentGoal || currentGoal.status !== "active") return;

    const finalAssistant = findFinalAssistantMessage(event.messages);
    if (finalAssistant?.stopReason === "aborted" || finalAssistant?.stopReason === "error") {
      currentGoal = { ...currentGoal, status: "paused", updatedAt: Date.now() };
      persistGoal(currentGoal);
      clearContinuation();
      ctx.ui.setStatus(STATUS_KEY, formatStatus(currentGoal));
      const reason = finalAssistant.stopReason === "aborted" ? "用户中断" : "模型错误";
      const detail = finalAssistant.errorMessage ? `：${truncate(finalAssistant.errorMessage)}` : "";
      ctx.ui.notify(`Loops 已暂停（${reason}${detail}）。运行 /loops resume 继续。`, "warning");
      return;
    }

    currentGoal = { ...currentGoal, iteration: currentGoal.iteration + 1, updatedAt: Date.now() };
    persistGoal(currentGoal);
    ctx.ui.setStatus(STATUS_KEY, formatStatus(currentGoal));

    if (hasPendingMessages(ctx)) return;
    await sendContinuation(pi, ctx, currentGoal);
  });
}

async function handleLoopCommand(args: string, pi: ExtensionAPI, ctx: LoopContext) {
  const command = parseCommand(args);
  if (typeof command === "string") {
    ctx.ui.notify(command, "warning");
    return;
  }

  switch (command.kind) {
    case "status":
      showStatus(ctx);
      return;
    case "pause":
      pauseGoal(ctx);
      return;
    case "resume":
      await resumeGoal(pi, ctx);
      return;
    case "clear":
      clearGoal(ctx);
      return;
    case "start":
      await startGoal(command.objective, pi, ctx);
      return;
  }
}

function parseCommand(args: string):
  | { kind: "status" | "pause" | "resume" | "clear" }
  | { kind: "start"; objective: string }
  | string {
  const text = args.trim();
  if (!text || text === "status") return { kind: "status" };
  if (text === "pause") return { kind: "pause" };
  if (text === "resume") return { kind: "resume" };
  if (text === "clear" || text === "stop") return { kind: "clear" };
  if (text.length > MAX_OBJECTIVE_LENGTH) {
    return `目标太长（${text.length}/${MAX_OBJECTIVE_LENGTH} 字符）。请放到文件中，并在 /loops 中引用路径。`;
  }
  return { kind: "start", objective: text };
}

async function startGoal(objective: string, pi: ExtensionAPI, ctx: LoopContext) {
  if (!objective.trim()) {
    ctx.ui.notify("用法：/loops <goal>", "warning");
    return;
  }

  if (currentGoal && currentGoal.status !== "complete") {
    const replace = await ctx.ui.confirm(
      "替换当前 loop？",
      `当前目标：${currentGoal.objective}\n\n新目标：${objective}`,
    );
    if (!replace) return;
  }

  clearContinuation();
  currentGoal = createGoal(objective.trim());
  persistGoal(currentGoal);
  ctx.ui.setStatus(STATUS_KEY, formatStatus(currentGoal));
  ctx.ui.notify(`Loops 已启动：${currentGoal.objective}`, "info");
  await sendPrompt(pi, ctx, buildStartPrompt(currentGoal));
}

function pauseGoal(ctx: LoopContext) {
  if (!currentGoal) {
    ctx.ui.notify("当前没有 loop。", "info");
    return;
  }
  if (currentGoal.status !== "active") {
    ctx.ui.notify(`当前 loop 状态是 ${currentGoal.status}，不能暂停。`, "warning");
    return;
  }
  cancelPendingContinuation();
  currentGoal = { ...currentGoal, status: "paused", updatedAt: Date.now() };
  persistGoal(currentGoal);
  ctx.ui.setStatus(STATUS_KEY, formatStatus(currentGoal));
  ctx.ui.notify("Loops 已暂停。", "info");
}

async function resumeGoal(pi: ExtensionAPI, ctx: LoopContext) {
  if (!currentGoal) {
    ctx.ui.notify("当前没有 loop。", "info");
    return;
  }
  if (currentGoal.status !== "paused") {
    ctx.ui.notify(`当前 loop 状态是 ${currentGoal.status}，不能恢复。`, "warning");
    return;
  }
  currentGoal = { ...currentGoal, status: "active", updatedAt: Date.now() };
  persistGoal(currentGoal);
  ctx.ui.setStatus(STATUS_KEY, formatStatus(currentGoal));
  ctx.ui.notify("Loops 已恢复。", "info");
  await sendPrompt(pi, ctx, buildResumePrompt(currentGoal));
}

function clearGoal(ctx: LoopContext) {
  if (!currentGoal) {
    clearActiveGoal(ctx);
    ctx.ui.notify("当前没有 loop。", "info");
    return;
  }
  const objective = currentGoal.objective;
  clearActiveGoal(ctx);
  ctx.ui.notify(`Loops 已清除：${objective}`, "warning");
}

function showStatus(ctx: LoopContext) {
  if (!currentGoal) {
    ctx.ui.setStatus(STATUS_KEY, undefined);
    ctx.ui.notify("当前没有 loop。用法：/loops <goal>", "info");
    return;
  }
  ctx.ui.setStatus(STATUS_KEY, formatStatus(currentGoal));
  ctx.ui.notify(
    [
      `目标：${currentGoal.objective}`,
      `状态：${currentGoal.status}`,
      `轮次：${currentGoal.iteration}`,
      "命令：/loops pause | /loops resume | /loops clear",
    ].join("\n"),
    "info",
  );
}

function createGoal(objective: string): LoopGoal {
  const now = Date.now();
  return {
    id: randomUUID(),
    objective,
    status: "active",
    startedAt: now,
    updatedAt: now,
    iteration: 0,
  };
}

function buildSystemPrompt(goal: LoopGoal) {
  return `Active /loops goal:\n<loop_goal>\n${escapeXml(goal.objective)}\n</loop_goal>\n\nLoop rules:\n- Keep working until the active /loops goal is complete end-to-end.\n- Do not stop with only analysis, a plan, a TODO list, partial fixes, or suggested next steps.\n- Use available tools to implement, inspect, debug, and verify when needed.\n- Treat current files, command outputs, tests, and external state as authoritative.\n- If a tool fails, try reasonable alternatives before yielding.\n- Before completion, audit every requirement against verified evidence.\n- Only call loop_complete after the whole goal is complete and verified.`;
}

function buildStartPrompt(goal: LoopGoal) {
  return `Loops mode is active. Complete this goal fully:\n\n<loop_goal>\n${escapeXml(goal.objective)}\n</loop_goal>\n\nKeep going until it is done end-to-end. Do not stop at a plan or partial progress. Verify the result, then call loop_complete with a concise summary and verification evidence.`;
}

function buildResumePrompt(goal: LoopGoal) {
  return `Resume the active /loops goal and continue until complete:\n\n<loop_goal>\n${escapeXml(goal.objective)}\n</loop_goal>\n\nVerify before calling loop_complete.`;
}

function buildContinuePrompt(goal: LoopGoal, marker: string) {
  return `Continue the active /loops goal until it is complete:\n\n<loop_goal>\n${escapeXml(goal.objective)}\n</loop_goal>\n\nAutomatic continuation #${goal.iteration}. Continue from the current verified state. If the goal is complete, call loop_complete with summary and verification evidence.\n\n<!-- ${CONTINUATION_MARKER_PREFIX}${marker} -->`;
}

async function sendContinuation(pi: ExtensionAPI, ctx: LoopContext, goal: LoopGoal) {
  if (pendingContinuation?.goalId === goal.id) return;
  const marker = `${goal.id}:${goal.iteration}`;
  pendingContinuation = { goalId: goal.id, marker };
  const sent = await sendPrompt(pi, ctx, buildContinuePrompt(goal, marker));
  if (!sent && pendingContinuation?.marker === marker) pendingContinuation = undefined;
}

async function sendPrompt(pi: ExtensionAPI, ctx: LoopContext, prompt: string) {
  try {
    const result = ctx.isIdle?.()
      ? (pi.sendUserMessage(prompt) as void | Promise<void>)
      : (pi.sendUserMessage(prompt, { deliverAs: "followUp" }) as void | Promise<void>);
    await result;
    return true;
  } catch (error) {
    ctx.ui.notify(`Loops 续跑失败：${formatError(error)}`, "error");
    return false;
  }
}

function persistGoal(goal: LoopGoal | null) {
  api?.appendEntry<LoopStateEntryData>(STATE_ENTRY_TYPE, { goal });
}

function loadGoal(ctx: LoopContext) {
  const sessionManager = ctx.sessionManager as
    | {
        getBranch?: () => Array<{ type?: string; customType?: string; data?: unknown }>;
        getEntries?: () => Array<{ type?: string; customType?: string; data?: unknown }>;
      }
    | undefined;
  const entries = sessionManager?.getBranch?.() ?? sessionManager?.getEntries?.() ?? [];
  const entry = entries
    .filter((item) => item.type === "custom" && item.customType === STATE_ENTRY_TYPE)
    .pop();
  const data = entry?.data as LoopStateEntryData | undefined;
  return isLoopGoal(data?.goal) && data.goal.status !== "complete" ? data.goal : undefined;
}

function clearActiveGoal(ctx: LoopContext) {
  cancelPendingContinuation();
  currentGoal = undefined;
  persistGoal(null);
  ctx.ui.setStatus(STATUS_KEY, undefined);
}

function clearContinuation() {
  pendingContinuation = undefined;
  cancelledMarkers.clear();
}

function cancelPendingContinuation() {
  if (pendingContinuation) cancelledMarkers.add(pendingContinuation.marker);
  pendingContinuation = undefined;
}

function consumeCancelledContinuation(prompt: string) {
  const marker = extractMarker(prompt);
  return marker ? cancelledMarkers.delete(marker) : false;
}

function markContinuationDelivered(prompt: string) {
  const marker = extractMarker(prompt);
  if (marker && pendingContinuation?.marker === marker) pendingContinuation = undefined;
}

function extractMarker(prompt: string) {
  const pattern = new RegExp(`<!--\\s*${escapeRegExp(CONTINUATION_MARKER_PREFIX)}([^\\s>]+)\\s*-->`);
  return pattern.exec(prompt)?.[1];
}

function hasPendingMessages(ctx: LoopContext) {
  return ctx.hasPendingMessages?.() ?? false;
}

function findFinalAssistantMessage(messages: unknown[]): AssistantMessageLike | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || typeof message !== "object") continue;
    const candidate = message as Record<string, unknown>;
    if (candidate.role !== "assistant") continue;
    return {
      role: "assistant",
      stopReason: isStopReason(candidate.stopReason) ? candidate.stopReason : undefined,
      errorMessage: typeof candidate.errorMessage === "string" ? candidate.errorMessage : undefined,
    };
  }
  return undefined;
}

function isStopReason(value: unknown): value is StopReason {
  return ["stop", "length", "toolUse", "error", "aborted"].includes(String(value));
}

function isLoopGoal(value: unknown): value is LoopGoal {
  if (!value || typeof value !== "object") return false;
  const goal = value as Partial<LoopGoal>;
  return (
    typeof goal.id === "string" &&
    typeof goal.objective === "string" &&
    ["active", "paused", "complete"].includes(String(goal.status)) &&
    typeof goal.startedAt === "number" &&
    typeof goal.updatedAt === "number" &&
    typeof goal.iteration === "number"
  );
}

function formatStatus(goal: LoopGoal | undefined) {
  if (!goal) return undefined;
  if (goal.status === "complete") return "🔁 complete";
  if (goal.status === "paused") return "🔁 paused";
  return `🔁 active #${goal.iteration}`;
}

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatError(error: unknown) {
  return truncate(error instanceof Error ? error.message : String(error));
}

function truncate(value: string) {
  return value.length > 160 ? `${value.slice(0, 157)}...` : value;
}
