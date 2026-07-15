import { describe, expect, test } from "bun:test";
import { buildNaturalLanguageStartGuidance, buildTaskPlanDefaultGuidance, isNaturalLanguageDgoalStartRequest } from "../src/startup/index.ts";
import { phasePlanTool, goalPlanTool, taskPlanTool } from "../index.ts";

describe("Three-Plan activation boundary", () => {
  test("cold guidance makes Task Plan the default and keeps /dgoal explicit", () => {
    const task = buildTaskPlanDefaultGuidance();
    expect(task).toContain("主动调用 task_plan");
    expect(task).toContain("纯讨论、解释、能力问答不建计划");
    expect(task).toContain("推荐用户使用 /dgoal");
    expect(task).toContain("不得调用 phase_plan 或 goal_plan");

    const explicit = buildNaturalLanguageStartGuidance();
    expect(explicit).toContain("phase_plan / goal_plan");
    expect(explicit).toContain("语义预审与用户确认");
  });

  test("natural-language /dgoal authorization still rejects questions, quotes and negation", () => {
    for (const text of ["请用 dgoal 完成这个任务", "启动 /dgoal", "please use dgoal for this task"]) {
      expect(isNaturalLanguageDgoalStartRequest(text)).toBe(true);
    }
    for (const text of ["dgoal 是什么？", "不要用 dgoal", "请解释‘请用 dgoal’这句话", "你能用 dgoal 吗？"]) {
      expect(isNaturalLanguageDgoalStartRequest(text)).toBe(false);
    }
  });

  test("public entry schemas no longer expose implicit or runtime budget", () => {
    const serialized = JSON.stringify({ task: taskPlanTool.parameters, phase: phasePlanTool.parameters, goal: goalPlanTool.parameters });
    expect(serialized).not.toContain("implicitFinalOnly");
    expect(serialized).not.toContain("runtimeBudget");
    expect(serialized).not.toContain("budgetPolicy");
    expect(serialized).not.toContain('"implicit"');
  });
});
