// 软遗忘端到端 smoke：通过 public plan_update 推进 Phase Plan，
// 验证 phase 标为 done 后，Plan context 只保留 phase 标题而隐藏其 task 细节。
import { beforeEach, describe, expect, test } from "bun:test";

import {
  __getGoalForTest,
  __resetGoalForTest,
  __setApiForTest,
  __setGoalForTest,
  buildPlanContextBlock,
  planUpdateTool,
  proposalToPlan,
  type GoalState,
  type PlanProposal,
} from "../index.ts";

const ctx = {
  cwd: process.cwd(),
  ui: { setStatus: () => {}, setWidget: () => {}, notify: () => {} },
  sessionManager: { getBranch: () => [] },
} as never;

function baseGoal(plan: GoalState["plan"]): GoalState {
  return {
    id: "smoke-1",
    objective: "软遗忘 smoke 目标",
    planType: "phase",
    status: "active",
    startedAt: 1,
    updatedAt: 1,
    iteration: 0,
    plan,
  };
}

async function update(params: Record<string, unknown>) {
  return planUpdateTool.execute("call", params as never, undefined, undefined, ctx);
}

function taskId(goal: GoalState, phaseIdx: number, taskIdx: number): number {
  return goal.plan!.phases[phaseIdx].tasks[taskIdx].id;
}

beforeEach(() => {
  __resetGoalForTest();
  __setApiForTest({ appendEntry: () => {} });
});

describe("软遗忘 e2e smoke · public plan_update 推进序列", () => {
  test("Phase Plan 的 phase 由 plan_update 标 done 后只注入标题行", async () => {
    const proposal: PlanProposal = {
      objective: "软遗忘 smoke",
      planType: "phase",
      verification: "注入里 done phase 只剩标题行",
      phases: [
        { subject: "阶段一", tasks: [{ subject: "任务甲" }, { subject: "任务乙" }] },
        { subject: "阶段二", tasks: [{ subject: "任务丙" }] },
      ],
    };
    __setGoalForTest(baseGoal(proposalToPlan(proposal)));

    const initial = __getGoalForTest()!;
    const t1 = taskId(initial, 0, 0);
    const t2 = taskId(initial, 0, 1);
    for (const step of [
      { target: "task", id: t1, status: "in_progress" },
      { target: "task", id: t1, status: "done", evidence: "ev-甲" },
      { target: "task", id: t2, status: "in_progress" },
      { target: "task", id: t2, status: "done", evidence: "ev-乙" },
    ]) {
      const result = await update(step);
      expect(result.details?.error).toBeUndefined();
    }

    let goal = __getGoalForTest()!;
    let block = buildPlanContextBlock(goal);
    expect(block).toContain("任务甲");
    expect(block).toContain("ev-甲");
    expect(block).toContain("任务乙");
    expect(block).toContain("ev-乙");

    const phase1Id = goal.plan!.phases[0].id;
    const phaseDone = await update({ target: "phase", id: phase1Id, status: "done" });
    expect(phaseDone.details?.error).toBeUndefined();
    goal = __getGoalForTest()!;
    expect(goal.plan!.phases[0].status).toBe("done");

    block = buildPlanContextBlock(goal);
    expect(block).toContain(`[done] phase #${phase1Id}: 阶段一`);
    expect(block).not.toContain("任务甲");
    expect(block).not.toContain("任务乙");
    expect(block).not.toContain("ev-甲");
    expect(block).not.toContain("ev-乙");

    const phase2Id = goal.plan!.phases[1].id;
    expect(block).toContain(`[pending] phase #${phase2Id}: 阶段二`);
    expect(block).toContain("任务丙");
  });

  test("当前 phase 内 done task 仍保留 subject 与 evidence", async () => {
    const proposal: PlanProposal = {
      objective: "当前 phase 内 done task",
      planType: "phase",
      verification: "phase 未 done 时，其内 done task 仍注入",
      phases: [{ subject: "进行中阶段", tasks: [{ subject: "已完成任务" }, { subject: "待办任务" }] }],
    };
    __setGoalForTest(baseGoal(proposalToPlan(proposal)));
    const t1 = taskId(__getGoalForTest()!, 0, 0);

    expect((await update({ target: "task", id: t1, status: "in_progress" })).details?.error).toBeUndefined();
    expect((await update({ target: "task", id: t1, status: "done", evidence: "内 done 证据" })).details?.error).toBeUndefined();

    const block = buildPlanContextBlock(__getGoalForTest()!);
    expect(block).toContain("已完成任务");
    expect(block).toContain("内 done 证据");
    expect(block).toContain("待办任务");
  });
});
