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
        command: "curl --token \"tok_live_should-not-leak\" --api-key=sk-secret-should-not-leak -H 'Authorization: Bearer sk-secret-should-not-leak' https://example.test",
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

  test("partial report 脱敏 shell 环境变量形式的 secret", () => {
    const secretCommand = "API_KEY=env-secret TOKEN=token-secret password=password-secret SECRET=secret-value curl https://example.test";
    const report = buildPartialReport(stateAfter({
      workspaceFingerprint,
      toolName: "bash",
      args: { command: secretCommand },
      phase: "end",
      status: "unknown",
    }));

    expect(report).not.toContain("env-secret");
    expect(report).not.toContain("token-secret");
    expect(report).not.toContain("password-secret");
    expect(report).not.toContain("secret-value");
    expect(report).toMatch(/\[REDACTED\]/);
  });

  test("partial report 脱敏 HTTP header 形式的 API key", () => {
    const report = buildPartialReport(stateAfter({
      workspaceFingerprint,
      toolName: "bash",
      args: { command: "curl -H 'X-Api-Key: header-secret' https://example.test" },
      phase: "end",
      status: "unknown",
    }));

    expect(report).not.toContain("header-secret");
    expect(report).toMatch(/\[REDACTED\]/);
  });

  test("partial report 脱敏非 Bearer Authorization header 与 query secret", () => {
    const report = buildPartialReport(stateAfter({
      workspaceFingerprint,
      toolName: "bash",
      args: {
        command: "curl -H 'Authorization: Basic basic-secret' 'https://example.test/?secret=query-secret&authorization=query-auth'",
      },
      phase: "end",
      status: "unknown",
    }));

    expect(report).not.toContain("basic-secret");
    expect(report).not.toContain("query-secret");
    expect(report).not.toContain("query-auth");
    expect(report).toMatch(/\[REDACTED\]/);
  });

  test("partial report 脱敏复合 secret 环境变量与参数变体", () => {
    const report = buildPartialReport(stateAfter({
      workspaceFingerprint,
      toolName: "bash",
      args: {
        command: "AWS_SECRET_ACCESS_KEY=aws-secret CLIENT_SECRET_KEY=client-value-should-not-leak curl --client-secret:cli-secret 'https://example.test/?access_token=query-token'",
      },
      phase: "end",
      status: "unknown",
    }));

    expect(report).not.toContain("aws-secret");
    expect(report).not.toContain("client-value-should-not-leak");
    expect(report).not.toContain("cli-secret");
    expect(report).not.toContain("query-token");
  });

  test("partial report 脱敏 secret 与 authorization CLI 参数", () => {
    const report = buildPartialReport(stateAfter({
      workspaceFingerprint,
      toolName: "bash",
      args: { command: "tool --secret secret-flag --authorization authorization-flag" },
      phase: "end",
      status: "unknown",
    }));

    expect(report).not.toContain("secret-flag");
    expect(report).not.toContain("authorization-flag");
  });

  test("partial report 脱敏 URL credentials、Cookie 与 credential 变体", () => {
    const report = buildPartialReport(stateAfter({
      workspaceFingerprint,
      toolName: "bash",
      args: {
        command: "curl 'https://user:url-password@example.test' -H 'Cookie: session=session-secret' --cookie 'session=cookie-flag-secret' --credential=credential-secret --private-key=private-key-secret",
      },
      phase: "end",
      status: "unknown",
    }));

    expect(report).not.toContain("url-password");
    expect(report).not.toContain("session-secret");
    expect(report).not.toContain("cookie-flag-secret");
    expect(report).not.toContain("credential-secret");
    expect(report).not.toContain("private-key-secret");
  });

  test("partial report 脱敏 PEM private key 且保留普通命令", () => {
    const pemReport = buildPartialReport(stateAfter({
      workspaceFingerprint,
      toolName: "bash",
      args: { command: "cat <<'KEY'\n-----BEGIN PRIVATE KEY-----\npem-secret\n-----END PRIVATE KEY-----\nKEY" },
      phase: "end",
      status: "unknown",
    }));
    const ordinaryReport = buildPartialReport(stateAfter({
      workspaceFingerprint,
      toolName: "bash",
      args: { command: "printf hello" },
      phase: "end",
      status: "unknown",
    }));

    expect(pemReport).not.toContain("pem-secret");
    expect(ordinaryReport).toContain("printf hello");
  });
});
