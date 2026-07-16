import { beforeEach, describe, expect, test } from "bun:test";
import {
  __getGoalForTest,
  __pauseGoalForTest,
  __resetGoalForTest,
  __setGoalForTest,
  goalCheckTool,
  goalPlanTool,
  phaseCheckTool,
  phasePlanTool,
  planCreateTool,
  planReadTool,
  planUpdateTool,
  taskPlanTool,
  type GoalState,
} from "../index.ts";

const ctx = { cwd: process.cwd(), ui: { setStatus: () => {}, setWidget: () => {}, notify: () => {} }, sessionManager: { getBranch: () => [] } } as never;
const execute = (tool: { execute: Function }, params: Record<string, unknown> = {}) => tool.execute("test", params, undefined, undefined, ctx);

function goal(status: GoalState["status"], pauseReason?: string): GoalState {
  return {
    id: "g", objective: "诊断", planType: "goal", status, pauseReason,
    startedAt: 1, updatedAt: 1, iteration: 0,
    plan: { revision: 0, nextId: 3, phases: [{
      id: 1, subject: "阶段", status: "in_progress",
      acceptanceCriteria: [{ criterion: "ok", evidence: "bun test" }],
      tasks: [{ id: 2, subject: "待办", status: "pending" }],
    }] },
  } as GoalState;
}

function text(result: { content?: Array<{ text?: string }> }): string {
  return String(result.content?.[0]?.text ?? "");
}

describe("paused Plan diagnostics", () => {
  beforeEach(__resetGoalForTest);

  test("plan_read remains available", async () => {
    __setGoalForTest(goal("paused", "user_abort"));
    const result = await execute(planReadTool, { target: "plan" });
    expect(text(result)).toContain("Goal Plan · 0/1 phases · 0/1 tasks");
    expect((result.details.value as { phases: Array<{ tasks: Array<{ subject: string }> }> }).phases[0].tasks[0].subject).toBe("待办");
    expect(result.details.readOnly).toBe(true);
  });

  test("writes and checks return paused + resume guidance", async () => {
    __setGoalForTest(goal("paused", "user_abort"));
    for (const [tool, params] of [
      [taskPlanTool, { objective: "替换", tasks: [{ subject: "新任务" }] }],
      [phasePlanTool, { objective: "替换", verification: "bun test", acceptanceCriteria: [{ criterion: "ok", evidence: "bun test" }], phases: [{ subject: "阶段" }] }],
      [goalPlanTool, { objective: "替换", verification: "bun test", acceptanceCriteria: [{ criterion: "ok", evidence: "bun test" }], phases: [{ subject: "阶段", acceptanceCriteria: [{ criterion: "phase ok", evidence: "bun test" }] }] }],
      [planCreateTool, { phaseId: 1, subject: "新任务" }],
      [planUpdateTool, { target: "task", id: 2, status: "in_progress" }],
      [phaseCheckTool, { phaseId: 1 }],
      [goalCheckTool, { summary: "s", verification: "v" }],
    ] as const) {
      const result = await execute(tool, params);
      expect(text(result)).toMatch(/paused|暂停/i);
      expect(text(result)).toContain("/dgoal resume");
      expect(result.details.pauseReason).toBe("user_abort");
    }
  });

  test("pause reason distinguishes model_error", async () => {
    __setGoalForTest(goal("paused", "model_error"));
    const result = await execute(phaseCheckTool, { phaseId: 1 });
    expect(result.details.pauseReason).toBe("model_error");
  });
});

describe("command pause and non-active boundaries", () => {
  beforeEach(__resetGoalForTest);

  test("/dgoal pause persists user_abort even when UI throws", () => {
    __setGoalForTest(goal("active"));
    expect(() => __pauseGoalForTest({ ui: {
      setStatus: () => { throw new Error("Spacer is not defined"); },
      notify: () => { throw new Error("notify boom"); },
    } } as never)).not.toThrow();
    expect(__getGoalForTest()?.status).toBe("paused");
    expect(__getGoalForTest()?.pauseReason).toBe("user_abort");
  });

  test("pending Plan cannot be completed", async () => {
    __setGoalForTest(goal("pending"));
    const result = await execute(planUpdateTool, { target: "goal", status: "done", summary: "s", verification: "v" });
    expect(result.details.error).toBe("plan not mutable");
  });

  test("missing and active reads remain distinct", async () => {
    const missing = await execute(planReadTool);
    expect(missing.details.error).toBe("no plan");
    __setGoalForTest(goal("active"));
    const active = await execute(planReadTool);
    expect(text(active)).toContain("Goal Plan · 0/1 phases · 0/1 tasks");
    expect((active.details.value as { phases: Array<{ tasks: Array<{ subject: string }> }> }).phases[0].tasks[0].subject).toBe("待办");
  });
});
