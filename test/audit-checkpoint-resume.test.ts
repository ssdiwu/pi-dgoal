import { EventEmitter } from "node:events";
import { afterEach, expect, test } from "bun:test";
import {
  __executeDgoalCheckForTest,
  __fingerprintAuditWorkspaceForTest,
  __resetGoalForTest,
  __resetSpawnManagedSubprocessForTest,
  __setApiForTest,
  __setGoalForTest,
  __setSpawnManagedSubprocessForTest,
} from "../index.ts";
import { applyCheckpointEvent } from "../src/audit/checkpoint.ts";

afterEach(() => {
  __resetGoalForTest();
  __resetSpawnManagedSubprocessForTest();
});

test("重启后的阶段审核会把同工作区的成功命令检查点交给新的独立审核器", async () => {
  const cwd = process.cwd();
  const checkpoint = applyCheckpointEvent(
    { workspaceFingerprint: __fingerprintAuditWorkspaceForTest(cwd), records: [] },
    {
      workspaceFingerprint: __fingerprintAuditWorkspaceForTest(cwd),
      toolName: "bash",
      args: { command: "npm test" },
      phase: "end",
      status: "success",
    },
  );
  const spawnArgs: string[][] = [];
  __setSpawnManagedSubprocessForTest((_command, args) => {
    spawnArgs.push(args);
    const stdout = new EventEmitter();
    const proc = new EventEmitter() as any;
    proc.stdout = stdout;
    proc.stderr = new EventEmitter();
    proc.stdin = { write: (_value: string, callback?: (error?: Error | null) => void) => callback?.() };
    proc.pid = 45;
    proc.exitCode = null;
    proc.signalCode = null;
    proc.kill = () => { proc.exitCode = 0; proc.signalCode = "SIGTERM"; };
    setTimeout(() => {
      stdout.emit("data", `${JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "<APPROVED>" }] } })}\n`);
      proc.exitCode = 0;
      proc.emit("close", 0);
    }, 0);
    return proc;
  });
  __setApiForTest({ appendEntry: () => {} });
  __setGoalForTest({
    id: "checkpoint-resume",
    objective: "恢复检查点",
    status: "active",
    startedAt: 1,
    updatedAt: 1,
    iteration: 0,
    verification: "npm test",
    acceptanceCriteria: [{ criterion: "阶段可测", evidence: "npm test" }],
    auditCheckpoints: { phase: checkpoint },
    plan: {
      phases: [
        { id: 1, subject: "验证", status: "in_progress", tasks: [{ id: 2, subject: "实现", status: "done", evidence: "npm test" }] },
        { id: 3, subject: "后续", status: "pending", tasks: [] },
      ],
      nextId: 4,
    },
  } as never);

  const result = await __executeDgoalCheckForTest(
    { phaseId: 1 },
    { cwd, model: { provider: "openai", id: "gpt-5" }, isProjectTrusted: () => true, ui: { notify: () => {} } } as never,
  );

  expect(result.details?.approved).toBe(true);
  // 第一条 spawn 是隔离模型 registry 预检；审核 child 使用最后一条。
  expect(spawnArgs.length).toBeGreaterThanOrEqual(2);
  expect(spawnArgs.at(-1)?.at(-1)).toContain("<audit_checkpoint>");
  expect(spawnArgs.at(-1)?.at(-1)).toContain("npm test");
});
