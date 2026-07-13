// 覆盖背景总结候选链的执行循环（ADR 0027）：每候选恰好一次、当前会话模型兜底一次、耗尽 fail-closed。
// 与 auditor-config.test 的"候选解析"互补：这里测的是 summarizeContext 真实循环消费候选的次数与终止条件。
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  __resetGoalForTest,
  __setContextSummarizerOnceOverrideForTest,
  __summarizeContextForTest,
  resolveContextSummarizerModelCandidates,
} from "../index.ts";

const tmpRoots: string[] = [];

function makeTempProject() {
  const root = mkdtempSync(join(tmpdir(), "pi-dgoal-summarizer-"));
  tmpRoots.push(root);
  const cwd = join(root, "project");
  const agentDir = join(root, "agent");
  mkdirSync(cwd, { recursive: true });
  mkdirSync(agentDir, { recursive: true });
  return { root, cwd, agentDir };
}

afterEach(() => {
  __resetGoalForTest();
  __setContextSummarizerOnceOverrideForTest(undefined);
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe("背景总结候选链执行循环（ADR 0027）", () => {
  test("每个配置候选恰好一次 + 当前会话模型兜底一次；全部失败 → error 且不泄漏额外调用", async () => {
    const { agentDir, cwd } = makeTempProject();
    writeFileSync(join(agentDir, "pi-dgoal.json"), JSON.stringify({
      contextSummarizerModels: ["openai/gpt-4o", "anthropic/claude-sonnet"],
    }));
    const ctx = {
      cwd,
      isProjectTrusted: () => true,
      model: { provider: "openai", id: "gpt-5" },
    } as never;

    const candidates = await resolveContextSummarizerModelCandidates(ctx, { agentDir });
    expect(candidates).toEqual(["openai/gpt-4o", "anthropic/claude-sonnet", "openai/gpt-5"]);

    const calls: string[] = [];
    __setContextSummarizerOnceOverrideForTest(async ({ modelId }) => {
      calls.push(modelId);
      return { summary: "", aborted: false, error: `${modelId} 不可用` };
    });

    const result = await __summarizeContextForTest({ ctx, objective: "o", priorDiscussion: "d", agentDir });

    // 每个候选恰好一次，无额外重试
    expect(calls).toEqual(["openai/gpt-4o", "anthropic/claude-sonnet", "openai/gpt-5"]);
    expect(result.summary).toBe("");
    expect(result.aborted).toBe(false);
    expect(result.error).toContain("gpt-4o 不可用");
    expect(result.error).toContain("gpt-5 不可用");
  });

  test("首个候选成功即停止，后续候选不再调用", async () => {
    const { agentDir, cwd } = makeTempProject();
    writeFileSync(join(agentDir, "pi-dgoal.json"), JSON.stringify({
      contextSummarizerModels: ["openai/gpt-4o", "anthropic/claude-sonnet"],
    }));
    const ctx = { cwd, isProjectTrusted: () => true, model: { provider: "openai", id: "gpt-5" } } as never;

    const calls: string[] = [];
    __setContextSummarizerOnceOverrideForTest(async ({ modelId }) => {
      calls.push(modelId);
      if (modelId === "openai/gpt-4o") return { summary: "范围与约束", aborted: false };
      return { summary: "", aborted: false, error: "不应到达" };
    });

    const result = await __summarizeContextForTest({ ctx, objective: "o", priorDiscussion: "d", agentDir });
    expect(calls).toEqual(["openai/gpt-4o"]);
    expect(result.summary).toBe("范围与约束");
  });

  test("无额外背景视为成功，不再继续候选", async () => {
    const { agentDir, cwd } = makeTempProject();
    writeFileSync(join(agentDir, "pi-dgoal.json"), JSON.stringify({
      contextSummarizerModels: ["openai/gpt-4o"],
    }));
    const ctx = { cwd, isProjectTrusted: () => true, model: { provider: "openai", id: "gpt-5" } } as never;

    const calls: string[] = [];
    __setContextSummarizerOnceOverrideForTest(async ({ modelId }) => {
      calls.push(modelId);
      return { summary: "无额外背景", aborted: false };
    });

    const result = await __summarizeContextForTest({ ctx, objective: "o", priorDiscussion: "d", agentDir });
    expect(calls).toEqual(["openai/gpt-4o"]);
    expect(result.summary).toBe("无额外背景");
  });
});
