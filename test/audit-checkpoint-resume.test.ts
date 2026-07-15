import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  __fingerprintAuditWorkspaceForTest,
  __resetGoalForTest,
  __resetSpawnManagedSubprocessForTest,
  __setApiForTest,
  __setGoalForTest,
  __setSpawnManagedSubprocessForTest,
  phaseCheckTool,
} from "../index.ts";
import { applyCheckpointEvent } from "../src/audit/checkpoint.ts";

const tempRoots: string[] = [];

afterEach(() => {
  __resetGoalForTest();
  __resetSpawnManagedSubprocessForTest();
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

test("工作区变化后生产审核路径不注入旧检查点", async () => {
  const repo = mkdtempSync(join(tmpdir(), "pi-dgoal-audit-checkpoint-prod-"));
  tempRoots.push(repo);
  execFileSync("git", ["-C", repo, "init", "-q"]);
  execFileSync("git", ["-C", repo, "config", "user.email", "test@example.com"]);
  execFileSync("git", ["-C", repo, "config", "user.name", "pi-dgoal-test"]);
  writeFileSync(join(repo, "tracked.txt"), "tracked\n");
  execFileSync("git", ["-C", repo, "add", "tracked.txt"]);
  execFileSync("git", ["-C", repo, "commit", "-qm", "init"]);
  const untracked = join(repo, "untracked.txt");
  writeFileSync(untracked, "before\n");
  const fingerprint = __fingerprintAuditWorkspaceForTest(repo);
  if (!fingerprint) throw new Error("expected a Git workspace fingerprint");
  const checkpoint = applyCheckpointEvent(
    { workspaceFingerprint: fingerprint, records: [] },
    {
      workspaceFingerprint: fingerprint,
      toolName: "bash",
      args: { command: "printf before" },
      phase: "end",
      status: "success",
    },
  );
  writeFileSync(untracked, "after\n");

  const spawnArgs: string[][] = [];
  __setSpawnManagedSubprocessForTest((_command, args) => {
    spawnArgs.push(args);
    const stdout = new EventEmitter();
    const proc = new EventEmitter() as any;
    proc.stdout = stdout;
    proc.stderr = new EventEmitter();
    proc.stdin = { write: (_value: string, callback?: (error?: Error | null) => void) => callback?.() };
    proc.pid = 47;
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
    id: "checkpoint-workspace-change",
    objective: "工作区变化检查点回归",
    planType: "goal",
    status: "active",
    startedAt: 1,
    updatedAt: 1,
    iteration: 0,
    verification: "printf after",
    acceptanceCriteria: [{ criterion: "目标可测试", evidence: "printf after" }],
    auditCheckpoints: { phase: checkpoint },
    plan: {
      phases: [
        { id: 1, subject: "验收", status: "in_progress", acceptanceCriteria: [{ criterion: "目标可测试", evidence: "printf after" }], tasks: [{ id: 2, subject: "实现", status: "done", evidence: "printf after" }] },
        { id: 3, subject: "后续", status: "pending", tasks: [] },
      ],
      nextId: 4,
    },
  } as never);

  const result = await phaseCheckTool.execute(
    "test", { phaseId: 1 }, undefined, undefined,
    { cwd: repo, model: { provider: "openai", id: "gpt-5" }, isProjectTrusted: () => true, ui: { notify: () => {} } } as never,
  );

  expect(result.details?.approved).toBe(true);
  expect(spawnArgs.at(-1)?.at(-1)).not.toContain("<audit_checkpoint>");
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
    planType: "goal",
    status: "active",
    startedAt: 1,
    updatedAt: 1,
    iteration: 0,
    verification: "npm test",
    acceptanceCriteria: [{ criterion: "阶段可测", evidence: "npm test" }],
    auditCheckpoints: { phase: checkpoint },
    plan: {
      phases: [
        { id: 1, subject: "验证", status: "in_progress", acceptanceCriteria: [{ criterion: "阶段可测", evidence: "npm test" }], tasks: [{ id: 2, subject: "实现", status: "done", evidence: "npm test" }] },
        { id: 3, subject: "后续", status: "pending", tasks: [] },
      ],
      nextId: 4,
    },
  } as never);

  const result = await phaseCheckTool.execute(
    "test", { phaseId: 1 }, undefined, undefined,
    { cwd, model: { provider: "openai", id: "gpt-5" }, isProjectTrusted: () => true, ui: { notify: () => {} } } as never,
  );

  expect(result.details?.approved).toBe(true);
  // 第一条 spawn 是隔离模型 registry 预检；审核 child 使用最后一条。
  expect(spawnArgs.length).toBeGreaterThanOrEqual(2);
  expect(spawnArgs.at(-1)?.at(-1)).toContain("<audit_checkpoint>");
  expect(spawnArgs.at(-1)?.at(-1)).toContain("npm test");
});
