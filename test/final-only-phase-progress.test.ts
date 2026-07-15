// v0.7.0 final_only：complete_progress 与 dgoal_check 拒绝；阶段进度完成不冒充阶段建检。
import { describe, expect, test } from "bun:test";
import {
  __resetGoalForTest,
  __setGoalForTest,
  __executeDgoalPlanForTest,
  __executeDgoalCheckForTest,
  applyPlanMutation,
  type GoalState,
} from "../index.ts";

function finalOnlyGoal(): GoalState {
  return {
    id: "g", objective: "o", status: "active", startedAt: 1, updatedAt: 1, iteration: 0,
    verificationPolicy: "final_only",
    budgetPolicy: "bounded",
    runtimeBudget: { maxTurns: 8, maxRepairAttempts: 1 },
    budgetUsage: { turns: 0, repairAttempts: 0 },
    plan: { phases: [{ id: 1, subject: "阶段", status: "in_progress", tasks: [{ id: 1, subject: "t1", status: "done", evidence: "npm test" }] }], nextId: 2 },
  } as GoalState;
}

describe("v0.7.0 · final_only 阶段进度", () => {
  test("complete_progress 把终态 phase 标为进度完成，不改 status=done", () => {
    __resetGoalForTest();
    const g = finalOnlyGoal();
    const r = applyPlanMutation(g, "complete_progress", { phaseId: 1 });
    expect(r.op.kind).toBe("complete_progress");
    if (r.op.kind === "complete_progress") expect(r.op.phaseId).toBe(1);
    expect(r.goal.plan!.phases[0].progressCompleted).toBe(true);
    expect(r.goal.plan!.phases[0].status).not.toBe("done");
  });

  test("final_only 下调 dgoal_check 被拒绝", async () => {
    __resetGoalForTest();
    __setGoalForTest(finalOnlyGoal());
    const r = await __executeDgoalCheckForTest({ phaseId: 1 });
    expect(r.details?.error).toBe("final_only forbids phase check");
    expect(r.isError).toBe(true);
  });

  test("phased 不允许 complete_progress", () => {
    __resetGoalForTest();
    const g: GoalState = { ...finalOnlyGoal(), verificationPolicy: "phased" };
    const r = applyPlanMutation(g, "complete_progress", { phaseId: 1 });
    expect(r.op.kind).toBe("error");
  });

  test("final_only 新增 task 后 progressCompleted 失效", () => {
    __resetGoalForTest();
    const g = finalOnlyGoal();
    const completed = applyPlanMutation(g, "complete_progress", { phaseId: 1 }).goal;
    const withNewTask = applyPlanMutation(completed, "create", { phaseId: 1, subject: "t2" });
    expect(withNewTask.goal.plan!.phases[0].progressCompleted).toBe(false);
  });
});
