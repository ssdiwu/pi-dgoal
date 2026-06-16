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

const STATUS_KEY = "dloop";
const STATE_ENTRY_TYPE = "dloop-state";
const MAX_OBJECTIVE_LENGTH = 8_000;
const CONTINUATION_MARKER_PREFIX = "pi-dloop-continuation:";

let currentGoal: LoopGoal | undefined;
let api: ExtensionAPI | undefined;
let pendingContinuation: { goalId: string; marker: string } | undefined;
const cancelledMarkers = new Set<string>();

const loopCompleteTool = defineTool({
  name: "loop_complete",
  label: "Loop Complete",
  description:
    "Mark the active /dloop goal as complete. Only call this after the goal is fully done and verified.",
  promptSnippet: "Mark the active /dloop goal as complete after full verification",
  promptGuidelines: [
    "When a /dloop goal is active, keep working until it is complete; do not stop with only a plan, TODO list, or partial progress.",
    "Call loop_complete only after auditing every requirement against current files, command output, tests, or external state.",
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
          { type: "text", text: "No active /dloop goal to complete." },
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
          { type: "text", text: `Loop complete (audit skipped).\nSummary: ${summary}\nVerification: ${verification}` },
        ],
        details: { goal: completedGoal.objective, summary, verification, audited: false },
        terminate: true,
      };
    }

    ctx.ui.notify("Dloop 正在运行独立完成审核…", "info");

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
          { type: "text", text: `Audit failed to run; goal paused for review. Run /dloop resume to continue and retry completion.\nError: ${formatError(error)}` },
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
          { type: "text", text: `Audit did not produce a decision; goal paused. ${audit.output ? `\nReport: ${audit.output}` : ""}` },
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
            text: `Audit REJECTED completion. The goal remains active. Fix the issues below and call loop_complete again when truly done.\n\nAudit report:\n${audit.output}`,
          },
        ],
        details: { goal: completedGoal.objective, summary, verification, auditRejected: true, auditOutput: audit.output },
        terminate: false,
      };
    }

    finalizeGoal(ctx);
    return {
      content: [
        { type: "text", text: `Loop complete. Audit APPROVED.\nSummary: ${summary}\nVerification: ${verification}` },
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
    if (finalAssistant?.stopReason === "aborted" || finalAssistant?.stopReason === "error") {
      currentGoal = { ...currentGoal, status: "paused", updatedAt: Date.now() };
      persistGoal(currentGoal);
      clearContinuation();
      ctx.ui.setStatus(STATUS_KEY, formatStatus(currentGoal));
      const reason = finalAssistant.stopReason === "aborted" ? "用户中断" : "模型错误";
      const detail = finalAssistant.errorMessage ? `：${truncate(finalAssistant.errorMessage)}` : "";
      ctx.ui.notify(`Dloop 已暂停（${reason}${detail}）。运行 /dloop resume 继续。`, "warning");
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
    return `目标太长（${text.length}/${MAX_OBJECTIVE_LENGTH} 字符）。请放到文件中，并在 /dloop 中引用路径。`;
  }
  return { kind: "start", objective: text };
}

async function startGoal(objective: string, pi: ExtensionAPI, ctx: LoopContext) {
  if (!objective.trim()) {
    ctx.ui.notify("用法：/dloop <goal>", "warning");
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
  ctx.ui.notify(`Dloop 已启动：${currentGoal.objective}`, "info");
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
  ctx.ui.notify("Dloop 已暂停。", "info");
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
  ctx.ui.notify("Dloop 已恢复。", "info");
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
  ctx.ui.notify(`Dloop 已清除：${objective}`, "warning");
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
    status: "active",
    startedAt: now,
    updatedAt: now,
    iteration: 0,
  };
}

function buildSystemPrompt(goal: LoopGoal) {
  return `Active /dloop goal:\n<loop_goal>\n${escapeXml(goal.objective)}\n</loop_goal>\n\nLoop rules:\n- Keep working until the active /dloop goal is complete end-to-end.\n- Do not stop with only analysis, a plan, a TODO list, partial fixes, or suggested next steps.\n- Use available tools to implement, inspect, debug, and verify when needed.\n- Treat current files, command outputs, tests, and external state as authoritative.\n- If a tool fails, try reasonable alternatives before yielding.\n- Before completion, audit every requirement against verified evidence.\n- Only call loop_complete after the whole goal is complete and verified.`;
}

function buildStartPrompt(goal: LoopGoal) {
  return `Loops mode is active. Complete this goal fully:\n\n<loop_goal>\n${escapeXml(goal.objective)}\n</loop_goal>\n\nKeep going until it is done end-to-end. Do not stop at a plan or partial progress. Verify the result, then call loop_complete with a concise summary and verification evidence.`;
}

function buildResumePrompt(goal: LoopGoal) {
  return `Resume the active /dloop goal and continue until complete:\n\n<loop_goal>\n${escapeXml(goal.objective)}\n</loop_goal>\n\nVerify before calling loop_complete.`;
}

function buildContinuePrompt(goal: LoopGoal, marker: string) {
  return `Continue the active /dloop goal until it is complete:\n\n<loop_goal>\n${escapeXml(goal.objective)}\n</loop_goal>\n\nAutomatic continuation #${goal.iteration}. Continue from the current verified state. If the goal is complete, call loop_complete with summary and verification evidence.\n\n<!-- ${CONTINUATION_MARKER_PREFIX}${marker} -->`;
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
  return isLoopGoal(data?.goal) && data.goal.status !== "complete" ? data.goal : undefined;
}

function clearActiveGoal(ctx: LoopContext) {
  cancelPendingContinuation();
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

      const parts: string[] = [];
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
          for (const part of event.message.content ?? []) {
            if (part.type === "text" && typeof part.text === "string") parts.push(part.text);
          }
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
        const output = parts.join("\n\n").trim();
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
