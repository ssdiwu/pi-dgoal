import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  __executeDgoalCheckForTest,
  __getGoalForTest,
  __resetGoalForTest,
  __setApiForTest,
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

  expect(persisted.length).toBe(1);
  expect(persisted[0]?.type).toBe("dgoal-goal-vnext");
});
