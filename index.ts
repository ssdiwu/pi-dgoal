import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const AUDITOR_DISABLED = process.env.PI_DLOOP_NO_AUDIT === "1";
const APPROVED_MARKER = "<APPROVED>";
const REJECTED_MARKER = "<REJECTED>";
// 纯只读：auditor 只看 agent 已产出的证据（文件、测试结果），不自己跑命令，避免变成自证。
const AUDITOR_ONLY_TOOLS = ["read", "grep", "find", "ls"];

type LoopStatus = "pending" | "active" | "paused" | "complete";

type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";

interface LoopGoal {
  id: string;
  objective: string;
  status: LoopStatus;
  startedAt: number;
  updatedAt: number;
  iteration: number;
  // 启动时从前文讨论固化的背景摘要（目标范围 / 关键约束 / 验收标准）。
  // 抗 context 压缩与重启：压缩或 resume 后这些隐含信息仍随 goal 持久化在。
  contextSummary?: string;
}

interface LoopStateEntryData {
  goal?: LoopGoal | null;
}

interface SessionBranchEntry {
  type?: string;
  message?: {
    role?: string;
    content?: unknown;
    timestamp?: number | string;
  };
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

const STATUS_KEY = "dloop";
const STATE_ENTRY_TYPE = "dloop-state";
const MAX_OBJECTIVE_LENGTH = 8_000;
const CONTEXT_INPUT_CAP_BYTES = 50 * 1024;
// 模型错误（非用户中断）的自动重试上限：连续 error 达到此值才真正暂停。
const MAX_ERROR_RETRIES = 3;
const CONTINUATION_MARKER_PREFIX = "pi-dloop-continuation:";

let currentGoal: LoopGoal | undefined;
// 连续模型错误计数：正常完成一轮后重置；累计到 MAX_ERROR_RETRIES 后暂停并清零。
let consecutiveErrors = 0;
let api: ExtensionAPI | undefined;
let pendingContinuation: { goalId: string; marker: string } | undefined;
const cancelledMarkers = new Set<string>();

const loopCompleteTool = defineTool({
  name: "loop_complete",
  label: "Loop Complete",
  description:
    "标记当前 /dloop 目标为完成。仅在目标全部完成且已验证后调用。",
  promptSnippet: "在目标全部完成且已验证后标记 /dloop 目标为完成",
  promptGuidelines: [
    "当 /dloop 目标处于 active 状态时，持续工作直到完成；不要停在分析、计划、TODO 列表或部分进度上。",
    "仅在对当前文件、命令输出、测试和外部状态逐条核验每项要求后，才调用 loop_complete。",
  ],
  parameters: Type.Object({
    summary: Type.String({ description: "What was completed." }),
    verification: Type.String({ description: "Evidence that proves the goal is complete." }),
  }),
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    const completedGoal = currentGoal;
    if (!completedGoal) {
      return {
        content: [
          { type: "text", text: "当前没有 /dloop 目标可完成。" },
        ],
        details: { goal: undefined, summary: params.summary.trim(), verification: params.verification.trim() },
        terminate: true,
      };
    }

    const summary = params.summary.trim();
    const verification = params.verification.trim();

    // 审核默认开启；PI_DLOOP_NO_AUDIT=1 逃生通道，直接放行。
    if (AUDITOR_DISABLED) {
      finalizeGoal(ctx);
      return {
        content: [
          { type: "text", text: `Dloop 完成（跳过审核）。\n总结：${summary}\n验证：${verification}` },
        ],
        details: { goal: completedGoal.objective, summary, verification, audited: false },
        terminate: true,
      };
    }

    let audit;
    try {
      audit = await runCompletionAuditor({
        ctx: ctx as unknown as ExtensionContext,
        goal: completedGoal,
        summary,
        verification,
      });
    } catch (error) {
      // 审核器自身出错 → 安全暂停，不 fail-open，也不烧 token 死循环。
      pauseOnAuditFailure(ctx, `审核器异常：${formatError(error)}`);
      return {
        content: [
          { type: "text", text: `审核运行失败，目标已暂停。运行 /dloop resume 继续并重试完成。\n错误：${formatError(error)}` },
        ],
        details: { goal: completedGoal.objective, summary, verification, auditError: formatError(error) },
        terminate: true,
      };
    }

    // 审核被用户中断（Esc）或没给出明确结论 → 同样安全暂停。
    if (audit.aborted || (!audit.approved && !audit.output)) {
      pauseOnAuditFailure(ctx, audit.aborted ? "审核被中断" : "审核无输出");
      return {
        content: [
          { type: "text", text: `审核未产出结论，目标已暂停。${audit.output ? `\n报告：${audit.output}` : ""}` },
        ],
        details: { goal: completedGoal.objective, summary, verification, auditAborted: audit.aborted },
        terminate: true,
      };
    }

    if (!audit.approved) {
      // 审核未通过：目标保持 active，报告作为续跑注入，agent 继续修正。
      ctx.ui.notify("审核未通过，目标保持 active，继续修正。", "warning");
      return {
        content: [
          {
            type: "text",
            text: `审核未通过，目标保持 active。请修正以下问题后重新调用 loop_complete。\n\n审核报告：\n${audit.output}`,
          },
        ],
        details: { goal: completedGoal.objective, summary, verification, auditRejected: true, auditOutput: audit.output },
        terminate: false,
      };
    }

    ctx.ui.notify("审核通过，Dloop 完成。", "info");
    finalizeGoal(ctx);
    return {
      content: [
        { type: "text", text: `Dloop 完成。审核通过。\n总结：${summary}\n验证：${verification}` },
      ],
      details: { goal: completedGoal.objective, summary, verification, audited: true, auditOutput: audit.output },
      terminate: true,
    };
  },
});

export default function dloop(pi: ExtensionAPI) {
  api = pi;
  pi.registerTool(loopCompleteTool);

  pi.registerCommand("dloop", {
    description: "持续推进目标直到完成：/dloop <goal> | pause | resume | clear | status",
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
    const errorDetail = finalAssistant?.errorMessage ? `：${truncate(finalAssistant.errorMessage)}` : "";

    // 用户主动中断：不重试，直接暂停。
    if (finalAssistant?.stopReason === "aborted") {
      consecutiveErrors = 0;
      currentGoal = { ...currentGoal, status: "paused", updatedAt: Date.now() };
      persistGoal(currentGoal);
      clearContinuation();
      ctx.ui.setStatus(STATUS_KEY, formatStatus(currentGoal));
      ctx.ui.notify(`Dloop 已暂停（用户中断${errorDetail}）。运行 /dloop resume 继续。`, "warning");
      return;
    }

    // 模型错误：先自动重试 MAX_ERROR_RETRIES 次，仍失败再暂停，避免瞬时错误直接打断 loop。
    if (finalAssistant?.stopReason === "error") {
      consecutiveErrors += 1;
      if (consecutiveErrors <= MAX_ERROR_RETRIES) {
        ctx.ui.notify(
          `模型错误，自动重试（${consecutiveErrors}/${MAX_ERROR_RETRIES}）${errorDetail}`,
          "warning",
        );
        clearContinuation();
        await sendContinuation(pi, ctx, currentGoal);
        return;
      }
      consecutiveErrors = 0;
      currentGoal = { ...currentGoal, status: "paused", updatedAt: Date.now() };
      persistGoal(currentGoal);
      clearContinuation();
      ctx.ui.setStatus(STATUS_KEY, formatStatus(currentGoal));
      ctx.ui.notify(
        `模型错误，已重试 ${MAX_ERROR_RETRIES} 次仍失败，Dloop 已暂停${errorDetail}。运行 /dloop resume 继续。`,
        "warning",
      );
      return;
    }

    // 正常完成一轮：重置错误计数，推进迭代。
    consecutiveErrors = 0;
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
    return `目标太长（${text.length}/${MAX_OBJECTIVE_LENGTH} 字符）。请放到文件中，并在 /dloop 中引用路径。`;
  }
  return { kind: "start", objective: text };
}

async function startGoal(objective: string, pi: ExtensionAPI, ctx: LoopContext) {
  if (!objective.trim()) {
    return;
  }

  if (currentGoal && currentGoal.status !== "complete") {
    // pending：上一个 loop 还在 summarizeContext 启动中，不应重叠启动新 loop。
    if (currentGoal.status === "pending") {
      ctx.ui.notify("上一个 loop 正在启动中，请稍后再试。", "warning");
      return;
    }
    const replace = await ctx.ui.confirm(
      "替换当前 loop？",
      `当前目标：${currentGoal.objective}\n\n新目标：${objective}`,
    );
    if (!replace) return;
  }

  consecutiveErrors = 0;
  clearContinuation();
  // 先以 pending 创建：summarizeContext 是慢子进程，期间 goal 不能是 active，
  // 否则 before_agent_start / agent_end 会提前把它当活跃 loop 推进，甚至打出孤儿 START prompt。
  const pendingGoal = createGoal(objective.trim());
  currentGoal = pendingGoal;
  persistGoal(currentGoal);
  ctx.ui.setStatus(STATUS_KEY, formatStatus(currentGoal));

  // 启动前固化前文背景：防止 loop 跑多轮后 context 压缩丢失讨论中的隐含约束 / 验收标准。
  // 摘要失败不阻断启动——objective 本身仍在，摘要只是补充，挂了降级为空继续。
  const priorDiscussion = extractPriorDiscussion(ctx);
  if (priorDiscussion) {
    ctx.ui.notify("正在从前文讨论固化启动背景…", "info");
    const result = await summarizeContext({
      ctx: ctx as ExtensionContext,
      objective: pendingGoal.objective,
      priorDiscussion,
    });
    // 摘要期间 goal 可能被用户 /dloop clear 或替换；校验仍是同一个 pending goal。
    if (!currentGoal || currentGoal.id !== pendingGoal.id) {
      ctx.ui.notify("启动被中断，已放弃本次 loop。", "warning");
      return;
    }
    if (result.aborted) {
      ctx.ui.notify("背景固化被中断，已放弃本次 loop。", "warning");
      currentGoal = undefined;
      persistGoal(null);
      ctx.ui.setStatus(STATUS_KEY, undefined);
      return;
    }
    if (result.summary && result.summary.trim() && result.summary.trim() !== "无额外背景") {
      currentGoal = { ...currentGoal, contextSummary: result.summary.trim(), updatedAt: Date.now() };
      persistGoal(currentGoal);
    } else if (result.error) {
      ctx.ui.notify(`背景固化失败（已降级为不带背景启动）：${result.error}`, "warning");
    }
  }

  // 再次校验：摘要期间 goal 仍可能在、且仍是本次 pending goal。
  if (!currentGoal || currentGoal.id !== pendingGoal.id) {
    ctx.ui.notify("启动被中断，已放弃本次 loop。", "warning");
    return;
  }
  // 正式激活并发 START prompt。此后 agent_end / before_agent_start 才会介入推进。
  currentGoal = { ...currentGoal, status: "active", updatedAt: Date.now() };
  persistGoal(currentGoal);
  ctx.ui.setStatus(STATUS_KEY, formatStatus(currentGoal));
  await sendPrompt(pi, ctx, buildStartPrompt(currentGoal));
}

function pauseGoal(ctx: LoopContext) {
  if (!currentGoal || currentGoal.status !== "active") return;
  cancelPendingContinuation();
  currentGoal = { ...currentGoal, status: "paused", updatedAt: Date.now() };
  persistGoal(currentGoal);
  ctx.ui.setStatus(STATUS_KEY, formatStatus(currentGoal));
}

async function resumeGoal(pi: ExtensionAPI, ctx: LoopContext) {
  if (!currentGoal || currentGoal.status !== "paused") return;
  consecutiveErrors = 0;
  currentGoal = { ...currentGoal, status: "active", updatedAt: Date.now() };
  persistGoal(currentGoal);
  ctx.ui.setStatus(STATUS_KEY, formatStatus(currentGoal));
  await sendPrompt(pi, ctx, buildResumePrompt(currentGoal));
}

function clearGoal(ctx: LoopContext) {
  if (!currentGoal) {
    clearActiveGoal(ctx);
    return;
  }
  clearActiveGoal(ctx);
}

function showStatus(ctx: LoopContext) {
  if (!currentGoal) {
    ctx.ui.setStatus(STATUS_KEY, undefined);
    ctx.ui.notify("当前没有 loop。用法：/dloop <goal>", "info");
    return;
  }
  ctx.ui.setStatus(STATUS_KEY, formatStatus(currentGoal));
  ctx.ui.notify(
    [
      `目标：${currentGoal.objective}`,
      `状态：${currentGoal.status}`,
      `轮次：${currentGoal.iteration}`,
      "命令：/dloop pause | /dloop resume | /dloop clear",
    ].join("\n"),
    "info",
  );
}

function createGoal(objective: string): LoopGoal {
  const now = Date.now();
  return {
    id: randomUUID(),
    objective,
    // pending：启动中、START prompt 尚未发出。避免 summarizeContext 慢子进程期间被 agent_end 当活跃 loop 推进。
    status: "pending",
    startedAt: now,
    updatedAt: now,
    iteration: 0,
  };
}

function buildContextBlock(goal: LoopGoal): string {
  // 无背景或明确无额外背景时不注入，避免噪音。
  if (!goal.contextSummary || !goal.contextSummary.trim() || goal.contextSummary.trim() === "无额外背景") {
    return "";
  }
  return `\n\n<loop_context>\n以下是启动前从前文讨论固化的背景，每轮请记住：\n${escapeXml(goal.contextSummary)}\n</loop_context>`;
}

function buildSystemPrompt(goal: LoopGoal) {
  return `当前 /dloop 目标：\n<loop_goal>\n${escapeXml(goal.objective)}\n</loop_goal>${buildContextBlock(goal)}\n\n循环规则：\n- 持续工作直到 /dloop 目标端到端完成。\n- 不要停在分析、计划、TODO 列表、部分修复或建议下一步上。\n- 需要时使用可用工具来实现、检查、调试和验证。\n- 以当前文件、命令输出、测试和外部状态为准。\n- 工具失败时先尝试合理替代方案，再放弃。\n- 完成前逐条核验每项要求与已验证证据。\n- 仅在目标全部完成且验证通过后才调用 loop_complete。`;
}

function buildStartPrompt(goal: LoopGoal) {
  return `Dloop 模式已激活。完整达成以下目标：\n\n<loop_goal>\n${escapeXml(goal.objective)}\n</loop_goal>${buildContextBlock(goal)}\n\n持续工作直到端到端完成。不要停在计划或部分进度上。验证结果后，调用 loop_complete 并附上简要总结和验证证据。`;
}

function buildResumePrompt(goal: LoopGoal) {
  return `恢复当前 /dloop 目标并继续直到完成：\n\n<loop_goal>\n${escapeXml(goal.objective)}\n</loop_goal>${buildContextBlock(goal)}\n\n调用 loop_complete 前先验证。`;
}

function buildContinuePrompt(goal: LoopGoal, marker: string) {
  return `继续当前 /dloop 目标直到完成：\n\n<loop_goal>\n${escapeXml(goal.objective)}\n</loop_goal>${buildContextBlock(goal)}\n\n自动续跑 #${goal.iteration}。从当前已验证状态继续。如果目标已完成，调用 loop_complete 并附上总结和验证证据。\n\n<!-- ${CONTINUATION_MARKER_PREFIX}${marker} -->`;
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
    ctx.ui.notify(`Dloop 续跑失败：${formatError(error)}`, "error");
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
  return isLoopGoal(data?.goal) && data.goal.status !== "complete" && data.goal.status !== "pending"
    ? data.goal
    : undefined;
}

// 从当前会话分支里提取 user/assistant 对话文本，作为摘要子进程的输入素材。
// 只取真实对话：toolResult / bashExecution / custom 等噪音过滤掉，每条裁到合理长度。
function extractPriorDiscussion(ctx: LoopContext, capBytes = CONTEXT_INPUT_CAP_BYTES): string {
  const sessionManager = ctx.sessionManager as
    | { getBranch?: () => SessionBranchEntry[]; getEntries?: () => SessionBranchEntry[] }
    | undefined;
  const entries = sessionManager?.getBranch?.() ?? sessionManager?.getEntries?.() ?? [];
  const lines: string[] = [];
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const message = entry.message;
    if (!message || (message.role !== "user" && message.role !== "assistant")) continue;
    const text = extractMessageText(message.content);
    if (!text.trim()) continue;
    const role = message.role === "user" ? "用户" : "助手";
    lines.push(`[${role}] ${text}`);
  }
  return capPriorDiscussionText(lines, capBytes);
}

export function capPriorDiscussionText(lines: string[], capBytes = CONTEXT_INPUT_CAP_BYTES): string {
  if (lines.length === 0) return "";

  const fullText = lines.join("\n\n");
  if (Buffer.byteLength(fullText, "utf8") <= capBytes) return fullText;

  for (let startIndex = 1; startIndex < lines.length; startIndex += 1) {
    const keptText = lines.slice(startIndex).join("\n\n");
    const omittedText = lines.slice(0, startIndex).join("\n\n");
    const omittedBytes = Buffer.byteLength(omittedText, "utf8");
    const payload = `[Input truncated: ${omittedBytes} bytes omitted]\n\n${keptText}`;
    if (Buffer.byteLength(payload, "utf8") <= capBytes) return payload;
  }

  return truncateOversizedLatestMessage(lines, capBytes);
}

function truncateOversizedLatestMessage(lines: string[], capBytes: number): string {
  const latest = lines[lines.length - 1];
  const earlierText = lines.slice(0, -1).join("\n\n");
  const earlierOmittedBytes = Buffer.byteLength(earlierText, "utf8");
  let latestOmittedBytes = 0;
  let keptLatest = latest;

  for (let attempts = 0; attempts < 3; attempts += 1) {
    const marker = `[Input truncated: ${earlierOmittedBytes + latestOmittedBytes} bytes omitted; ${earlierOmittedBytes} before latest message, ${latestOmittedBytes} from latest message]\n\n`;
    const budget = capBytes - Buffer.byteLength(marker, "utf8");
    const truncated = takeUtf8Tail(latest, budget);
    keptLatest = truncated.text;
    latestOmittedBytes = truncated.omittedBytes;
  }

  return `[Input truncated: ${earlierOmittedBytes + latestOmittedBytes} bytes omitted; ${earlierOmittedBytes} before latest message, ${latestOmittedBytes} from latest message]\n\n${keptLatest}`;
}

function takeUtf8Tail(text: string, maxBytes: number): { text: string; omittedBytes: number } {
  if (maxBytes <= 0) return { text: "", omittedBytes: Buffer.byteLength(text, "utf8") };
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return { text, omittedBytes: 0 };

  const chars = Array.from(text);
  let low = 0;
  let high = chars.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const suffix = chars.slice(mid).join("");
    if (Buffer.byteLength(suffix, "utf8") <= maxBytes) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }

  const omitted = chars.slice(0, low).join("");
  const kept = chars.slice(low).join("");
  return { text: kept, omittedBytes: Buffer.byteLength(omitted, "utf8") };
}

function extractMessageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((item): item is { type: string; text?: string } =>
      !!item && typeof item === "object" && (item as { type?: string }).type === "text"
    )
    .map((item) => item.text ?? "")
    .join("\n");
}

interface ContextSummaryResult {
  summary: string;
  aborted: boolean;
  error?: string;
}

// 起隔离子进程把前文讨论固化成结构化背景（目标范围 / 关键约束 / 验收标准）。
// 与 auditor 同一套 spawn 模式，但纯生成、不给工具：子进程只看喂入的前文文本。
async function summarizeContext(args: {
  ctx: ExtensionContext;
  objective: string;
  priorDiscussion: string;
}): Promise<ContextSummaryResult> {
  const { ctx, objective, priorDiscussion } = args;
  const model = ctx.model;
  const modelId = model ? `${model.provider}/${model.id}` : undefined;

  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-dloop-context-"));
  const promptPath = path.join(tmpDir, "context-summarizer-role.md");
  try {
    await fs.promises.writeFile(promptPath, CONTEXT_SUMMARIZER_SYSTEM_PROMPT, { encoding: "utf-8", mode: 0o600 });

    const procArgs = ["--mode", "json", "-p", "--no-session", "--no-tools"];
    if (modelId) procArgs.push("--model", modelId);
    procArgs.push("--append-system-prompt", promptPath);
    procArgs.push(buildContextSummarizerTask(objective, priorDiscussion));

    const invocation = getPiInvocation(procArgs);
    return await new Promise<ContextSummaryResult>((resolve) => {
      const proc = spawn(invocation.command, invocation.args, {
        cwd: ctx.cwd,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let finalReport = "";
      let stderrText = "";
      let aborted = false;
      let buffer = "";

      const finish = (result: ContextSummaryResult) => {
        proc.removeAllListeners();
        proc.stdout?.removeAllListeners();
        proc.stderr?.removeAllListeners();
        resolve(result);
      };

      const processLine = (line: string) => {
        if (!line.trim()) return;
        let event: { type?: string; message?: { role?: string; content?: Array<{ type: string; text?: string }> } };
        try {
          event = JSON.parse(line);
        } catch {
          return;
        }
        if (event.type === "message_end" && event.message?.role === "assistant") {
          const text = (event.message.content ?? [])
            .filter((part) => part.type === "text" && typeof part.text === "string")
            .map((part) => part.text!)
            .join("\n\n");
          if (text.trim()) finalReport = text;
        }
      };

      proc.stdout.on("data", (data) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) processLine(line);
      });

      proc.stderr.on("data", (data) => {
        stderrText += data.toString();
      });

      proc.on("close", (code) => {
        if (buffer.trim()) processLine(buffer);
        const summary = finalReport.trim();
        if (aborted) {
          finish({ summary: "", aborted: true });
          return;
        }
        if (code !== 0 && !summary) {
          finish({ summary: "", aborted: false, error: truncate(stderrText) || `pi 退出码 ${code}` });
          return;
        }
        finish({ summary, aborted: false });
      });

      proc.on("error", () => {
        if (aborted) return;
        finish({ summary: "", aborted: false, error: "启动 pi 子进程失败" });
      });

      const killProc = () => {
        aborted = true;
        proc.kill("SIGTERM");
        setTimeout(() => {
          if (!proc.killed) proc.kill("SIGKILL");
        }, 5000);
      };
      if (ctx.signal?.aborted) killProc();
      else ctx.signal?.addEventListener("abort", killProc, { once: true });
    });
  } finally {
    try { await fs.promises.rm(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

function buildContextSummarizerTask(objective: string, priorDiscussion: string) {
  return [
    "从下面的用户目标与前文讨论中，提炼出启动这个目标所需的结构化背景。",
    "",
    "<loop_objective>",
    escapeXml(objective),
    "</loop_objective>",
    "",
    "<prior_discussion>",
    escapeXml(priorDiscussion || "（无前文讨论）"),
    "</prior_discussion>",
    "",
    "要求：",
    "1. 只提炼 objective 文本之外、但启动者需要在后续每轮记住的隐含信息。",
    "2. 如果前文讨论中没有超出 objective 的额外约束或验收标准，直接输出“无额外背景”。",
    "3. 不要复述 objective 本身已经写明的目标。",
    "4. 严格用以下三段输出（没有的段写“无”）：",
    "   ## 目标范围补充",
    "   ## 关键约束",
    "   ## 验收标准",
  ].join("\n");
}

const CONTEXT_SUMMARIZER_SYSTEM_PROMPT = [
  "你是 pi-dloop 的会话背景固化员，运行在隔离的零上下文会话里。",
  "你的唯一职责：从启动者提供的“目标”和“前文讨论”中，提炼出后续每轮 loop 都需要记住的结构化背景。",
    "",
  "原则：",
  "- 只记录事实性的隐含信息（讨论中确认的范围边界、设计决策、验收标准、不做什么）。",
  "- objective 本身已写明的内容不要重复。",
  "- 没有额外信息就如实说“无额外背景”，不要生造。",
  "- 不要描述自己的过程，直接输出三段结果。",
].join("\n");

function clearActiveGoal(ctx: LoopContext) {
  cancelPendingContinuation();
  consecutiveErrors = 0;
  currentGoal = undefined;
  persistGoal(null);
  ctx.ui.setStatus(STATUS_KEY, undefined);
}

// 完成并退出 loop。
function finalizeGoal(ctx: LoopContext) {
  const goal = currentGoal;
  if (goal) {
    currentGoal = { ...goal, status: "complete", updatedAt: Date.now() };
    persistGoal(currentGoal);
  }
  cancelPendingContinuation();
  currentGoal = undefined;
  persistGoal(null);
  ctx.ui.setStatus(STATUS_KEY, undefined);
}

// 审核器出错 / 被中断 / 无结论：安全暂停，避免 fail-open 或烧 token 死循环。
function pauseOnAuditFailure(ctx: LoopContext, reason: string) {
  if (!currentGoal) return;
  currentGoal = { ...currentGoal, status: "paused", updatedAt: Date.now() };
  persistGoal(currentGoal);
  clearContinuation();
  ctx.ui.setStatus(STATUS_KEY, formatStatus(currentGoal));
  ctx.ui.notify(`Dloop 已暂停（${reason}）。运行 /dloop resume 继续。`, "warning");
}

interface AuditorResult {
  approved: boolean;
  aborted: boolean;
  output: string;
  error?: string;
}

// 独立完成审核：起一个独立的 pi 子进程（--no-session --mode json --tools 只读），
// 在零上下文里重检目标是否真达成。对齐官方 subagent 示例的子进程隔离方式。
// 理念参考 pi-goal-x 的 auditor 和 pi-dteam 的 check 角色：只读、基于事实逐条判定。
async function runCompletionAuditor(args: {
  ctx: ExtensionContext;
  goal: LoopGoal;
  summary: string;
  verification: string;
}): Promise<AuditorResult> {
  const { ctx, goal, summary, verification } = args;
  const model = ctx.model;
  const modelId = model ? `${model.provider}/${model.id}` : undefined;

  // 角色 system prompt 写临时文件，再用 --append-system-prompt 注入（官方做法，避免命令行长度/转义问题）。
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-dloop-auditor-"));
  const promptPath = path.join(tmpDir, "auditor-role.md");
  try {
    await fs.promises.writeFile(promptPath, AUDITOR_SYSTEM_PROMPT, { encoding: "utf-8", mode: 0o600 });

    const procArgs = ["--mode", "json", "-p", "--no-session", "--tools", AUDITOR_ONLY_TOOLS.join(",")];
    if (modelId) procArgs.push("--model", modelId);
    procArgs.push("--append-system-prompt", promptPath);
    procArgs.push(buildAuditorTask(goal, summary, verification));

    const invocation = getPiInvocation(procArgs);
    return await new Promise<AuditorResult>((resolve) => {
      const proc = spawn(invocation.command, invocation.args, {
        cwd: ctx.cwd,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });

      // 只保留最后一条非空 assistant 文本作为审核报告：
      // auditor 调用 read/grep/find/ls 时每个 turn 的叙述（“我会先读……”等）是过程噪音，
      // 真正的结论（<APPROVED>/<REJECTED>）只在最后一条，拼接进来既难读又可能污染判定。
      let finalReport = "";
      let stderrText = "";
      let aborted = false;
      let buffer = "";

      const finish = (result: AuditorResult) => {
        proc.removeAllListeners();
        proc.stdout?.removeAllListeners();
        proc.stderr?.removeAllListeners();
        resolve(result);
      };

      const processLine = (line: string) => {
        if (!line.trim()) return;
        let event: { type?: string; message?: { role?: string; content?: Array<{ type: string; text?: string }> } };
        try {
          event = JSON.parse(line);
        } catch {
          return;
        }
        if (event.type === "message_end" && event.message?.role === "assistant") {
          const text = (event.message.content ?? [])
            .filter((part) => part.type === "text" && typeof part.text === "string")
            .map((part) => part.text!)
            .join("\n\n");
          // 非空才覆盖：最后一条空文本（如纯工具调用）时不丢掉上一个真实报告。
          if (text.trim()) finalReport = text;
        }
      };

      proc.stdout.on("data", (data) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) processLine(line);
      });

      proc.stderr.on("data", (data) => {
        stderrText += data.toString();
      });

      proc.on("close", (code) => {
        if (buffer.trim()) processLine(buffer);
        const output = finalReport.trim();
        if (aborted) {
          finish({ approved: false, aborted: true, output });
          return;
        }
        // 子进程非零退出且无 assistant 输出 → 审核器未正常完成。
        if (code !== 0 && !output) {
          finish({ approved: false, aborted: false, output: "", error: truncate(stderrText) || `pi 退出码 ${code}` });
          return;
        }
        finish({ approved: parseAuditorDecision(output), aborted: false, output });
      });

      proc.on("error", () => {
        if (aborted) return;
        finish({ approved: false, aborted: false, output: "", error: "启动 pi 子进程失败" });
      });

      // 中断传播：用户 Esc 当前 turn 时，杀掉审核子进程。
      const killProc = () => {
        aborted = true;
        proc.kill("SIGTERM");
        setTimeout(() => {
          if (!proc.killed) proc.kill("SIGKILL");
        }, 5000);
      };
      if (ctx.signal?.aborted) killProc();
      else ctx.signal?.addEventListener("abort", killProc, { once: true });
    });
  } finally {
    try { await fs.promises.rm(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

// 决定用哪个命令跑子进程：优先复用当前 pi 进程的入口（同版本同环境），否则回退到 `pi`。
// 复刻官方 subagent 示例的 getPiInvocation：避免在 bun 虚拟脚本下误用 process.argv[1]。
function getPiInvocation(extraArgs: string[]): { command: string; args: string[] } {
  const currentScript = process.argv[1];
  const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
  if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...extraArgs] };
  }
  const execName = path.basename(process.execPath).toLowerCase();
  const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
  if (!isGenericRuntime) {
    return { command: process.execPath, args: extraArgs };
  }
  return { command: "pi", args: extraArgs };
}

function parseAuditorDecision(output: string): boolean {
  if (!output) return false;
  const approved = output.includes(APPROVED_MARKER);
  const rejected = output.includes(REJECTED_MARKER);
  return approved && !rejected;
}

function buildAuditorTask(goal: LoopGoal, summary: string, verification: string) {
  return [
    "判定下面的 /dloop 目标是否真的完成。",
    "",
    "<loop_goal>",
    escapeXml(goal.objective),
    "</loop_goal>",
    "",
    "Agent 声称的完成说明：",
    summary || "（未提供）",
    "",
    "Agent 声称的验证证据：",
    verification || "（未提供）",
    "",
    "审核检查清单：",
    "1. 从目标里抽出真实的成功标准（含质量 / 用户可感知结果，不只是“代码存在”）。",
    "2. 用 read/grep/find/ls 实地检查能证明或证伪这些标准的工件或输出。",
    "3. agent 声称跑过测试 / 搜索过引用时，用真实的文件证据复核——声明不是证明。",
    "4. 解释任何缺失或弱的证据，特别是“脚手架 vs 最终交付”的质量落差。",
    "5. 结论行只能是 <APPROVED>（目标真正达成）或 <REJECTED>（否则）。",
  ].join("\n");
}

const AUDITOR_SYSTEM_PROMPT = [
  "你是 pi-dloop 的独立完成审核员（auditor），运行在一个隔离的零上下文会话里。",
  "你的唯一职责：判定 agent 声称完成的目标是否真的达成。",
  "",
  "原则：",
  "- 基于代码事实和文件证据判定，不基于 agent 的自述或感觉。",
  "- 逐条对照目标里的可验证要求，用 read/grep/find/ls 实地核验。",
  "- 若证据是“生成了脚手架 / 占位代码 / 仅 build 通过 / proxy 指标”，且用户目标未被真实满足，判 REJECTED。",
  "- 若有任何要求缺失、弱验证、矛盾、无法用证据检验，判 REJECTED。",
  "- 你只有只读工具，不能也不会修改任何文件。",
  "- 最后必须给出简短审核报告，并以唯一一个标记结尾：",
  "    通过： <APPROVED>",
  "    不通过：<REJECTED>",
].join("\n");

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
    ["pending", "active", "paused", "complete"].includes(String(goal.status)) &&
    typeof goal.startedAt === "number" &&
    typeof goal.updatedAt === "number" &&
    typeof goal.iteration === "number"
  );
}

function formatStatus(goal: LoopGoal | undefined) {
  if (!goal) return undefined;
  if (goal.status === "complete") return "🔁 complete";
  if (goal.status === "paused") return "🔁 paused";
  if (goal.status === "pending") return "🔁 starting…";
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

function truncate(value: string, max = 160) {
  return value.length > max ? `${value.slice(0, Math.max(0, max - 3))}...` : value;
}
