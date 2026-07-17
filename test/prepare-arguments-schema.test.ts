import { describe, expect, test } from "bun:test";
import { Compile } from "typebox/compile";
import { goalPlanTool, planCreateTool, planUpdateTool, taskPlanTool } from "../index.ts";

type ToolDef = { parameters: object; prepareArguments?: (args: unknown) => unknown };

function prepare(tool: ToolDef, args: Record<string, unknown>): Record<string, unknown> {
  return (tool.prepareArguments?.(args) ?? args) as Record<string, unknown>;
}

function passes(tool: ToolDef, args: Record<string, unknown>): boolean {
  return Compile(tool.parameters as never).Check(prepare(tool, args));
}

describe("Eight-tool prepareArguments schema seam", () => {
  test("task_plan coerces stringified initial blockedBy", () => {
    const args = { objective: "o", description: "goal desc", tasks: [{ subject: "A", description: "A desc" }, { subject: "B", description: "B desc", blockedBy: "[1]" }] };
    expect(passes(taskPlanTool, args)).toBe(true);
    expect(((prepare(taskPlanTool, args).tasks as any[])[1].blockedBy)).toEqual([1]);
  });

  test("goal_plan coerces nested task blockedBy", () => {
    const args = {
      objective: "o",
      description: "goal desc",
      verification: "bun test",
      acceptanceCriteria: [{ criterion: "ok", evidence: "bun test" }],
      phases: [{
        subject: "p",
        description: "phase desc",
        acceptanceCriteria: [{ criterion: "phase ok", evidence: "bun test" }],
        tasks: [{ subject: "A", description: "A desc" }, { subject: "B", description: "B desc", blockedBy: "[1]" }],
      }],
    };
    expect(passes(goalPlanTool, args)).toBe(true);
    expect((((prepare(goalPlanTool, args).phases as any[])[0].tasks as any[])[1].blockedBy)).toEqual([1]);
  });

  test("plan_create coerces root blockedBy", () => {
    const args = { subject: "B", description: "B desc", blockedBy: "[2]" };
    expect(passes(planCreateTool, args)).toBe(true);
    expect(prepare(planCreateTool, args).blockedBy).toEqual([2]);
  });

  test("plan_update coerces dependency deltas", () => {
    const args = { target: "task", id: 3, addBlockedBy: "[2]", removeBlockedBy: "[]" };
    expect(passes(planUpdateTool, args)).toBe(true);
    expect(prepare(planUpdateTool, args).addBlockedBy).toEqual([2]);
    expect(prepare(planUpdateTool, args).removeBlockedBy).toEqual([]);
  });

  test("real arrays are left valid", () => {
    expect(passes(planCreateTool, { subject: "B", description: "B desc", blockedBy: [2] })).toBe(true);
    expect(passes(planUpdateTool, { target: "task", id: 3, addBlockedBy: [2] })).toBe(true);
  });
});
