import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  __getGoalForTest,
  __resetGoalForTest,
  __resetSpawnManagedSubprocessForTest,
  __setApiForTest,
  __setCompletionAuditorOverrideForTest,
  __setGoalForTest,
  __setSpawnManagedSubprocessForTest,
  goalCheckTool,
  phaseCheckTool,
  workUpdateTool,
} from "../index.ts";

let tempDir = "";
let originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const ctx = {
  cwd: process.cwd(),
  model: { provider: "openai", id: "gpt-5" },
  isProjectTrusted: () => true,
  ui: { notify: () => {}, setStatus: () => {}, setWidget: () => {} },
  sessionManager: { getBranch: () => [] },
} as never;

beforeEach(() => {
  __resetGoalForTest();
  originalAgentDir = process.env.PI_CODING_AGENT_DIR;
  tempDir = mkdtempSync(join(tmpdir(), "pi-dgoal-audit-prod-"));
  process.env.PI_CODING_AGENT_DIR = tempDir;
  __setApiForTest({ appendEntry: () => {} });
});

afterEach(() => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  rmSync(tempDir, { recursive: true, force: true });
  __resetSpawnManagedSubprocessForTest();
  __setCompletionAuditorOverrideForTest(undefined);
});

function fakeAudit(events: object[], pid = 42): void {
  __setSpawnManagedSubprocessForTest(() => {
    const stdout = new EventEmitter();
    const proc = new EventEmitter() as any;
    proc.stdout = stdout;
    proc.stderr = new EventEmitter();
    proc.stdin = { write: (_value: string, callback?: (error?: Error | null) => void) => callback?.() };
    proc.pid = pid;
    proc.exitCode = null;
    proc.signalCode = null;
    proc.kill = () => { proc.exitCode = 0; proc.signalCode = "SIGTERM"; };
    setTimeout(() => {
      for (const event of events) stdout.emit("data", `${JSON.stringify(event)}\n`);
      proc.exitCode = 0;
      proc.emit("close", 0);
    }, 0);
    return proc;
  });
}

function setGoalPlan(id: string, phaseStatus: "in_progress" | "done" = "in_progress"): void {
  __setGoalForTest({
    id,
    objective: "审核回归",
    description: "验证审核结果、因果顺序、checkpoint 与 usage 持久化。",
    status: "active",
    startedAt: 1,
    updatedAt: 1,
    iteration: 0,
    workList: {
      revision: 0,
      nextItemId: 2,
      nextPhaseId: 2,
      items: [],
      phases: [{
        id: 1,
        subject: "验收",
        description: "独立验收当前阶段。",
        status: phaseStatus,
        revision: 0,
        acceptanceCriteria: [{ criterion: "阶段可测试", evidence: "npm test" }],
        items: [{ id: 1, subject: "实现", description: "完成实现。", status: "done", evidence: "npm test" }],
      }],
    },
    contract: {
      id: `run-${id}`,
      profile: "staged_check",
      startedAt: 1,
      revision: 0,
      transitions: [{ to: "staged_check", at: 1, revision: 0 }],
      verification: "npm test",
      acceptanceCriteria: [{ criterion: "目标可测试", evidence: "npm test" }],
    },
  });
}

const phaseCheck = () => phaseCheckTool.execute("test", { phaseId: 1 }, undefined, undefined, ctx);
const goalCheck = () => goalCheckTool.execute("test", { summary: "完成", verification: "npm test" }, undefined, undefined, ctx);

test("phase rejection wins over a WebSocket error in the same message_end", async () => {
  fakeAudit([{ type: "message_end", message: {
    role: "assistant", content: [{ type: "text", text: "## 结论\n<REJECTED>" }], errorMessage: "WebSocket error",
  } }]);
  setGoalPlan("phase-report-priority");
  const result = await phaseCheck();
  expect(result.isError).toBe(false);
  expect(result.details?.approved).toBe(false);
  expect(__getGoalForTest()?.status).toBe("active");
  expect(__getGoalForTest()?.workList?.phases[0].check?.status).toBe("rejected");
  expect(__getGoalForTest()?.workList?.phases[0].feedback?.report).toContain("<REJECTED>");
});

test("goal approval wins over a WebSocket error; work_update finalizes afterward", async () => {
  fakeAudit([{ type: "message_end", message: {
    role: "assistant", content: [{ type: "text", text: "## 结论\n<APPROVED>" }], errorMessage: "WebSocket error",
  } }], 43);
  const persisted: Array<{ type: string; data: any }> = [];
  __setApiForTest({ appendEntry: (type: string, data: any) => persisted.push({ type, data }) });
  setGoalPlan("goal-report-priority", "done");
  const checked = await goalCheck();
  expect(checked.details?.approved).toBe(true);
  expect(__getGoalForTest()?.status).toBe("active");
  expect(__getGoalForTest()?.contract?.goalCheck?.report).toContain("<APPROVED>");
  const finished = await workUpdateTool.execute("test", { target: "goal", status: "done", summary: "完成", verification: "npm test" }, undefined, undefined, ctx);
  expect(finished.details?.completed).toBe(true);
  expect(__getGoalForTest()).toBeUndefined();
  expect(persisted.at(-1)?.data.goal).toBeNull();
});

test("goal_check keeps the pre-call active state; only work_update writes done", async () => {
  let observedStatus: string | undefined;
  __setCompletionAuditorOverrideForTest(async () => {
    observedStatus = __getGoalForTest()?.status;
    return { approved: true, output: "<APPROVED>", modelId: "test/auditor", liveness: "approved" };
  });
  setGoalPlan("causal-order", "done");
  const checked = await goalCheck();
  expect(observedStatus).toBe("active");
  expect(checked.details?.approved).toBe(true);
  expect(__getGoalForTest()?.status).toBe("active");
  await workUpdateTool.execute("test", { target: "goal", status: "done", summary: "完成", verification: "npm test" }, undefined, undefined, ctx);
  expect(__getGoalForTest()).toBeUndefined();
});

test("successful auditor tool events persist one final reusable checkpoint and usage record", async () => {
  fakeAudit([
    { type: "tool_execution_start", toolCallId: "bash-1", toolName: "bash", args: { command: "printf checkpoint" } },
    { type: "tool_execution_end", toolCallId: "bash-1", toolName: "bash", result: { content: [] }, isError: false },
    { type: "message_end", message: {
      role: "assistant", content: [{ type: "text", text: "<APPROVED>" }],
      usage: { input: 12, output: 8, totalTokens: 20, cost: { input: 0.12, output: 0.08 } },
    } },
  ], 44);
  const persisted: Array<{ type: string; data: any }> = [];
  __setApiForTest({ appendEntry: (type: string, data: any) => persisted.push({ type, data }) });
  setGoalPlan("checkpoint-and-usage");
  const result = await phaseCheck();
  expect(result.details?.approved).toBe(true);
  expect(__getGoalForTest()?.contract?.auditCheckpoints?.phase?.records).toEqual([expect.objectContaining({
    toolName: "bash", args: { command: "printf checkpoint" }, started: true, ended: true, status: "success",
  })]);
  // 候选健康状态与 phase check 终态各写一次；逐工具 start/end 不得追加全量 Goal。
  expect(persisted).toHaveLength(2);
  expect(persisted.at(-1)?.data.goal.contract.auditCheckpoints.phase.records).toEqual([expect.objectContaining({ status: "success" })]);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const records = readFileSync(join(tempDir, "audit-usage.jsonl"), "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ scope: "phase", model: "openai/gpt-5", usage: { input: 12, output: 8, totalTokens: 20 } });
});

test("mismatched or unknown tool end events never become successful checkpoints", async () => {
  fakeAudit([
    { type: "tool_execution_start", toolCallId: "mismatch", toolName: "bash", args: { command: "printf mismatch" } },
    { type: "tool_execution_end", toolCallId: "mismatch", toolName: "read", isError: false },
    { type: "tool_execution_start", toolCallId: "unknown", toolName: "bash", args: { command: "printf unknown" } },
    { type: "tool_execution_end", toolCallId: "unknown", toolName: "bash" },
    { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "<APPROVED>" }] } },
  ], 46);
  setGoalPlan("invalid-checkpoint");
  const result = await phaseCheck();
  expect(result.details?.approved).toBe(true);
  const records = __getGoalForTest()?.contract?.auditCheckpoints?.phase?.records ?? [];
  expect(records.some((record) => record.status === "success")).toBe(false);
});
