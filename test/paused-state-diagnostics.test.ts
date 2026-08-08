import { beforeEach, describe, expect, test } from "bun:test";
import {
  __getGoalForTest,
  __pauseGoalForTest,
  __resetGoalForTest,
  __setGoalForTest,
  goalCheckTool,
  phaseCheckTool,
  workCreateTool,
  workReadTool,
  workUpdateTool,
  type GoalState,
} from "../index.ts";

const ctx = { cwd: process.cwd(), ui: { setStatus: () => {}, setWidget: () => {}, notify: () => {} }, sessionManager: { getBranch: () => [] } } as never;
const execute = (tool: { execute: Function }, params: Record<string, unknown> = {}) => tool.execute("test", params, undefined, undefined, ctx);

function goal(status: GoalState["status"], pauseReason?: GoalState["pauseReason"]): GoalState {
  return {
    id: "g",
    objective: "诊断",
    description: "验证暂停边界。",
    status,
    pauseReason,
    startedAt: 1,
    updatedAt: 1,
    iteration: 0,
    workList: {
      revision: 1,
      nextItemId: 2,
      nextPhaseId: 2,
      items: [],
      phases: [{
        id: 1,
        subject: "阶段",
        description: "完成当前阶段。",
        status: "in_progress",
        revision: 0,
        acceptanceCriteria: [{ criterion: "ok", evidence: "bun test" }],
        items: [{ id: 1, subject: "待办", description: "完成待办。", status: "pending" }],
      }],
    },
    contract: {
      id: "run-g",
      profile: "staged_check",
      startedAt: 1,
      revision: 1,
      transitions: [{ to: "staged_check", at: 1, revision: 1 }],
      acceptanceCriteria: [{ criterion: "goal ok", evidence: "bun test" }],
    },
  };
}

function text(result: { content?: Array<{ text?: string }> }): string {
  return String(result.content?.[0]?.text ?? "");
}

describe("paused Plan Contract diagnostics", () => {
  beforeEach(__resetGoalForTest);

  test("work_read remains available", async () => {
    __setGoalForTest(goal("paused", "user_abort"));
    const result = await execute(workReadTool, { target: "list" });
    expect(text(result)).toContain("待办");
    expect(result.details.readOnly).toBe(true);
  });

  test("writes and checks return paused + resume guidance", async () => {
    __setGoalForTest(goal("paused", "user_abort"));
    for (const [tool, params] of [
      [workCreateTool, { target: "item", phaseId: 1, subject: "新项", description: "新增工作。" }],
      [workUpdateTool, { target: "item", id: 1, status: "in_progress" }],
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

  test("pending Work List cannot be completed", async () => {
    __setGoalForTest(goal("pending"));
    const result = await execute(workUpdateTool, { target: "goal", status: "done", summary: "s", verification: "v" });
    expect(result.details.error).toBe("work list not mutable");
  });

  test("missing and active reads remain distinct", async () => {
    const missing = await execute(workReadTool);
    expect(missing.details.error).toBe("no work list");
    __setGoalForTest(goal("active"));
    const active = await execute(workReadTool);
    expect(text(active)).toContain("待办");
    expect(active.details.readOnly).toBe(true);
  });
});
