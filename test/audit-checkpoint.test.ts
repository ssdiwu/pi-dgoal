import { describe, expect, test } from "bun:test";
import {
  applyCheckpointEvent,
  buildPartialReport,
  isCheckpointReusable,
  type CheckpointEvent,
  type CheckpointState,
} from "../src/audit/checkpoint.ts";

const workspaceFingerprint = "workspace-fingerprint-a";
const bashArgs = { command: "bun test test/audit-checkpoint.test.ts" };

const event = (
  phase: "start" | "end",
  status: "running" | "success" | "unknown",
  args: Record<string, unknown> = bashArgs,
): CheckpointEvent => ({
  workspaceFingerprint,
  toolName: "bash",
  args,
  phase,
  status,
});

const stateAfter = (...events: CheckpointEvent[]): CheckpointState =>
  events.reduce<CheckpointState>(applyCheckpointEvent, { workspaceFingerprint, records: [] });

describe("audit checkpoint", () => {
  test("同一 workspace fingerprint 记录 bash start/end，并只把成功结束记为完成", () => {
    const state = stateAfter(event("start", "running"), event("end", "success"));

    expect(state.workspaceFingerprint).toBe(workspaceFingerprint);
    expect(state.records).toHaveLength(1);
    expect(state.records[0]).toEqual(expect.objectContaining({
      toolName: "bash",
      args: bashArgs,
      started: true,
      ended: true,
      status: "success",
    }));
    expect(isCheckpointReusable(state, {
      workspaceFingerprint,
      toolName: "bash",
      args: bashArgs,
    })).toBe(true);
  });

  test("running、unknown 以及参数不精确都不可视为完成", () => {
    const running = stateAfter(event("start", "running"));
    const unknown = stateAfter(event("start", "running"), event("end", "unknown"));
    const differentArgs = stateAfter(event("start", "running"), event("end", "success"));

    expect(isCheckpointReusable(running, { workspaceFingerprint, toolName: "bash", args: bashArgs })).toBe(false);
    expect(isCheckpointReusable(unknown, { workspaceFingerprint, toolName: "bash", args: bashArgs })).toBe(false);
    expect(isCheckpointReusable(differentArgs, {
      workspaceFingerprint,
      toolName: "bash",
      args: { command: "bun test test/other.test.ts" },
    })).toBe(false);
  });

  test("workspace fingerprint 变化时没有可复用检查点", () => {
    const state = stateAfter(event("start", "running"), event("end", "success"));

    expect(isCheckpointReusable(state, {
      workspaceFingerprint: "workspace-fingerprint-b",
      toolName: "bash",
      args: bashArgs,
    })).toBe(false);
  });

  test("partial report 有界，并脱敏 bash 中疑似 token/password/api key 字段", () => {
    const state = stateAfter({
      workspaceFingerprint,
      toolName: "bash",
      args: {
        command: "curl --token tok_live_should-not-leak -H 'Authorization: Bearer sk-secret-should-not-leak' https://example.test",
        token: "tok_live_should-not-leak",
        password: "password-should-not-leak",
        apiKey: "sk-secret-should-not-leak",
      },
      phase: "end",
      status: "unknown",
    });
    const report = buildPartialReport(state, { maxLength: 180 });

    expect(report.length).toBeLessThanOrEqual(180);
    expect(report).toContain("bash");
    expect(report).not.toContain("tok_live_should-not-leak");
    expect(report).not.toContain("Bearer sk-secret-should-not-leak");
    expect(report).not.toContain("password-should-not-leak");
    expect(report).not.toContain("sk-secret-should-not-leak");
    expect(report).toMatch(/\[REDACTED\]|<redacted>|\*{3,}/i);
  });
});
