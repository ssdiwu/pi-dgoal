import { describe, expect, test } from "bun:test";
import { validateToolArguments } from "@earendil-works/pi-ai";
import { Compile } from "typebox/compile";
import { executionPlanTool, goalPlanTool, phaseCheckTool, stagedPlanTool, workCreateTool, workUpdateTool } from "../index.ts";

type ToolDef = { parameters: object; prepareArguments?: (args: unknown) => unknown };

function prepare(tool: ToolDef, args: Record<string, unknown>): Record<string, unknown> {
  return (tool.prepareArguments?.(args) ?? args) as Record<string, unknown>;
}

function passes(tool: ToolDef, args: Record<string, unknown>): boolean {
  return Compile(tool.parameters as never).Check(prepare(tool, args));
}

describe("nine-tool prepareArguments schema seam", () => {
  test("execution_plan coerces stringified root Work Item blockedBy", () => {
    const args = { objective: "o", description: "goal desc", items: [{ subject: "A", description: "A desc" }, { subject: "B", description: "B desc", blockedBy: "[1]" }], phases: [] };
    expect(passes(executionPlanTool, args)).toBe(true);
    expect(((prepare(executionPlanTool, args).items as any[])[1].blockedBy)).toEqual([1]);
  });

  test("goal_plan and staged_plan coerce nested Work Item blockedBy", () => {
    const shared = {
      objective: "o",
      description: "goal desc",
      verification: "bun test",
      acceptanceCriteria: [{ criterion: "ok", evidence: "bun test" }],
    };
    const goalArgs = { ...shared, phases: [{ subject: "p", description: "phase desc", items: [{ subject: "A", description: "A desc", blockedBy: "[]" }] }] };
    expect(passes(goalPlanTool, goalArgs)).toBe(true);
    expect((((prepare(goalPlanTool, goalArgs).phases as any[])[0].items as any[])[0].blockedBy)).toEqual([]);

    const stagedArgs = { ...shared, phases: [{ subject: "p", description: "phase desc", acceptanceCriteria: [{ criterion: "phase ok", evidence: "bun test" }], items: [{ subject: "A", description: "A desc" }, { subject: "B", description: "B desc", blockedBy: "[1]" }] }] };
    expect(passes(stagedPlanTool, stagedArgs)).toBe(true);
    expect((((prepare(stagedPlanTool, stagedArgs).phases as any[])[0].items as any[])[1].blockedBy)).toEqual([1]);
  });

  test("work_create and work_update coerce dependency arrays", () => {
    const createArgs = { target: "item", subject: "B", description: "B desc", blockedBy: "[2]" };
    expect(passes(workCreateTool, createArgs)).toBe(true);
    expect(prepare(workCreateTool, createArgs).blockedBy).toEqual([2]);

    const updateArgs = { target: "item", id: 3, addBlockedBy: "[2]", removeBlockedBy: "[]" };
    expect(passes(workUpdateTool, updateArgs)).toBe(true);
    expect(prepare(workUpdateTool, updateArgs).addBlockedBy).toEqual([2]);
    expect(prepare(workUpdateTool, updateArgs).removeBlockedBy).toEqual([]);
  });

  test("Pi validation preserves nullable strict-schema sentinels", () => {
    const args = prepare(phaseCheckTool, { phaseId: null, phaseNumber: 1 });
    const validated = validateToolArguments(phaseCheckTool, { id: "test", name: "phase_check", arguments: args } as never) as Record<string, unknown>;
    expect(validated).toEqual({ phaseId: null, phaseNumber: 1 });
  });

  test("real arrays remain valid", () => {
    expect(passes(workCreateTool, { target: "item", subject: "B", description: "B desc", blockedBy: [2] })).toBe(true);
    expect(passes(workUpdateTool, { target: "item", id: 3, addBlockedBy: [2] })).toBe(true);
  });
});
