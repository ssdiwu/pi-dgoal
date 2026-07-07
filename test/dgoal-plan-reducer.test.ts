// 切片 2：dgoal_plan reducer（纯函数）测试。
// 见 doc/40-版本实施方案/41-v0.2.0-TaskPlan与建检循环实施方案.md 切片 2 验收。
import { describe, expect, test } from "bun:test";

import {
  applyPlanMutation,
  detectPlanCycle,
  setPhaseCompleted,
  type GoalState,
  type PlanAction,
  type Task,
  type Phase,
  type TaskPlan,
} from "../index.ts";

function makeGoal(phases: Phase[], nextId?: number): GoalState {
  const plan: TaskPlan = { phases, nextId: nextId ?? phases.reduce((n, p) => Math.max(n, ...p.tasks.map((t) => t.id), p.id), 1) + 1 };
  return {
    id: "g1",
    objective: "测目标",
    status: "active",
    startedAt: 1,
    updatedAt: 1,
    iteration: 0,
    plan,
  };
}

function task(id: number, subject: string, status: Task["status"] = "pending", extra: Partial<Task> = {}): Task {
  return { id, subject, status, ...extra };
}

function phase(id: number, subject: string, tasks: Task[], status: Phase["status"] = "pending"): Phase {
  return { id, subject, tasks, status };
}

function run(goal: GoalState, action: PlanAction, params: Record<string, unknown>) {
  return applyPlanMutation(goal, action, params);
}

describe("切片2 · detectPlanCycle 环检测", () => {
  test("无依赖不成环", () => {
    const tasks = [task(1, "a"), task(2, "b")];
    expect(detectPlanCycle(tasks, 2, [1])).toBe(false);
  });

  test("直接自环式反向依赖成环", () => {
    // 1 blockedBy 2，现要给 2 加 blockedBy 1 → 成环
    const tasks = [task(1, "a", "pending", { blockedBy: [2] }), task(2, "b")];
    expect(detectPlanCycle(tasks, 2, [1])).toBe(true);
  });

  test("长链反向依赖成环", () => {
    // 1→2→3，给 3 加 blockedBy 1 → 1→2→3→1 成环
    const tasks = [task(1, "a", "pending", { blockedBy: [2] }), task(2, "b", "pending", { blockedBy: [3] }), task(3, "c")];
    expect(detectPlanCycle(tasks, 3, [1])).toBe(true);
  });

  test("合法 DAG 不报环", () => {
    const tasks = [task(1, "a"), task(2, "b", "pending", { blockedBy: [1] }), task(3, "c", "pending", { blockedBy: [1, 2] })];
    expect(detectPlanCycle(tasks, 3, [])).toBe(false);
  });
});

describe("切片2 · create task", () => {
  test("建 task 成功，nextId 递增", () => {
    const goal = makeGoal([phase(1, "p1", [task(1, "a")])], 2);
    const r = run(goal, "create", { phaseId: 1, subject: "新任务" });
    expect(r.op.kind).toBe("create");
    if (r.op.kind !== "create") return;
    expect(r.op.taskId).toBe(2);
    expect(r.goal.plan!.nextId).toBe(3);
    expect(r.goal.plan!.phases[0].tasks).toHaveLength(2);
    expect(r.goal.plan!.phases[0].tasks[1].status).toBe("pending");
  });

  test("缺 subject 报错", () => {
    const goal = makeGoal([phase(1, "p1", [])]);
    const r = run(goal, "create", { phaseId: 1 });
    expect(r.op.kind).toBe("error");
  });

  test("phase 不存在报错", () => {
    const goal = makeGoal([phase(1, "p1", [])]);
    const r = run(goal, "create", { phaseId: 99, subject: "x" });
    expect(r.op.kind).toBe("error");
  });

  test("create 带初始 blockedBy，依赖不存在报错", () => {
    const goal = makeGoal([phase(1, "p1", [task(1, "a")])]);
    const r = run(goal, "create", { phaseId: 1, subject: "b", blockedBy: [999] });
    expect(r.op.kind).toBe("error");
  });
});

describe("切片2 · 字符串化数组参数兼容（模型序列化降级）", () => {
  // 模型有时把空数组/数组参数 stringify 成 "[]"/"[1,2]" 字符串。
  // schema 放宽为 Array<number> | string，reducer 必须 coerce 回 number[]。
  test("create blockedBy 为字符串空数组 → 视作无依赖", () => {
    const goal = makeGoal([phase(1, "p1", [task(1, "a")])], 2);
    const r = run(goal, "create", { phaseId: 1, subject: "b", blockedBy: "[]" });
    expect(r.op.kind).toBe("create");
    if (r.op.kind !== "create") return;
    expect(r.goal.plan!.phases[0].tasks[1].blockedBy ?? []).toEqual([]);
  });

  test("create blockedBy 为字符串 '[1]' → 解析成 [1]", () => {
    const goal = makeGoal([phase(1, "p1", [task(1, "a")])], 2);
    const r = run(goal, "create", { phaseId: 1, subject: "b", blockedBy: "[1]" });
    expect(r.op.kind).toBe("create");
    if (r.op.kind !== "create") return;
    expect(r.goal.plan!.phases[0].tasks[1].blockedBy).toEqual([1]);
  });

  test("update addBlockedBy 为字符串 '[1]' → 增量加依赖 1", () => {
    const goal = makeGoal([phase(1, "p1", [task(1, "a"), task(2, "b")])]);
    const r = run(goal, "update", { id: 2, addBlockedBy: "[1]" });
    expect(r.op.kind).toBe("update");
    if (r.op.kind !== "update") return;
    expect(r.goal.plan!.phases[0].tasks[1].blockedBy).toEqual([1]);
  });

  test("update removeBlockedBy 为字符串 '[1]' → 移除依赖 1", () => {
    const goal = makeGoal([phase(1, "p1", [task(1, "a"), task(2, "b", "pending", { blockedBy: [1] })])]);
    const r = run(goal, "update", { id: 2, removeBlockedBy: "[1]" });
    expect(r.op.kind).toBe("update");
    if (r.op.kind !== "update") return;
    expect(r.goal.plan!.phases[0].tasks[1].blockedBy ?? []).toEqual([]);
  });

  test("create blockedBy 为字符串 '[1,2]' → 解析成 [1,2]", () => {
    const goal = makeGoal([phase(1, "p1", [task(1, "a"), task(2, "b")])], 3);
    const r = run(goal, "create", { phaseId: 1, subject: "c", blockedBy: "[1,2]" });
    expect(r.op.kind).toBe("create");
    if (r.op.kind !== "create") return;
    expect(r.goal.plan!.phases[0].tasks[2].blockedBy).toEqual([1, 2]);
  });
});

describe("切片2 · update task 状态机", () => {
  test("pending → in_progress 合法", () => {
    const goal = makeGoal([phase(1, "p1", [task(1, "a", "pending")])]);
    const r = run(goal, "update", { id: 1, status: "in_progress", activeForm: "正在做 a" });
    expect(r.op.kind).toBe("update");
    if (r.op.kind !== "update") return;
    expect(r.op.toStatus).toBe("in_progress");
  });

  test("completed → in_progress 拒绝（completed 不回退）", () => {
    const goal = makeGoal([phase(1, "p1", [task(1, "a", "completed")])]);
    const r = run(goal, "update", { id: 1, status: "in_progress" });
    expect(r.op.kind).toBe("error");
  });

  test("completed → pending 拒绝", () => {
    const goal = makeGoal([phase(1, "p1", [task(1, "a", "completed")])]);
    const r = run(goal, "update", { id: 1, status: "pending" });
    expect(r.op.kind).toBe("error");
  });

  test("in_progress → completed 合法", () => {
    const goal = makeGoal([phase(1, "p1", [task(1, "a", "in_progress")])]);
    const r = run(goal, "update", { id: 1, status: "completed", evidence: "npm test ok" });
    expect(r.op.kind).toBe("update");
    expect(r.goal.plan!.phases[0].tasks[0].evidence).toBe("npm test ok");
  });

  test("→ blocked 必带 blockedReason", () => {
    const goal = makeGoal([phase(1, "p1", [task(1, "a", "in_progress")])]);
    // 不带 reason
    expect(run(goal, "update", { id: 1, status: "blocked" }).op.kind).toBe("error");
    // 带 reason
    const r = run(goal, "update", { id: 1, status: "blocked", blockedReason: "缺权限" });
    expect(r.op.kind).toBe("update");
    expect(r.goal.plan!.phases[0].tasks[0].blockedReason).toBe("缺权限");
  });

  test("blocked → in_progress 可回退", () => {
    const goal = makeGoal([phase(1, "p1", [task(1, "a", "blocked", { blockedReason: "x" })])]);
    const r = run(goal, "update", { id: 1, status: "in_progress" });
    expect(r.op.kind).toBe("update");
    expect(r.op.toStatus).toBe("in_progress");
  });

  test("无可变字段报错", () => {
    const goal = makeGoal([phase(1, "p1", [task(1, "a", "pending")])]);
    const r = run(goal, "update", { id: 1 });
    expect(r.op.kind).toBe("error");
  });

  test("task 不存在报错", () => {
    const goal = makeGoal([phase(1, "p1", [task(1, "a")])]);
    const r = run(goal, "update", { id: 99, status: "in_progress" });
    expect(r.op.kind).toBe("error");
  });
});

describe("切片2 · blockedBy 增量合并", () => {
  test("addBlockedBy 增量加入，不重发全数组", () => {
    const goal = makeGoal([phase(1, "p1", [task(1, "a"), task(2, "b", "pending", { blockedBy: [1] })])]);
    const r = run(goal, "update", { id: 2, addBlockedBy: [3] }) ;
    // 3 不存在
    expect(r.op.kind).toBe("error");
  });

  test("addBlockedBy 自环拒绝", () => {
    const goal = makeGoal([phase(1, "p1", [task(1, "a"), task(2, "b")])]);
    const r = run(goal, "update", { id: 2, addBlockedBy: [2] });
    expect(r.op.kind).toBe("error");
  });

  test("addBlockedBy 成环拒绝", () => {
    // 1 blockedBy 2，给 2 加 blockedBy 1 → 环
    const goal = makeGoal([phase(1, "p1", [task(1, "a", "pending", { blockedBy: [2] }), task(2, "b")])]);
    const r = run(goal, "update", { id: 2, addBlockedBy: [1] });
    expect(r.op.kind).toBe("error");
  });

  test("removeBlockedBy 移除", () => {
    const goal = makeGoal([phase(1, "p1", [task(1, "a"), task(2, "b", "pending", { blockedBy: [1] })])]);
    const r = run(goal, "update", { id: 2, removeBlockedBy: [1] });
    expect(r.op.kind).toBe("update");
    expect(r.goal.plan!.phases[0].tasks[1].blockedBy ?? []).toEqual([]);
  });
});

describe("切片2 · list / get", () => {
  test("list 返回所有 task", () => {
    const goal = makeGoal([phase(1, "p1", [task(1, "a"), task(2, "b")]), phase(2, "p2", [task(3, "c")])]);
    const r = run(goal, "list", {});
    expect(r.op.kind).toBe("list");
    if (r.op.kind !== "list") return;
    expect(r.op.tasks).toHaveLength(3);
  });

  test("list 按 phase 过滤", () => {
    const goal = makeGoal([phase(1, "p1", [task(1, "a")]), phase(2, "p2", [task(2, "b")])]);
    const r = run(goal, "list", { phaseId: 2 });
    expect(r.op.kind).toBe("list");
    if (r.op.kind !== "list") return;
    expect(r.op.tasks).toHaveLength(1);
    expect(r.op.tasks[0].id).toBe(2);
  });

  test("list 按 status 过滤", () => {
    const goal = makeGoal([phase(1, "p1", [task(1, "a", "completed"), task(2, "b", "pending")])]);
    const r = run(goal, "list", { status: "completed" });
    expect(r.op.kind).toBe("list");
    if (r.op.kind !== "list") return;
    expect(r.op.tasks).toHaveLength(1);
    expect(r.op.tasks[0].id).toBe(1);
  });

  test("get 返回单 task", () => {
    const goal = makeGoal([phase(1, "p1", [task(1, "a", "in_progress", { activeForm: "正在做" })])]);
    const r = run(goal, "get", { id: 1 });
    expect(r.op.kind).toBe("get");
    if (r.op.kind !== "get") return;
    expect(r.op.task.activeForm).toBe("正在做");
  });

  test("list/get 不改 goal（纯读）", () => {
    const goal = makeGoal([phase(1, "p1", [task(1, "a")])]);
    const before = goal.updatedAt;
    run(goal, "list", {});
    run(goal, "get", { id: 1 });
    expect(goal.updatedAt).toBe(before);
  });
});

describe("切片2 · phase 聚合（recomputePhaseStatus）", () => {
  test("有 in_progress task → phase in_progress", () => {
    const goal = makeGoal([phase(1, "p1", [task(1, "a", "pending")], "pending")]);
    const r = run(goal, "update", { id: 1, status: "in_progress" });
    expect(r.goal.plan!.phases[0].status).toBe("in_progress");
  });

  test("有 blocked 且无 in_progress → phase blocked", () => {
    const goal = makeGoal([phase(1, "p1", [task(1, "a", "in_progress")], "in_progress")]);
    const r = run(goal, "update", { id: 1, status: "blocked", blockedReason: "卡住" });
    expect(r.goal.plan!.phases[0].status).toBe("blocked");
  });

  test("全 completed 不主动升 phase completed（由 dgoal_check 接管）", () => {
    const goal = makeGoal([phase(1, "p1", [task(1, "a", "in_progress")], "in_progress")]);
    const r = run(goal, "update", { id: 1, status: "completed", evidence: "ok" });
    // phase 状态保持，不主动变 completed
    expect(r.goal.plan!.phases[0].status).not.toBe("completed");
  });
});

describe("切片2 · setPhaseCompleted（dgoal_check 专用入口）", () => {
  test("task 全终态 → 允许标 phase completed", () => {
    const goal = makeGoal([phase(1, "p1", [task(1, "a", "completed")], "in_progress")]);
    const r = setPhaseCompleted(goal, 1);
    expect(r.goal.plan!.phases[0].status).toBe("completed");
  });

  test("task 未全终态 → 拒绝标 phase completed", () => {
    const goal = makeGoal([phase(1, "p1", [task(1, "a", "in_progress")])]);
    const r = setPhaseCompleted(goal, 1);
    expect(r.op.kind).toBe("error");
  });

  test("phase 不存在 → 报错", () => {
    const goal = makeGoal([phase(1, "p1", [])]);
    const r = setPhaseCompleted(goal, 99);
    expect(r.op.kind).toBe("error");
  });
});

describe("切片2 · 不可变更新", () => {
  test("reducer 不 mutate 原 goal", () => {
    const goal = makeGoal([phase(1, "p1", [task(1, "a", "pending")])]);
    const originalTasksLen = goal.plan!.phases[0].tasks.length;
    run(goal, "create", { phaseId: 1, subject: "b" });
    expect(goal.plan!.phases[0].tasks.length).toBe(originalTasksLen); // 原 goal 未变
  });
});
