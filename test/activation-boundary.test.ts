import { describe, expect, test } from "bun:test";
import { buildNaturalLanguageStartGuidance, buildWorkListDefaultGuidance, isNaturalLanguageDgoalStartRequest } from "../src/startup/index.ts";
import { __resetGoalForTest, __setApiForTest, executionPlanTool, goalPlanTool, registerDgoal, stagedPlanTool, workListTool } from "../index.ts";

describe("ADR 0051 activation boundary", () => {
  test("cold guidance routes autonomous delivery to Execution and reserves soft Work List for tracking", () => {
    const guidance = buildWorkListDefaultGuidance();
    expect(guidance).toContain("work_list");
    expect(guidance).toContain("只用于用户明确要记录、整理、等待后续输入");
    expect(guidance).toContain("不自动续跑");
    expect(guidance).toContain("明确交付");
    expect(guidance).toContain("execution_plan");
    expect(guidance).toContain("Until Done");
    expect(guidance).toContain("显式授权 /dgoal");
    expect(guidance).toContain("未经授权不得调用 goal_plan 或 staged_plan");
    expect(guidance).toContain("纯讨论、解释、单步回答不建清单");

    const explicit = buildNaturalLanguageStartGuidance();
    expect(explicit).toContain("Goal Check Plan");
    expect(explicit).toContain("Staged Check Plan");
    expect(explicit).toContain("goal_plan / staged_plan");
    expect(explicit).toContain("语义预审与用户确认");
  });

  test("natural-language /dgoal authorization rejects questions, quotes and negation", () => {
    for (const text of ["请用 dgoal 完成这个任务", "启动 /dgoal", "please use dgoal for this task"]) {
      expect(isNaturalLanguageDgoalStartRequest(text)).toBe(true);
    }
    for (const text of ["dgoal 是什么？", "不要用 dgoal", "请解释‘请用 dgoal’这句话", "你能用 dgoal 吗？"]) {
      expect(isNaturalLanguageDgoalStartRequest(text)).toBe(false);
    }
  });

  test("public tool guidance preserves assurance boundaries", () => {
    expect(workListTool.promptGuidelines.join("\n")).toContain("不自动续跑");
    expect(executionPlanTool.promptGuidelines.join("\n")).toContain("没有独立 check");
    expect(goalPlanTool.promptGuidelines.join("\n")).toContain("不调用 phase_check");
    expect(stagedPlanTool.promptGuidelines.join("\n")).toContain("每个 Phase 先 phase_check");
    expect(stagedPlanTool.promptGuidelines.join("\n")).toContain("主干冻结");
  });

  test("the full host prompt reserves soft tracking for later input and routes clear delivery to Execution", async () => {
    const { buildSystemPrompt } = await import(new URL("./core/system-prompt.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href);
    const tools = [workListTool, executionPlanTool, goalPlanTool, stagedPlanTool];
    const systemPrompt = buildSystemPrompt({
      cwd: process.cwd(), contextFiles: [], skills: [], selectedTools: tools.map((tool) => tool.name),
      toolSnippets: Object.fromEntries(tools.map((tool) => [tool.name, tool.promptSnippet])),
      promptGuidelines: tools.flatMap((tool) => tool.promptGuidelines),
    });
    __resetGoalForTest();
    const handlers: Record<string, Function> = {};
    try {
      registerDgoal({ registerTool: () => {}, registerCommand: () => {}, on: (name: string, handler: Function) => { handlers[name] = handler; }, events: { emit: () => {} }, appendEntry: () => {} } as never);
      const composed = await handlers.before_agent_start({ prompt: "修复这个故障并验证", systemPrompt }, { ui: {} });
      expect(composed.systemPrompt).not.toContain("普通多步工作先使用 work_list");
      expect(workListTool.description).toContain("记录");
      expect(composed.systemPrompt).toContain("明确交付");
      expect(composed.systemPrompt).toContain("execution_plan");
      expect(composed.systemPrompt).toContain("等待后续输入");
    } finally {
      __resetGoalForTest();
      __setApiForTest(undefined);
    }
  });

  test("public entry schemas expose no implicit or runtime budget bypass", () => {
    const serialized = JSON.stringify({
      work: workListTool.parameters,
      execution: executionPlanTool.parameters,
      goal: goalPlanTool.parameters,
      staged: stagedPlanTool.parameters,
    });
    expect(serialized).not.toContain("implicitFinalOnly");
    expect(serialized).not.toContain("runtimeBudget");
    expect(serialized).not.toContain("budgetPolicy");
    expect(serialized).not.toContain('"implicit"');
  });
});
