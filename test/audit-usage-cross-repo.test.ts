import { afterEach, describe, expect, test } from "bun:test";
import { appendAuditUsage, buildAuditUsageRecord } from "../src/audit/usage.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rollupAuditUsage, scanAuditUsage } from "../../pi-session-insights/src/audit-usage.ts";

const tmpRoots: string[] = [];

function makeTempDir() {
	const root = mkdtempSync(join(tmpdir(), "pi-dgoal-audit-crossrepo-"));
	tmpRoots.push(root);
	return root;
}

afterEach(() => {
	while (tmpRoots.length > 0) {
		const root = tmpRoots.pop();
		if (root) {
			rmSync(root, { recursive: true, force: true });
		}
	}
});

describe("pi-dgoal 审核账本与 pi-session-insights 聚合联动", () => {
	test("使用 buildAuditUsageRecord 生成记录并被 insights 端 scan/rollup 读取", async () => {
		const root = makeTempDir();
		const path = join(root, "audit-usage.jsonl");
		const record = buildAuditUsageRecord({
			parentSessionId: "session-crossrepo",
			project: "/Users/diwu/Workspace/Codes/Githubs/pi-dgoal",
			scope: "phase",
			model: "openai/gpt-5",
			attempt: 1,
			usage: {
				input: 90,
				output: 10,
				totalTokens: 100,
				cacheRead: 5,
				cost: { input: 0.05, total: 0.06 },
			},
		});
		await appendAuditUsage(path, record);
		await appendAuditUsage(path, { ...record });

		const records = await scanAuditUsage(path);
		const summary = rollupAuditUsage(records);
		expect(records.length).toBe(2);
		expect(summary.recordCount).toBe(1);
		expect(summary.totalTokens).toBe(100);
		expect(summary.byModel[0]).toMatchObject({ model: "openai/gpt-5", totalTokens: 100, totalCost: 0.06, attempts: 1 });
		expect(summary.totalCost).toBe(0.06);
	});
});
