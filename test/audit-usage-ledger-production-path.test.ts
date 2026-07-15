import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  __executeDgoalCheckForTest,
  __executeDgoalDoneForTest,
  __getGoalForTest,
  __resetGoalForTest,
  __setApiForTest,
  __setCompletionAuditorOverrideForTest,
  __setGoalForTest,
  __setSpawnManagedSubprocessForTest,
  __resetSpawnManagedSubprocessForTest,
} from "../index.ts";

let tempDir = "";
let originalAgentDir = process.env.PI_CODING_AGENT_DIR;

beforeEach(() => {
  __resetGoalForTest();
  originalAgentDir = process.env.PI_CODING_AGENT_DIR;
  tempDir = mkdtempSync(join(tmpdir(), "pi-dgoal-audit-prod-"));
  process.env.PI_CODING_AGENT_DIR = tempDir;
});

afterEach(() => {
  if (originalAgentDir === undefined) {
    delete process.env.PI_CODING_AGENT_DIR;
  } else {
    process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  }
  rmSync(tempDir, { recursive: true, force: true });
  __resetSpawnManagedSubprocessForTest();
});

test("有效审核结论优先于同一 message_end 的 WebSocket error", async () => {
  __setSpawnManagedSubprocessForTest((_command, _args, _cwd) => {
    const stdout = new EventEmitter();
    const proc = new EventEmitter() as any;
    proc.stdout = stdout;
    proc.stderr = new EventEmitter();
    proc.stdin = { write: (_value: string, cb?: (err?: Error | null) => void) => cb?.() };
    proc.pid = 42;
    proc.exitCode = null;
    proc.signalCode = null;
    proc.kill = () => {
      proc.exitCode = 0;
      proc.signalCode = "SIGTERM";
    };
    setTimeout(() => {
      stdout.emit("data", `${JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "## 验收结论\n<REJECTED>" }],
          errorMessage: "WebSocket error",
        },
      })}\n`);
      proc.exitCode = 0;
      proc.emit("close", 0);
    }, 0);
    return proc;
  });

  const persisted: Array<{ type: string; data?: any }> = [];
  __setApiForTest({ appendEntry: (type: string, data: any) => persisted.push({ type, data }) });
  __setGoalForTest({
    id: "audit-websocket-report",
    objective: "报告优先级回归",
    status: "active",
    startedAt: 1,
    updatedAt: 1,
    iteration: 0,
    verification: "npm test",
    acceptanceCriteria: [{ criterion: "目标可测试", evidence: "npm test" }],
    plan: {
      phases: [
        { id: 1, subject: "验收", status: "in_progress", tasks: [{ id: 2, subject: "实现", status: "done", evidence: "npm test" }] },
        { id: 3, subject: "后续", status: "pending", tasks: [] },
      ],
      nextId: 4,
    },
  } as never);

  const result = await __executeDgoalCheckForTest(
    { phaseId: 1 },
    {
      cwd: process.cwd(),
      model: { provider: "openai", id: "gpt-5" },
      isProjectTrusted: () => true,
      ui: { notify: () => {} },
    } as never,
  );

  expect(result.isError).toBe(false);
  expect(result.details?.approved).toBe(false);
  expect(result.details?.liveness).toBe("rejected");
  expect(__getGoalForTest()?.status).toBe("active");
  expect(__getGoalForTest()?.pauseReason).toBeUndefined();
  expect(persisted.at(-1)?.data.goal?.phaseFeedbackById?.["1"]?.report).toContain("<REJECTED>");
});

test("goal 终审 APPROVED 优先于同一 message_end 的 WebSocket error", async () => {
  __setSpawnManagedSubprocessForTest((_command, _args, _cwd) => {
    const stdout = new EventEmitter();
    const proc = new EventEmitter() as any;
    proc.stdout = stdout;
    proc.stderr = new EventEmitter();
    proc.stdin = { write: (_value: string, cb?: (err?: Error | null) => void) => cb?.() };
    proc.pid = 43;
    proc.exitCode = null;
    proc.signalCode = null;
    proc.kill = () => {
      proc.exitCode = 0;
      proc.signalCode = "SIGTERM";
    };
    setTimeout(() => {
      stdout.emit("data", `${JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "## 验收结论\n<APPROVED>" }],
          errorMessage: "WebSocket error",
        },
      })}\n`);
      proc.exitCode = 0;
      proc.emit("close", 0);
    }, 0);
    return proc;
  });

  const persisted: Array<{ type: string; data?: any }> = [];
  __setApiForTest({ appendEntry: (type: string, data: any) => persisted.push({ type, data }) });
  __setGoalForTest({
    id: "audit-websocket-goal",
    objective: "终审报告优先级回归",
    status: "active",
    startedAt: 1,
    updatedAt: 1,
    iteration: 0,
    verification: "npm test",
    acceptanceCriteria: [{ criterion: "目标可测试", evidence: "npm test" }],
    plan: {
      phases: [
        { id: 1, subject: "阶段一", status: "done", tasks: [{ id: 2, subject: "实现一", status: "done", evidence: "npm test" }] },
        { id: 3, subject: "阶段二", status: "done", tasks: [{ id: 4, subject: "实现二", status: "done", evidence: "npm test" }] },
      ],
      nextId: 5,
    },
  } as never);

  const result = await __executeDgoalDoneForTest(
    { summary: "完成", verification: "npm test" },
    {
      cwd: process.cwd(),
      model: { provider: "openai", id: "gpt-5" },
      isProjectTrusted: () => true,
      ui: { notify: () => {} },
    } as never,
  );

  expect(result.isError).not.toBe(true);
  expect(result.details?.audited).toBe(true);
  expect(result.details?.auditOutput).toContain("<APPROVED>");
  expect(__getGoalForTest()).toBeUndefined();
  expect(persisted.at(-1)?.data.goal).toBeNull();
});

test("dgoal_done 审核期间保持调用前状态，APPROVED 后才 finalize", async () => {
  __setApiForTest({ appendEntry: () => {} });
  for (const status of ["active", "rejected"] as const) {
    __resetGoalForTest();
    let observedStatus: string | undefined;
    __setCompletionAuditorOverrideForTest(async () => {
      observedStatus = __getGoalForTest()?.status;
      return { approved: true, aborted: false, output: "<APPROVED>", modelId: "test/auditor", liveness: "approved" };
    });
    __setGoalForTest({
      id: `causal-${status}`, objective: "终审因果时序", status,
      startedAt: 1, updatedAt: 1, iteration: 0,
      verification: "bun test", verificationPolicy: "final_only",
      acceptanceCriteria: [{ criterion: "测试通过", evidence: "bun test" }],
      plan: {
        phases: [{ id: 1, subject: "交付", status: "in_progress", progressCompleted: true, tasks: [{ id: 2, subject: "实现", status: "done", evidence: "bun test" }] }],
        nextId: 3,
      },
    } as never);
    const result = await __executeDgoalDoneForTest({
      summary: "完成", verification: "bun test",
      verificationBundle: { changes: "none", acceptanceEvidence: "bun test", selfTest: "bun test", risks: "none" },
    }, { cwd: process.cwd(), ui: { notify: () => {} } } as never);
    expect(observedStatus).toBe(status);
    expect(result.details?.audited).toBe(true);
    expect(__getGoalForTest()).toBeUndefined();
  }
  __setCompletionAuditorOverrideForTest(undefined);
});

test("审核 child 的成功 bash 事件会持久化为可恢复 phase 检查点", async () => {
  __setSpawnManagedSubprocessForTest((_command, _args, _cwd) => {
    const stdout = new EventEmitter();
    const proc = new EventEmitter() as any;
    proc.stdout = stdout;
    proc.stderr = new EventEmitter();
    proc.stdin = { write: (_value: string, cb?: (err?: Error | null) => void) => cb?.() };
    proc.pid = 44;
    proc.exitCode = null;
    proc.signalCode = null;
    proc.kill = () => { proc.exitCode = 0; proc.signalCode = "SIGTERM"; };
    setTimeout(() => {
      stdout.emit("data", `${JSON.stringify({
        type: "tool_execution_start",
        toolCallId: "checkpoint-bash",
        toolName: "bash",
        args: { command: "printf checkpoint" },
      })}\n`);
      stdout.emit("data", `${JSON.stringify({
        type: "tool_execution_end",
        toolCallId: "checkpoint-bash",
        toolName: "bash",
        result: { content: [{ type: "text", text: "checkpoint" }] },
        isError: false,
      })}\n`);
      stdout.emit("data", `${JSON.stringify({
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: "<APPROVED>" }] },
      })}\n`);
      proc.exitCode = 0;
      proc.emit("close", 0);
    }, 0);
    return proc;
  });

  __setApiForTest({ appendEntry: () => {} });
  __setGoalForTest({
    id: "checkpoint-production-path",
    objective: "审核检查点回归",
    status: "active",
    startedAt: 1,
    updatedAt: 1,
    iteration: 0,
    verification: "npm test",
    acceptanceCriteria: [{ criterion: "目标可测试", evidence: "npm test" }],
    plan: {
      phases: [
        { id: 1, subject: "验收", status: "in_progress", tasks: [{ id: 2, subject: "实现", status: "done", evidence: "npm test" }] },
        { id: 3, subject: "后续", status: "pending", tasks: [] },
      ],
      nextId: 4,
    },
  } as never);

  const result = await __executeDgoalCheckForTest(
    { phaseId: 1 },
    { cwd: process.cwd(), model: { provider: "openai", id: "gpt-5" }, isProjectTrusted: () => true, ui: { notify: () => {} } } as never,
  );

  expect(result.details?.approved).toBe(true);
  const checkpoint = __getGoalForTest()?.auditCheckpoints?.phase;
  expect(checkpoint?.records).toEqual([expect.objectContaining({
    toolName: "bash",
    args: { command: "printf checkpoint" },
    started: true,
    ended: true,
    status: "success",
  })]);
});

test("异常 tool_execution_end 不能生成可复用成功检查点", async () => {
  __setSpawnManagedSubprocessForTest((_command, _args, _cwd) => {
    const stdout = new EventEmitter();
    const proc = new EventEmitter() as any;
    proc.stdout = stdout;
    proc.stderr = new EventEmitter();
    proc.stdin = { write: (_value: string, cb?: (err?: Error | null) => void) => cb?.() };
    proc.pid = 46;
    proc.exitCode = null;
    proc.signalCode = null;
    proc.kill = () => { proc.exitCode = 0; proc.signalCode = "SIGTERM"; };
    setTimeout(() => {
      stdout.emit("data", `${JSON.stringify({
        type: "tool_execution_start",
        toolCallId: "mismatched-tool",
        toolName: "bash",
        args: { command: "printf mismatch" },
      })}\n`);
      stdout.emit("data", `${JSON.stringify({
        type: "tool_execution_end",
        toolCallId: "mismatched-tool",
        toolName: "read",
        isError: false,
      })}\n`);
      stdout.emit("data", `${JSON.stringify({
        type: "tool_execution_start",
        toolCallId: "unknown-status",
        toolName: "bash",
        args: { command: "printf unknown" },
      })}\n`);
      stdout.emit("data", `${JSON.stringify({
        type: "tool_execution_end",
        toolCallId: "unknown-status",
        toolName: "bash",
      })}\n`);
      stdout.emit("data", `${JSON.stringify({
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: "<APPROVED>" }] },
      })}\n`);
      proc.exitCode = 0;
      proc.emit("close", 0);
    }, 0);
    return proc;
  });

  __setApiForTest({ appendEntry: () => {} });
  __setGoalForTest({
    id: "checkpoint-invalid-end",
    objective: "校验异常审核事件",
    status: "active",
    startedAt: 1,
    updatedAt: 1,
    iteration: 0,
    verification: "npm test",
    acceptanceCriteria: [{ criterion: "目标可测试", evidence: "npm test" }],
    plan: {
      phases: [
        { id: 1, subject: "验收", status: "in_progress", tasks: [{ id: 2, subject: "实现", status: "done", evidence: "npm test" }] },
        { id: 3, subject: "后续", status: "pending", tasks: [] },
      ],
      nextId: 4,
    },
  } as never);

  const result = await __executeDgoalCheckForTest(
    { phaseId: 1 },
    { cwd: process.cwd(), model: { provider: "openai", id: "gpt-5" }, isProjectTrusted: () => true, ui: { notify: () => {} } } as never,
  );

  expect(result.details?.approved).toBe(true);
  const records = __getGoalForTest()?.auditCheckpoints?.phase?.records ?? [];
  expect(records.some((record) => record.status === "success")).toBe(false);
});

test("生产审核 child message_end.usage 可写入 audit-usage jsonl", async () => {
  const spawnCalls: { command?: string; cwd?: string }[] = [];
  __setSpawnManagedSubprocessForTest((command, _args, cwd) => {
    spawnCalls.push({ command, cwd });
    const stdout = new EventEmitter();
    const proc = new EventEmitter() as any;
    proc.stdout = stdout;
    proc.stderr = new EventEmitter();
    proc.stdin = { write: (_value: string, cb?: (err?: Error | null) => void) => cb?.() };
    proc.pid = 42;
    proc.exitCode = null;
    proc.signalCode = null;
    proc.kill = () => {
      proc.exitCode = 0;
      proc.signalCode = "SIGTERM";
    };
    setTimeout(() => {
      stdout.emit("data", `${JSON.stringify({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "审查中" },
      })}\n`);
      stdout.emit("data", `${JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "<APPROVED> unified phase check" }],
          usage: {
            input: 12,
            output: 8,
            totalTokens: 20,
            cost: { input: 0.12, output: 0.08 },
          },
        },
      })}\n`);
      proc.exitCode = 0;
      proc.emit("close", 0);
    }, 0);

    return proc;
  });

  const persisted: Array<{ type: string }> = [];
  __setApiForTest({ appendEntry: (type: string) => persisted.push({ type }) });
  __setGoalForTest({
    id: "auditor-production-path",
    objective: "单 phase 统一建检账本回归",
    status: "active",
    startedAt: 1,
    updatedAt: 1,
    iteration: 0,
    verification: "npm test",
    acceptanceCriteria: [{ criterion: "目标可测试", evidence: "npm test" }],
    plan: {
      phases: [{ id: 1, subject: "验收", status: "in_progress", tasks: [{ id: 2, subject: "实现", status: "done", evidence: "npm test" }] }],
      nextId: 3,
    },
  } as never);

  const result = await __executeDgoalCheckForTest(
    { phaseId: 1 },
    {
      cwd: process.cwd(),
      model: { provider: "openai", id: "gpt-5" },
      isProjectTrusted: () => true,
      ui: { notify: () => {} },
    } as never,
  );
  expect(result.details?.approved).toBe(true);
  expect(spawnCalls).toHaveLength(1);
  expect(__getGoalForTest()?.singlePhaseAudit?.modelId).toBe("openai/gpt-5");

  await new Promise((resolve) => setTimeout(resolve, 20));
  const lines = readFileSync(join(tempDir, "audit-usage.jsonl"), "utf-8").trim().split("\n").filter(Boolean);
  expect(lines).toHaveLength(1);
  const record = JSON.parse(lines[0]);
  expect(record.scope).toBe("goal");
  expect(record.model).toBe("openai/gpt-5");
  expect(record.usage).toMatchObject({
    input: 12,
    output: 8,
    totalTokens: 20,
    cost: { input: 0.12, output: 0.08 },
  });

  expect(persisted.length).toBeGreaterThanOrEqual(2);
  expect(persisted.every((entry) => entry.type === "dgoal-goal-vnext")).toBe(true);
});
