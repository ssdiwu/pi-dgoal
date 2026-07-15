import { beforeEach, describe, expect, test } from "bun:test";
import {
  __resetGoalForTest,
  __setGoalForTest,
  loadGoal,
  phaseCheckTool,
  planCreateTool,
  planReadTool,
  proposalToPlan,
  type DgoalContext,
  type GoalState,
  type Phase,
  type PlanProposal,
  type Task,
  type TaskPlan,
} from "../index.ts";

const ctx = { cwd: process.cwd(), ui: {}, sessionManager: { getBranch: () => [] } } as never;
const execute = (tool: { execute: Function }, params: Record<string, unknown>) => tool.execute("test", params, undefined, undefined, ctx);
const task = (id: number, subject: string, status: Task["status"] = "pending"): Task => ({ id, subject, status });
const phase = (id: number, subject: string, tasks: Task[], status: Phase["status"] = "pending"): Phase => ({ id, subject, tasks, status });

describe("new Plan phase IDs are contiguous", () => {
  test("phase IDs are 1..N and task IDs remain globally unique", () => {
    const proposal: PlanProposal = {
      objective: "o", planType: "goal",
      phases: [
        { subject: "p1", tasks: [{ subject: "t1" }, { subject: "t2" }] },
        { subject: "p2", tasks: [{ subject: "t3" }] },
      ],
    };
    const plan = proposalToPlan(proposal);
    expect(plan.phases.map((item) => item.id)).toEqual([1, 2]);
    expect(plan.phases.flatMap((item) => item.tasks.map((value) => value.id))).toEqual([3, 4, 5]);
    expect(plan.nextId).toBe(6);
  });

  test("empty phases still receive contiguous IDs", () => {
    const plan = proposalToPlan({ objective: "o", planType: "phase", phases: [{ subject: "p1" }, { subject: "p2" }, { subject: "p3" }] });
    expect(plan.phases.map((item) => item.id)).toEqual([1, 2, 3]);
    expect(plan.nextId).toBe(4);
  });

  test("blockedBy local indexes map to global task IDs", () => {
    const plan = proposalToPlan({
      objective: "o", planType: "phase",
      phases: [{ subject: "p", tasks: [{ subject: "t1" }, { subject: "t2", blockedBy: "[1]" as never }] }],
    });
    expect(plan.phases[0].tasks[1].blockedBy).toEqual([2]);
  });
});

function nonContiguousGoal(): GoalState {
  return {
    id: "old", objective: "Plan", planType: "goal", status: "active", startedAt: 1, updatedAt: 1, iteration: 0,
    plan: {
      revision: 0,
      phases: [
        phase(1, "阶段一", [task(2, "a", "done")], "done"),
        { ...phase(4, "阶段二", [task(5, "b", "done")], "in_progress"), acceptanceCriteria: [{ criterion: "ok", evidence: "bun test" }] },
        phase(8, "阶段三", [task(9, "c")]),
      ],
      nextId: 10,
    },
  } as GoalState;
}

describe("phase diagnostics preserve non-contiguous legacy IDs inside dgoal-plan-v1", () => {
  beforeEach(() => {
    __resetGoalForTest();
    __setGoalForTest(nonContiguousGoal());
  });

  test("missing phase ID returns the complete mapping", async () => {
    for (const [tool, params] of [
      [phaseCheckTool, { phaseId: 2 }],
      [planReadTool, { target: "phase", id: 2 }],
      [planCreateTool, { phaseId: 2, subject: "新任务" }],
    ] as const) {
      const result = await execute(tool, params);
      const body = String(result.content?.[0]?.text ?? "");
      expect(body).toContain("阶段一");
      expect(body).toContain("阶段二");
      expect(body).toContain("阶段三");
      expect(body).toContain("phaseId #4");
    }
  });

  test("phaseNumber maps to the real phase ID", async () => {
    const result = await execute(planReadTool, { target: "phase", phaseNumber: 2 });
    expect(String(result.content?.[0]?.text ?? "")).toContain("阶段二");
  });

  test("invalid phaseNumber returns the complete mapping", async () => {
    const result = await execute(planReadTool, { target: "phase", phaseNumber: 9 });
    const body = String(result.content?.[0]?.text ?? "");
    expect(body).toContain("阶段一");
    expect(body).toContain("phaseId #4");
  });

  test("phaseId and phaseNumber are mutually exclusive", async () => {
    for (const tool of [phaseCheckTool, planReadTool]) {
      const result = await execute(tool, tool === planReadTool
        ? { target: "phase", id: 4, phaseNumber: 2 }
        : { phaseId: 4, phaseNumber: 2 });
      expect(String(result.content?.[0]?.text ?? "")).toMatch(/not both|ambiguous/i);
    }
  });
});

describe("old state entry isolation", () => {
  test("dgoal-state is ignored", () => {
    const oldPlan: TaskPlan = { phases: [phase(1, "阶段一", [task(2, "done", "done")], "done")], nextId: 3 };
    const entries = [{ type: "custom", customType: "dgoal-state", data: { goal: { id: "old", objective: "旧", status: "active", startedAt: 1, updatedAt: 1, iteration: 0, plan: oldPlan } } }];
    const context = { sessionManager: { getBranch: () => entries } } as unknown as DgoalContext;
    expect(loadGoal(context)).toBeUndefined();
  });
});
