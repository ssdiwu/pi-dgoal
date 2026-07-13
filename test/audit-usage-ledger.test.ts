import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { appendAuditUsage, buildAuditUsageRecord, sanitizeAuditUsage } from "../src/audit/usage.ts";

describe("audit usage ledger", () => {
  let directory = "";

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "pi-dgoal-audit-"));
  });

  afterEach(async () => {
    // Temporary directories are intentionally left for the OS cleanup; no project files are touched.
  });

  test("只保留脱敏数字字段，dedupKey 对相同输入稳定", () => {
    const usage = sanitizeAuditUsage({
      input: 100,
      output: 20,
      cacheRead: 3,
      totalTokens: 123,
      prompt: "must not persist",
      cost: { input: 0.1, total: 0.2, note: "must not persist" },
    });
    expect(usage).toEqual({ input: 100, output: 20, cacheRead: 3, totalTokens: 123, cost: { input: 0.1, total: 0.2 } });

    const args = { timestamp: "2026-07-12T10:00:00.000Z", parentSessionId: "parent", project: "/repo", scope: "goal" as const, model: "openai/gpt-5", attempt: 1, usage };
    const first = buildAuditUsageRecord(args);
    const second = buildAuditUsageRecord(args);
    expect(first).toEqual(second);
    expect(first.dedupKey).toHaveLength(32);
    expect(JSON.stringify(first)).not.toContain("must not persist");
  });

  test("appendAuditUsage 写入 JSONL 并创建 0600 文件", async () => {
    const path = join(directory, "nested", "audit-usage.jsonl");
    const record = buildAuditUsageRecord({ parentSessionId: "p", project: "/repo", scope: "phase", model: "model", attempt: 1, usage: { totalTokens: 7 } });
    await appendAuditUsage(path, record);
    const parsed = JSON.parse(await readFile(path, "utf8"));
    expect(parsed).toEqual(record);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  test("写盘失败显式返回 rejected，调用方可保持审核结论不变", async () => {
    const record = buildAuditUsageRecord({ parentSessionId: "p", project: "/repo", scope: "goal", model: "model", attempt: 1, usage: {} });
    await expect(appendAuditUsage("/dev/null/audit-usage.jsonl", record)).rejects.toBeDefined();
    expect(record.dedupKey).toHaveLength(32);
  });
});
