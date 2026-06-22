// 软遗忘端到端 smoke：用真实导出的状态机函数模拟一个完整 dgoal 推进序列，
// 验证"第一个 phase 经 setPhaseCompleted 标 done 后，buildPlanContextBlock 注入里该 phase 只剩标题行"。
// 这比纯函数单测更进一步：走完整 proposalToPlan → applyPlanMutation → setPhaseCompleted 真实状态机路径。
// task id 是 proposalToPlan 全局递增分配的，不固定，故测试里用动态查找。
import { describe, expect, test } from "bun:test";

import {
  applyPlanMutation,
  buildPlanContextBlock,
  proposalToPlan,
  setPhaseCompleted,
  type LoopGoal,
  type PlanProposal,
} from "../index.ts";

function baseGoal(plan: LoopGoal["plan"]): LoopGoal {
  return {
    id: "smoke-1",
    objective: "软遗忘 smoke 目标",
    status: "active",
    startedAt: 1,
    updatedAt: 1,
    iteration: 0,
    plan,
  };
}

function taskId(goal: LoopGoal, phaseIdx: number, taskIdx: number): number {
  return goal.plan!.phases[phaseIdx].tasks[taskIdx].id;
}

describe("软遗忘 e2e smoke · 真实状态机推进序列", () => {
  test("两 phase dgoal：phase 1 建检通过后注入里只留标题行，phase 2 仍全量", () => {
    // 1. 启动闸门产出 proposal（模拟 agent 调 dgoal_propose 的产物）
    const proposal: PlanProposal = {
      objective: "软遗忘 smoke",
      verification: "注入里 done phase 只剩标题行",
      phases: [
        { subject: "阶段一", tasks: [{ subject: "任务甲" }, { subject: "任务乙" }] },
        { subject: "阶段二", tasks: [{ subject: "任务丙" }] },
      ],
    };
    const plan = proposalToPlan(proposal);
    expect(plan.phases.length).toBe(2);

    let goal = baseGoal(plan);

    // 2. 推进 phase 1：task 甲 in_progress → done，task 乙 in_progress → done
    const t1 = taskId(goal, 0, 0);
    const t2 = taskId(goal, 0, 1);
    for (const step of [
      { id: t1, status: "in_progress" as const },
      { id: t1, status: "done" as const, evidence: "ev-甲" },
      { id: t2, status: "in_progress" as const },
      { id: t2, status: "done" as const, evidence: "ev-乙" },
    ]) {
      const r = applyPlanMutation(goal, "update", step);
      expect(r.op.kind).not.toBe("error");
      goal = r.goal;
    }

    // 3. 建检通过前：phase 1 全终态但状态仍未被 setPhaseCompleted 升 done，注入应全量（含 evidence）
    let block = buildPlanContextBlock(goal);
    expect(block).toContain("任务甲");
    expect(block).toContain("ev-甲");
    expect(block).toContain("任务乙");
    expect(block).toContain("ev-乙");

    // 4. dgoal_check 通过 → setPhaseCompleted 标 phase 1 done（真实状态机入口）
    const phase1Id = goal.plan!.phases[0].id;
    const cr = setPhaseCompleted(goal, phase1Id);
    expect(cr.op.kind).not.toBe("error");
    goal = cr.goal;
    const phase1 = goal.plan!.phases[0];
    expect(phase1.status === "done" || phase1.status === "completed").toBe(true);

    // 5. 软遗忘生效：phase 1 注入里只剩标题行，task subject 和 evidence 全部不出现
    block = buildPlanContextBlock(goal);
    expect(block).toContain(`[done] phase #${phase1Id}: 阶段一`);
    expect(block).not.toContain("任务甲");
    expect(block).not.toContain("任务乙");
    expect(block).not.toContain("ev-甲");
    expect(block).not.toContain("ev-乙");

    // 6. phase 2 仍全量注入（pending 状态，未来 phase）
    const phase2Id = goal.plan!.phases[1].id;
    expect(block).toContain(`[pending] phase #${phase2Id}: 阶段二`);
    expect(block).toContain("任务丙");
  });

  test("当前 phase（in_progress）里有 done task 时，其 subject/evidence 仍注入", () => {
    // 验证软遗忘时机是 phase 整体 done，不是单个 task done
    const proposal: PlanProposal = {
      objective: "当前 phase 内 done task",
      verification: "phase 未 done 时，其内 done task 仍注入",
      phases: [
        {
          subject: "进行中阶段",
          tasks: [{ subject: "已完成任务" }, { subject: "待办任务" }],
        },
      ],
    };
    const plan = proposalToPlan(proposal);
    let goal = baseGoal(plan);
    const t1 = taskId(goal, 0, 0);

    // task 1 done，task 2 pending，phase 仍 in_progress
    const r1 = applyPlanMutation(goal, "update", { id: t1, status: "in_progress" });
    expect(r1.op.kind).not.toBe("error");
    goal = r1.goal;
    const r2 = applyPlanMutation(goal, "update", { id: t1, status: "done", evidence: "内 done 证据" });
    expect(r2.op.kind).not.toBe("error");
    goal = r2.goal;

    const block = buildPlanContextBlock(goal);
    // phase 未 done，其内 done task 仍注入
    expect(block).toContain("已完成任务");
    expect(block).toContain("内 done 证据");
    expect(block).toContain("待办任务");
  });
});
