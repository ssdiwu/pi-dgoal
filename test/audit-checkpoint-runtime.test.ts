import { describe, expect, test } from "bun:test";

import { applyCheckpointEvent, type CheckpointState } from "../src/audit/checkpoint.ts";
import { getReusableAuditCheckpoint, setAuditCheckpoint } from "../index.ts";

const checkpoint: CheckpointState = applyCheckpointEvent(
  { workspaceFingerprint: "workspace-a", records: [] },
  {
    workspaceFingerprint: "workspace-a",
    toolName: "bash",
    args: { command: "npm test" },
    phase: "end",
    status: "success",
  },
);

const goal = {
  id: "checkpoint-goal",
  objective: "恢复审核检查点",
  description: "复用同一 Plan Contract 的安全检查点。",
  status: "active",
  startedAt: 1,
  updatedAt: 1,
  iteration: 0,
  workList: { items: [], phases: [], nextItemId: 1, nextPhaseId: 1, revision: 1 },
  contract: { id: "run-checkpoint", profile: "goal_check", startedAt: 1, revision: 1, transitions: [{ to: "goal_check", at: 1, revision: 1 }] },
};

describe("审核检查点运行时持久化", () => {
  test("按 scope 写入并在同一 workspace fingerprint 下恢复", () => {
    const recorded = setAuditCheckpoint(goal as never, "goal", checkpoint);

    expect(recorded.contract?.auditCheckpoints?.goal).toEqual(checkpoint);
    expect(getReusableAuditCheckpoint(recorded, "goal", "workspace-a")).toEqual(checkpoint);
    expect(getReusableAuditCheckpoint(recorded, "phase", "workspace-a")).toBeUndefined();
  });

  test("workspace fingerprint 改变时不复用旧检查点", () => {
    const recorded = setAuditCheckpoint(goal as never, "phase", checkpoint);

    expect(getReusableAuditCheckpoint(recorded, "phase", "workspace-b")).toBeUndefined();
  });
});
