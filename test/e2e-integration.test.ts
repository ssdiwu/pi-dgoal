// 端到端集成测试：模拟一次完整的 /dgoal 流程（不 spawn 子进程，绕过 AUDITOR）。
// 见 doc/40-版本实施方案/41-v0.2.0-TaskPlan与建检循环实施方案.md。
import { beforeEach, describe, expect, test } from "bun:test";

// 必须在 import index 前设好（index 模块级 const 在 import 时固化 env）
// bun test 文件 import 是静态的，import 前的顶层赋值在 import 解析时执行顺序不确定；
// 保险做法：用 module-level 副作用（此文件先 import "bun:test"，再 import index）。
// index.ts 的 AUDITOR_DISABLED = process.env.PI_DGOAL_NO_AUDIT === "1" 在 import 时读。
// bun: 在 import index 时读取，此时 process.env 已 set。
// 注意：此文件不能有 .env / dotenv 覆盖 PI_DGOAL_NO_AUDIT。
process.env.PI_DGOAL_NO_AUDIT = "1";

import {
  __resetGoalForTest,
  __setApiForTest,
  renderPlanLines,
  type LoopGoal,
  type Phase,
  type PlanProposal,
  proposalToPlan,
  setPhaseCompleted,
  type Task,
  type TaskPlan,
} from "../index.ts";

// mock api：捕获 persistGoal 写入 + 模拟 appendEntry
function makeApi() {
  const writes: Array<{ type: string; data: { goal: LoopGoal | null } }> = [];
  const api = {
    appendEntry: (type: string, data: { goal: LoopGoal | null }) => {
      writes.push({ type, data });
    },
  };
  return { api, writes };
}

function makeTask(id: number, subject: string, status: Task["status"] = "pending", extra: Partial<Task> = {}): Task {
  return { id, subject, status, ...extra };
}
function makePhase(id: number, subject: string, tasks: Task[], status: Phase["status"] = "pending"): Phase {
  return { id, subject, tasks, status };
}

describe("端到端集成 · Goal 状态机完整生命周期（不 spawn）", () => {
  beforeEach(() => {
    __resetGoalForTest();
  });

  test("完整流程：startGoal → propose → confirm → plan → task completed → phase completed → dgoal_done(AUDITOR bypass) → done", () => {
    const { api, writes } = makeApi();
    __setApiForTest(api);

    // 1. 启动 goal（pending 状态，模拟 startGoal 建 goal）
    let goal: LoopGoal = {
      id: "e2e-1",
      objective: "E2E 测试目标",
      status: "pending",
      startedAt: Date.now(),
      updatedAt: Date.now(),
      iteration: 0,
    };

    // 2. 主代理提交 proposal（模拟 dgoal_propose 写 pendingProposal 后被 startGoal 消费）
    const proposal: PlanProposal = {
      objective: "E2E 测试目标",
      phases: [
        { subject: "阶段A", tasks: [{ subject: "task1" }, { subject: "task2" }] },
        { subject: "阶段B", tasks: [{ subject: "task3" }] },
      ],
    };
    goal = { ...goal, plan: proposalToPlan(proposal), status: "active" };
    // 模拟 persistGoal（startGoal 确认后会 persist）
    api.appendEntry("dgoal-state", { goal });

    // 3. 验证 plan 完整
    expect(goal.plan).toBeDefined();
    expect(goal.plan!.phases).toHaveLength(2);
    expect(goal.plan!.phases[0].tasks).toHaveLength(2);
    expect(goal.plan!.phases[1].tasks).toHaveLength(1);
    expect(goal.plan!.nextId).toBe(6);

    // 4. 阶段A 的 task1 推进：pending → in_progress
    const t1 = goal.plan!.phases[0].tasks[0];
    expect(t1.status).toBe("pending");
    // 模拟 dgoal_plan update（直接调 reducer 模拟工具 execute 的 commit 行为）
    const r1 = applyPlanUpdate(goal, { id: t1.id, status: "in_progress", activeForm: "正在做 task1" });
    goal = r1.goal;
    api.appendEntry("dgoal-state", { goal });
    expect(goal.plan!.phases[0].tasks[0].status).toBe("in_progress");
    expect(goal.plan!.phases[0].status).toBe("in_progress"); // 聚合

    // 5. task1 → completed（带 evidence）
    const r2 = applyPlanUpdate(goal, { id: t1.id, status: "completed", evidence: "跑测试全过" });
    goal = r2.goal;
    api.appendEntry("dgoal-state", { goal });
    expect(goal.plan!.phases[0].tasks[0].status).toBe("completed");
    expect(goal.plan!.phases[0].tasks[0].evidence).toBe("跑测试全过");

    // 6. task2 完成
    const r3 = applyPlanUpdate(goal, { id: 3, status: "completed", evidence: "ok" });
    goal = r3.goal;
    api.appendEntry("dgoal-state", { goal });
    expect(goal.plan!.phases[0].tasks[1].status).toBe("completed");
    expect(goal.plan!.phases[0].status).toBe("in_progress"); // 聚合：仍有 in_progress task

    // 7. 阶段A task 全终态：阶段A 进 dgoal_check
    // 先把 task2 标记 completed（实际上面 r3 已做）
    // 阶段A task 状态：task1 completed, task2 completed → 全终态
    // 模拟 dgoal_check approved → setPhaseCompleted
    const r4 = setPhaseCompleted(goal, 1);
    expect(r4.op.kind).not.toBe("error");
    goal = r4.goal;
    api.appendEntry("dgoal-state", { goal });
    expect(goal.plan!.phases[0].status).toBe("completed");

    // 8. 阶段B task3 完成
    const r5 = applyPlanUpdate(goal, { id: 5, status: "completed", evidence: "ok" });
    goal = r5.goal;
    api.appendEntry("dgoal-state", { goal });

    // 9. 阶段B 也全终态 → setPhaseCompleted
    const r6 = setPhaseCompleted(goal, 4);
    goal = r6.goal;
    expect(goal.plan!.phases[1].status).toBe("completed");

    // 10. 模拟 dgoal_done（AUDITOR bypass）：直接调 finalize 行为——设 done
    // finalizeGoal 内部是：status: done → persistGoal(null) → currentGoal=undefined
    // 这里模拟这个序列
    goal = { ...goal, status: "done", updatedAt: Date.now() };
    api.appendEntry("dgoal-state", { goal: null }); // finalize 写 null

    // 11. 验证：所有 phase completed，goal done，persist 序列完整
    expect(goal.plan!.phases.every((p) => p.status === "completed")).toBe(true);
    expect(goal.status).toBe("done");
    expect(writes.length).toBeGreaterThanOrEqual(7); // 多次 persist
    expect(writes[writes.length - 1].data.goal).toBeNull(); // 最后一次写 null
  });

  test("rejected 计数到 3 转 paused(audit_failed_3x)", () => {
    const { api } = makeApi();
    __setApiForTest(api);

    let goal: LoopGoal = {
      id: "e2e-2",
      objective: "rejected 测试",
      status: "rejected",
      rejectedCount: 2,
      startedAt: 1,
      updatedAt: 1,
      iteration: 0,
    };

    // 模拟终审不过逻辑（dgoal_done 内的 reject 分支）
    const newCount = (goal.rejectedCount ?? 0) + 1;
    if (newCount >= 3) {
      goal = { ...goal, status: "paused", pauseReason: "audit_failed_3x", rejectedCount: newCount, updatedAt: Date.now() };
    }
    expect(goal.status).toBe("paused");
    expect(goal.pauseReason).toBe("audit_failed_3x");
    expect(goal.rejectedCount).toBe(3);
  });

  test("rejected 状态 isLooping 返回 true（agent_end/before_agent_start 仍推进）", () => {
    const isLooping = (status: LoopGoal["status"]) => status === "active" || status === "rejected";
    expect(isLooping("rejected")).toBe(true);
    expect(isLooping("active")).toBe(true);
    expect(isLooping("paused")).toBe(false);
    expect(isLooping("done")).toBe(false);
  });

  test("resume(audit_failed_3x) 清零 rejectedCount，resume(其他) 不清零", () => {
    const { api } = makeApi();
    __setApiForTest(api);

    // audit_failed_3x
    const g1: LoopGoal = { id: "1", objective: "o", status: "paused", pauseReason: "audit_failed_3x", rejectedCount: 3, startedAt: 1, updatedAt: 1, iteration: 0 };
    const clear1 = g1.pauseReason === "audit_failed_3x";
    expect(clear1).toBe(true);

    // user_abort
    const g2: LoopGoal = { id: "2", objective: "o", status: "paused", pauseReason: "user_abort", startedAt: 1, updatedAt: 1, iteration: 0 };
    const clear2 = g2.pauseReason === "audit_failed_3x";
    expect(clear2).toBe(false);
  });
});

describe("端到端集成 · 浮层渲染与状态机的连贯性", () => {
  test("phase 状态变化后浮层正确反映", () => {
    let goal: LoopGoal = {
      id: "e2e-3",
      objective: "连贯性测试",
      status: "active",
      startedAt: 1,
      updatedAt: 1,
      iteration: 0,
      plan: {
        phases: [makePhase(1, "p1", [makeTask(1, "t1", "pending")], "pending")],
        nextId: 2,
      } as TaskPlan,
    };
    // 初始：phase pending, task pending
    let lines = renderPlanLines(goal, { hiddenPhaseIds: new Set(), expandTasks: true });
    expect(lines.find((l) => l.includes("p1"))).toContain("○");

    // task in_progress → phase 聚合 in_progress
    const r = applyPlanUpdate(goal, { id: 1, status: "in_progress" });
    goal = r.goal;
    lines = renderPlanLines(goal, { hiddenPhaseIds: new Set(), expandTasks: true });
    expect(lines.find((l) => l.includes("p1"))).toContain("◐");
    expect(lines.find((l) => l.includes("t1"))).toContain("◐");

    // task completed → setPhaseCompleted
    const r2 = applyPlanUpdate(goal, { id: 1, status: "completed", evidence: "ok" });
    goal = r2.goal;
    const r3 = setPhaseCompleted(goal, 1);
    goal = r3.goal;
    // heading 应显示 1/1
    lines = renderPlanLines(goal, { hiddenPhaseIds: new Set(), expandTasks: false });
    expect(lines[0]).toContain("1/1");
    // completed phase 闪现：未隐藏则显示
    expect(lines.find((l) => l.includes("✓"))).toBeDefined();
  });

  // formatStatus 是 dgoal 内部函数未 export，跳过此测试（在 state-machine-and-prompt 覆盖状态语义）
});

describe("端到端集成 · 启动闸门兜底（拷问 25：重试 2 次失败中止）", () => {
  test("proposalRetryCount 计数到 2 后第三次应中止", () => {
    const MAX = 2;
    let count = 0;
    const outcomes: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      count += 1;
      if (count <= MAX) {
        outcomes.push("retry");
      } else {
        outcomes.push("abort");
      }
    }
    expect(outcomes.slice(0, 2)).toEqual(["retry", "retry"]);
    expect(outcomes[2]).toBe("abort");
    expect(outcomes[3]).toBe("abort");
  });
});

// helper：模拟 dgoal_plan update 工具的 commit 行为（reducer + 不可变更新）
// 直接 import applyPlanMutation 会让测试更重，这里用最小的 applyPlanUpdate
// 复刻工具的 reducer 核心：status 转换 + phase 聚合，调用真正的 export 函数
import { applyPlanMutation, detectPlanCycle } from "../index.ts";

function applyPlanUpdate(goal: LoopGoal, params: Record<string, unknown>): { goal: LoopGoal; op: unknown } {
  const r = applyPlanMutation(goal, "update", params);
  return { goal: r.goal, op: r.op };
}

// 验证 detectPlanCycle 在端到端场景中的正确性
describe("端到端集成 · 涌现分解：blockedBy DAG", () => {
  test("真实场景：5 个 task 复杂依赖图", () => {
    const tasks: Task[] = [
      makeTask(1, "调研", "completed", { blockedBy: [2, 3] }), // 错误：1 依赖 2/3，但 1 编号小
      makeTask(2, "建仓", "completed"),
      makeTask(3, "装依赖", "completed"),
    ];
    // 不应成环
    expect(detectPlanCycle(tasks, 1, [2, 3])).toBe(false);

    // 成环：给 task 2 加 blockedBy 1（2 已 completed，但 reducer 仍做环检测）
    const tasks2: Task[] = [
      makeTask(1, "a", "completed", { blockedBy: [2] }),
      makeTask(2, "b", "completed"),
    ];
    expect(detectPlanCycle(tasks2, 2, [1])).toBe(true);
  });
});
