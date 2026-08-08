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

function setCheckpointGoal(id: string, checkpoint: ReturnType<typeof applyCheckpointEvent>, evidence: string): void {
  __setGoalForTest({
    id,
    objective: id,
    description: "验证阶段审核检查点的工作区复用边界。",
    status: "active",
    startedAt: 1,
    updatedAt: 1,
    iteration: 0,
    workList: {
      items: [],
      phases: [
        {
          id: 1, subject: "验收", description: "复验当前阶段。", status: "in_progress", revision: 0,
          acceptanceCriteria: [{ criterion: "阶段可测试", evidence }],
          items: [{ id: 1, subject: "实现", description: "完成实现。", status: "done", evidence }],
        },
        { id: 2, subject: "后续", description: "后续串行工作。", status: "pending", revision: 0, acceptanceCriteria: [{ criterion: "后续可测试", evidence }], items: [] },
      ],
      nextItemId: 2,
      nextPhaseId: 3,
      revision: 0,
    },
    contract: {
      id: `run-${id}`,
      profile: "staged_check",
      startedAt: 1,
      revision: 0,
      transitions: [{ to: "staged_check", at: 1, revision: 0 }],
      verification: evidence,
      acceptanceCriteria: [{ criterion: "目标可测试", evidence }],
      auditCheckpoints: { phase: checkpoint },
    },
  });
}

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
  setCheckpointGoal("checkpoint-workspace-change", checkpoint, "printf after");

  const result = await phaseCheckTool.execute(
    "test", { phaseId: 1 }, undefined, undefined,
    { cwd: repo, model: { provider: "openai", id: "gpt-5" }, isProjectTrusted: () => true, ui: { notify: () => {} } } as never,
  );

  expect(result.details?.approved).toBe(true);
  expect(spawnArgs.at(-1)?.at(-1)).not.toContain("<audit_checkpoint>");
});

test("重启后的阶段审核会把同工作区的成功命令检查点交给新的独立审核器", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-dgoal-audit-checkpoint-resume-"));
  tempRoots.push(cwd);
  execFileSync("git", ["-C", cwd, "init", "-q"]);
  execFileSync("git", ["-C", cwd, "config", "user.email", "test@example.com"]);
  execFileSync("git", ["-C", cwd, "config", "user.name", "pi-dgoal-test"]);
  writeFileSync(join(cwd, "tracked.txt"), "stable\n");
  execFileSync("git", ["-C", cwd, "add", "tracked.txt"]);
  execFileSync("git", ["-C", cwd, "commit", "-qm", "init"]);
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
  setCheckpointGoal("checkpoint-resume", checkpoint, "npm test");

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
