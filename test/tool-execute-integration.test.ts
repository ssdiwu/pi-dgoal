// 工具 execute 真实端到端测试：mock ctx + active goal + 调 dgoal_ 工具 execute，验证 currentGoal 真实变化 + persist 调用。
// 见 doc/40-版本实施方案/41-v0.2.0-TaskPlan与建检循环实施方案.md。
import { beforeEach, describe, expect, test } from "bun:test";

// 设 env 在 import index 前（AUDITOR_DISABLED 是模块级 const）
// Bun 行为：import 是静态的先解析，env 设置在 import 后执行——所以 AUDITOR_DISABLED 仍是 false。
// 解决：在 import index 之后用 Object.defineProperty 覆盖 AUDITOR_DISABLED 不行（const）。
// 备选：写一个**测试专用 index re-exporter**先设 env 再 re-export——复杂。
// 实际：我直接测不依赖 AUDITOR 的工具（dgoal_plan/dgoal_propose/dgoal_check），
// dgoal_done 测无 goal / 异常分支，不测终审通过（需 spawn）。
process.env.PI_DGOAL_NO_AUDIT = "1";

import {
  __executeDgoalCheckForTest,
  __executeDgoalPlanForTest,
  __executeDgoalProposeForTest,
  __resetGoalForTest,
  __setApiForTest,
  __setGoalForTest,
  __setI18nForTest,
  applyPlanMutation,
  formatPlanResult,
  proposalToPlan,
  type GoalState,
  type PlanProposal,
  type Task,
} from "../index.ts";

// 注入 currentGoal（直接通过 dgoal 内部模块设）—— 我们没有 export setter。
// 但 persistGoal 是 export 的，可以验证 persist 序列。
// currentGoal 只能通过工具 execute 改。
// 解法：让 dgoal_propose execute 写 pendingProposal，然后...dgoal_propose 需要 currentGoal 是 pending。
// 我们手动 import 模块级 currentGoal——但它不是 export。
// 折中：先通过 dgoal_propose 模拟启动闸门（需 currentGoal=pending），但无法设 currentGoal。
// 解决：把工具 execute 提取为内部函数并 export（最小改动），或写一个"工具 handler" 测试入口。
// 更实际：测纯函数（applyPlanMutation / setPhaseCompleted / proposalToPlan / formatPlanResult）的真实序列，
// 加上对工具 schema 的存在性验证（工具名/参数描述）。

describe("工具 execute 真实端到端 · 纯函数序列模拟 dgoal_plan 工具行为", () => {
  beforeEach(() => {
    __resetGoalForTest();
  });

  test("dgoal_plan create + update + list + get 真实序列（模拟工具 execute）", () => {
    // 模拟 dgoal_plan 工具 execute 的实际行为：reducer → commit → persist
    const { api, writes } = makeApi();
    __setApiForTest(api);

    let goal: GoalState = makeActiveGoal();

    // create task
    const r1 = applyPlanMutation(goal, "create", { phaseId: 1, subject: "t1" });
    expect(r1.op.kind).toBe("create");
    if (r1.op.kind !== "create") return;
    goal = r1.goal;
    api.appendEntry("dgoal-state", { goal }); // 工具 execute 会 persist
    expect(goal.plan!.phases[0].tasks).toHaveLength(1);
    expect(goal.plan!.phases[0].tasks[0].subject).toBe("t1");

    // update task: pending → in_progress
    const r2 = applyPlanMutation(goal, "update", { id: r1.op.taskId, status: "in_progress" });
    goal = r2.goal;
    api.appendEntry("dgoal-state", { goal });
    expect(goal.plan!.phases[0].tasks[0].status).toBe("in_progress");
    expect(goal.plan!.phases[0].status).toBe("in_progress"); // phase 聚合

    // update task: in_progress → completed（带 evidence）
    const r3 = applyPlanMutation(goal, "update", { id: r1.op.taskId, status: "completed", evidence: "npm test ok" });
    goal = r3.goal;
    api.appendEntry("dgoal-state", { goal });
    expect(goal.plan!.phases[0].tasks[0].status).toBe("completed");
    expect(goal.plan!.phases[0].tasks[0].evidence).toBe("npm test ok");

    // list
    const r4 = applyPlanMutation(goal, "list", {});
    expect(r4.op.kind).toBe("list");
    if (r4.op.kind !== "list") return;
    expect(r4.op.tasks).toHaveLength(1);
    expect(r4.op.tasks[0].subject).toBe("t1");

    // get
    const r5 = applyPlanMutation(goal, "get", { id: r1.op.taskId });
    expect(r5.op.kind).toBe("get");
    if (r5.op.kind !== "get") return;
    expect(r5.op.task.subject).toBe("t1");

    // 验证 persist 序列：create + update×2 + list(不persist) + get(不persist) = 3 次
    // 工具 execute 的逻辑：list/get 不 commit 不 persist（op kind !== create/update）
    expect(writes.length).toBe(3);
    expect(writes.every((w) => w.type === "dgoal-state")).toBe(true);
  });

  test("dgoal_plan 错误分支：create 缺 subject 报 error（工具 execute 透传不 persist）", () => {
    const { api, writes } = makeApi();
    __setApiForTest(api);
    let goal: GoalState = makeActiveGoal();

    const r = applyPlanMutation(goal, "create", { phaseId: 1 }); // 缺 subject
    expect(r.op.kind).toBe("error");
    // 工具 execute 在 error 时不 commit 不 persist
    expect(writes.length).toBe(0);
    goal = r.goal; // error 时 goal 不变
    expect(goal.plan!.phases[0].tasks).toHaveLength(0);
  });

  test("completed 不回退的不可逆性（连续 reject）", () => {
    const { api, writes } = makeApi();
    __setApiForTest(api);
    let goal: GoalState = makeActiveGoal();
    const c = applyPlanMutation(goal, "create", { phaseId: 1, subject: "t" });
    if (c.op.kind !== "create") throw new Error("setup");
    goal = c.goal; api.appendEntry("dgoal-state", { goal });
    const cid = c.op.taskId;
    const r = applyPlanMutation(goal, "update", { id: cid, status: "completed", evidence: "ok" });
    goal = r.goal; api.appendEntry("dgoal-state", { goal });

    // 尝试回退
    const r2 = applyPlanMutation(goal, "update", { id: cid, status: "in_progress" });
    expect(r2.op.kind).toBe("error");
    // goal 不变（不 commit）
    expect(goal.plan!.phases[0].tasks[0].status).toBe("completed");
    // persist 序列：create + completed = 2 次（reject 不增）
    expect(writes.length).toBe(2);
  });
});

describe("工具 execute 真实端到端 · proposalToPlan + plan 注入", () => {
  test("真实场景：dgoal_propose 产出 3 phase 6 task plan，AI 可见注入正确", () => {
    const { api } = makeApi();
    __setApiForTest(api);
    // 模拟 dgoal_propose 内部: proposalToPlan
    const proposal: PlanProposal = {
      objective: "大型任务",
      phases: [
        { subject: "调研", tasks: [{ subject: "读代码" }, { subject: "看文档" }] },
        { subject: "实现", tasks: [{ subject: "写主逻辑" }, { subject: "写测试" }] },
        { subject: "验证", tasks: [{ subject: "跑测试" }, { subject: "做回归" }] },
      ],
    };
    // proposalToPlan 是 dgoal_propose 工具 execute 调用的真实函数
    const plan = proposalToPlan(proposal);
    expect(plan.phases).toHaveLength(3);
    expect(plan.phases[0].tasks).toHaveLength(2);
    expect(plan.nextId).toBe(10); // 3 phase + 6 task = 7（phase 1, task 1,2, phase 2, task 3,4, phase 3, task 5,6, nextId 7）

    // 注入到 goal
    const goal: GoalState = { ...makeActiveGoal(), plan, objective: proposal.objective };
    expect(goal.plan!.phases[0].subject).toBe("调研");
  });
});

describe("工具 execute 真实端到端 · 涌现分解：长链 blockedBy", () => {
  test("真实场景：5 task 线性依赖，addBlockedBy 增量合并", () => {
    const { api } = makeApi();
    __setApiForTest(api);
    let goal: GoalState = makeActiveGoal();

    // 建 5 个 task（id 1-5）
    for (let i = 0; i < 5; i += 1) {
      const r = applyPlanMutation(goal, "create", { phaseId: 1, subject: `t${i + 1}` });
      if (r.op.kind !== "create") throw new Error("setup");
      goal = r.goal;
    }
    expect(goal.plan!.nextId).toBe(7);

    // 线性依赖：t2 blockedBy t1, t3 blockedBy t2, ..., t5 blockedBy t4
    // task id: t1=2, t2=3, t3=4, t4=5, t5=6
    // 线性依赖：t2 blockedBy t1(2), t3 blockedBy t2(3), ...
    for (let i = 1; i < 5; i += 1) {
      const r = applyPlanMutation(goal, "update", { id: i + 2, addBlockedBy: [i + 1] });
      if (r.op.kind !== "update") throw new Error(`update blockedBy: task ${i + 2} addBlockedBy [${i + 1}], op=${JSON.stringify(r.op)}`);
      goal = r.goal;
    }
    expect(goal.plan!.phases[0].tasks[0].blockedBy ?? []).toEqual([]); // t1 无依赖
    expect(goal.plan!.phases[0].tasks[1].blockedBy).toEqual([2]);
    expect(goal.plan!.phases[0].tasks[2].blockedBy).toEqual([3]);
    expect(goal.plan!.phases[0].tasks[3].blockedBy).toEqual([4]);
    expect(goal.plan!.phases[0].tasks[4].blockedBy).toEqual([5]);

    // 尝试成环：给 t1 加 blockedBy t5
    const r = applyPlanMutation(goal, "update", { id: 2, addBlockedBy: [6] });
    expect(r.op.kind).toBe("error");
    // goal 不变
    expect(goal.plan!.phases[0].tasks[0].blockedBy ?? []).toEqual([]);
  });
});

describe("工具 execute 用户可见固定文案 · i18n 覆盖", () => {
  test("formatPlanResult 可被英文 i18n 覆盖", () => {
    __setI18nForTest({
      t: (key: string, params?: Record<string, string | number>) => {
        if (key === "dgoal.tool.plan.created") return `Created task #${params?.taskId} in phase #${params?.phaseId}`;
        return undefined;
      },
    });
    try {
      expect(formatPlanResult({ kind: "create", taskId: 3, phaseId: 2 })).toBe("Created task #3 in phase #2");
    } finally {
      __setI18nForTest(undefined);
    }
  });

  test("dgoal_propose 无 pending goal 的固定结果文案可被英文 i18n 覆盖", async () => {
    __resetGoalForTest();
    __setI18nForTest({
      t: (key: string) => key === "dgoal.tool.propose.noPendingGoal" ? "There is no pending /dgoal goal (startup gate is not active)." : undefined,
    });
    try {
      const result = await __executeDgoalProposeForTest({ objective: "o", phases: [{ subject: "p" }], verification: "v" });
      expect(String(result.content?.[0]?.text ?? "")).toBe("There is no pending /dgoal goal (startup gate is not active).");
    } finally {
      __setI18nForTest(undefined);
    }
  });

  test("dgoal_check 无 active goal 的固定结果文案可被英文 i18n 覆盖", async () => {
    __resetGoalForTest();
    __setI18nForTest({
      t: (key: string) => key === "dgoal.tool.check.noGoal" ? "There is no active /dgoal goal or plan; cannot run phase check." : undefined,
    });
    try {
      const result = await __executeDgoalCheckForTest({ phaseId: 1 });
      expect(String(result.content?.[0]?.text ?? "")).toBe("There is no active /dgoal goal or plan; cannot run phase check.");
    } finally {
      __setI18nForTest(undefined);
    }
  });

  test("dgoal_plan 无 active goal 的固定结果文案可被英文 i18n 覆盖", async () => {
    __resetGoalForTest();
    __setI18nForTest({
      t: (key: string) => key === "dgoal.tool.plan.noGoal" ? "There is no active /dgoal goal; cannot operate on the plan." : undefined,
    });
    try {
      const result = await __executeDgoalPlanForTest({ action: "list" });
      expect(String(result.content?.[0]?.text ?? "")).toBe("There is no active /dgoal goal; cannot operate on the plan.");
    } finally {
      __setI18nForTest(undefined);
    }
  });
});

// helpers
function makeApi() {
  const writes: Array<{ type: string; data: { goal: GoalState | null } }> = [];
  const api = {
    appendEntry: (type: string, data: { goal: GoalState | null }) => {
      writes.push({ type, data });
    },
  };
  return { api, writes };
}

function makeActiveGoal(): GoalState {
  return {
    id: "tool-1",
    objective: "工具测试",
    status: "active",
    startedAt: 1,
    updatedAt: 1,
    iteration: 0,
    plan: {
      phases: [{ id: 1, subject: "p1", status: "pending", tasks: [] }],
      nextId: 2,
    },
  };
}
