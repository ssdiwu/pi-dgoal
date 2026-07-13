// 验收 5/6/7 反馈环：新 plan phase ID 连续、旧 plan 兼容、phase 找不到时返回完整阶段列表。
// 修复前 phase 与 task 共用 nextId 导致新 plan 出现 #1/#4/#8/#12。
import { beforeEach, describe, expect, test } from "bun:test";

import {
  __executeDgoalCheckForTest,
  __executeDgoalPlanForTest,
  __resetGoalForTest,
  __setGoalForTest,
  loadGoal,
  proposalToPlan,
  type DgoalContext,
  type GoalState,
  type Phase,
  type Task,
  type TaskPlan,
  type PlanProposal,
} from "../index.ts";

function task(id: number, subject: string, status: Task["status"] = "pending"): Task {
  return { id, subject, status };
}
function phase(id: number, subject: string, tasks: Task[], status: Phase["status"] = "pending"): Phase {
  return { id, subject, tasks, status };
}

describe("验收 5 · 新 plan phase ID 连续", () => {
  test("2 phase 3 task：phase id 为 1,2；task 全局唯一", () => {
    const proposal: PlanProposal = {
      objective: "o",
      phases: [
        { subject: "p1", tasks: [{ subject: "t1" }, { subject: "t2" }] },
        { subject: "p2", tasks: [{ subject: "t3" }] },
      ],
    };
    const plan = proposalToPlan(proposal);
    expect(plan.phases[0].id).toBe(1);
    expect(plan.phases[1].id).toBe(2);
    // task 仍全局唯一、连续
    expect(plan.phases[0].tasks[0].id).toBe(3);
    expect(plan.phases[0].tasks[1].id).toBe(4);
    expect(plan.phases[1].tasks[0].id).toBe(5);
    expect(plan.nextId).toBe(6);
  });

  test("4 phase（对应会话场景）：phase id 连续 1,2,3,4", () => {
    const proposal: PlanProposal = {
      objective: "o",
      phases: [
        { subject: "阶段一", tasks: [{ subject: "t" }, { subject: "t" }] },
        { subject: "阶段二", tasks: [{ subject: "t" }, { subject: "t" }, { subject: "t" }] },
        { subject: "阶段三", tasks: [{ subject: "t" }, { subject: "t" }] },
        { subject: "阶段四", tasks: [{ subject: "t" }, { subject: "t" }] },
      ],
    };
    const plan = proposalToPlan(proposal);
    const phaseIds = plan.phases.map((p) => p.id);
    expect(phaseIds).toEqual([1, 2, 3, 4]);
  });

  test("phase 无 task 时 id 仍连续", () => {
    const proposal: PlanProposal = {
      objective: "o",
      phases: [{ subject: "p1" }, { subject: "p2" }, { subject: "p3" }],
    };
    const plan = proposalToPlan(proposal);
    expect(plan.phases.map((p) => p.id)).toEqual([1, 2, 3]);
    expect(plan.nextId).toBe(4);
  });

  test("blockedBy 局部索引仍正确解析到全局 task id", () => {
    const proposal: PlanProposal = {
      objective: "o",
      phases: [{ subject: "p", tasks: [{ subject: "t1" }, { subject: "t2", blockedBy: "[1]" }] }],
    };
    const plan = proposalToPlan(proposal);
    // phase=1, t1=2, t2=3；t2 blockedBy 局部索引1 → t1 全局 id 2
    expect(plan.phases[0].tasks[0].id).toBe(2);
    expect(plan.phases[0].tasks[1].blockedBy).toEqual([2]);
  });
});

describe("验收 7 · phase 找不到时返回完整阶段列表", () => {
  beforeEach(() => __resetGoalForTest());

  test("旧 plan（非连续 id #1/#4/#8）查 phaseId=2：返回阶段列表 + 当前 phase 高亮", async () => {
    const oldPlan: TaskPlan = {
      phases: [
        phase(1, "阶段一", [task(2, "done", "done")], "done"),
        phase(4, "阶段二", [task(5, "todo", "in_progress")], "in_progress"),
        phase(8, "阶段三", [task(9, "todo")], "pending"),
      ],
      nextId: 10,
    };
    const goal: GoalState = {
      id: "g-old",
      objective: "旧 plan",
      status: "active",
      startedAt: 1,
      updatedAt: 1,
      iteration: 0,
      plan: oldPlan,
    };
    __setGoalForTest(goal);

    // 模型把"第二阶段"当作 phaseId=2
    const r = await __executeDgoalCheckForTest({ phaseId: 2 });
    const body = String(r.content?.[0]?.text ?? "");
    // 不应只是冷冰冰的"phase #2 不存在"，应给出可用映射
    expect(body).toContain("phase #2");
    // 列出全部阶段的真实 id 与标题
    expect(body).toContain("1");
    expect(body).toContain("阶段一");
    expect(body).toContain("4");
    expect(body).toContain("阶段二");
    expect(body).toContain("8");
    expect(body).toContain("阶段三");
    // 当前 phase 高亮
    expect(body).toMatch(/当前|current|→|▶/i);
  });

  test("dgoal_plan list 的不存在 phaseId 也返回完整映射", async () => {
    const goal: GoalState = {
      id: "g-old-plan", objective: "旧 plan", status: "active", startedAt: 1, updatedAt: 1, iteration: 0,
      plan: { phases: [phase(1, "阶段一", [task(2, "a")], "done"), phase(4, "阶段二", [task(5, "b")], "in_progress"), phase(8, "阶段三", [task(9, "c")])], nextId: 10 },
    };
    __setGoalForTest(goal);
    const r = await __executeDgoalPlanForTest({ action: "list", phaseId: 2 });
    const body = String(r.content?.[0]?.text ?? "");
    expect(body).toContain("阶段一");
    expect(body).toContain("阶段二");
    expect(body).toContain("阶段三");
    expect(body).toContain("phaseId #4");
  });

  test("dgoal_plan create 的不存在 phaseId 也返回完整映射", async () => {
    const goal: GoalState = {
      id: "g-old-create", objective: "旧 plan", status: "active", startedAt: 1, updatedAt: 1, iteration: 0,
      plan: { phases: [phase(1, "阶段一", [task(2, "a")], "done"), phase(4, "阶段二", [task(5, "b")], "in_progress"), phase(8, "阶段三", [task(9, "c")])], nextId: 10 },
    };
    __setGoalForTest(goal);
    const r = await __executeDgoalPlanForTest({ action: "create", phaseId: 2, subject: "新任务" });
    const body = String(r.content?.[0]?.text ?? "");
    expect(body).toContain("阶段一");
    expect(body).toContain("阶段二");
    expect(body).toContain("阶段三");
    expect(body).toContain("phaseId #4");
  });

  test("dgoal_plan 有效 phaseNumber 映射到真实 phaseId", async () => {
    const goal: GoalState = {
      id: "g-number-valid", objective: "旧 plan", status: "active", startedAt: 1, updatedAt: 1, iteration: 0,
      plan: { phases: [phase(1, "阶段一", [task(2, "a")], "done"), phase(4, "阶段二", [task(5, "b")], "in_progress")], nextId: 6 },
    };
    __setGoalForTest(goal);
    const r = await __executeDgoalPlanForTest({ action: "list", phaseNumber: 2 });
    const body = String(r.content?.[0]?.text ?? "");
    expect(body).toContain("b");
  });

  test("dgoal_plan 的无效 phaseNumber 也返回完整映射", async () => {
    const goal: GoalState = {
      id: "g-old-number", objective: "旧 plan", status: "active", startedAt: 1, updatedAt: 1, iteration: 0,
      plan: { phases: [phase(1, "阶段一", [task(2, "a")], "done"), phase(4, "阶段二", [task(5, "b")], "in_progress")], nextId: 6 },
    };
    __setGoalForTest(goal);
    const r = await __executeDgoalPlanForTest({ action: "list", phaseNumber: 9 });
    const body = String(r.content?.[0]?.text ?? "");
    expect(body).toContain("阶段一");
    expect(body).toContain("阶段二");
    expect(body).toContain("phaseId #4");
  });
});

describe("旧 session loadGoal 不迁移", () => {
  test("新运行时忽略旧 dgoal-state，不恢复旧 plan", () => {
    const oldPlan: TaskPlan = {
      phases: [phase(1, "阶段一", [task(2, "done", "done")], "done")],
      nextId: 3,
    };
    const entries = [{ type: "custom", customType: "dgoal-state", data: { goal: { id: "g-old", objective: "旧", status: "active", startedAt: 1, updatedAt: 1, iteration: 0, plan: oldPlan } } }];
    const ctx = { sessionManager: { getBranch: () => entries } } as unknown as DgoalContext;
    expect(loadGoal(ctx)).toBeUndefined();
  });
});

describe("phaseId / phaseNumber 互斥回归", () => {
  beforeEach(() => __resetGoalForTest());

  test("dgoal_check 同时提供 phaseId 与 phaseNumber 被拒", async () => {
    __setGoalForTest({
      id: "g", objective: "o", status: "active", startedAt: 1, updatedAt: 1, iteration: 0,
      plan: { phases: [phase(1, "p", [task(2, "t", "done")], "in_progress")], nextId: 3 },
    });
    const r = await __executeDgoalCheckForTest({ phaseId: 1, phaseNumber: 1 } as never);
    const body = String(r.content?.[0]?.text ?? "");
    expect(body).toMatch(/必须提供|Must provide|不能同时|cannot be provided together|ambiguousPhaseIdentifier/i);
  });

  test("dgoal_plan 同时提供 phaseId 与 phaseNumber 被拒", async () => {
    __setGoalForTest({
      id: "g", objective: "o", status: "active", startedAt: 1, updatedAt: 1, iteration: 0,
      plan: { phases: [phase(1, "p", [task(2, "t")], "in_progress")], nextId: 3 },
    });
    const r = await __executeDgoalPlanForTest({ action: "list", phaseId: 1, phaseNumber: 1 } as never);
    const body = String(r.content?.[0]?.text ?? "");
    expect(body).toMatch(/必须提供|Must provide|不能同时|cannot be provided together|ambiguousPhaseIdentifier/i);
  });
});
