// Plan reducer、proposal 转换、持久化协议与 i18n 组合路径测试。
// 公共工具 execute 的权威覆盖位于 three-plan-runtime.test.ts；本文件不伪装宿主工具调用。
import { beforeEach, describe, expect, test } from "bun:test";

process.env.PI_DGOAL_NO_AUDIT = "1";

import {
  __executePlanProposalForTest,
  __getGoalForTest,
  __getPendingProposalForTest,
  __resetGoalForTest,
  __setApiForTest,
  __setGoalForTest,
  __setProposalSemanticReviewForTest,
  __setI18nForTest,
  applyPlanMutation,
  formatPlanResult,
  proposalToPlan,
  STATE_ENTRY_TYPE,
  type GoalState,
  type PlanProposal,
  type Task,
} from "../index.ts";

describe("Plan reducer 与持久化组合路径", () => {
  beforeEach(() => {
    __resetGoalForTest();
  });

  test("reducer create + update + list + get 与手工持久化协议组合", () => {
    // 只验证 reducer → commit → persist 协议；不声称执行了公共工具 execute。
    const { api, writes } = makeApi();
    __setApiForTest(api);

    let goal: GoalState = makeActiveGoal();

    // create task
    const r1 = applyPlanMutation(goal, "create", { phaseId: 1, subject: "t1", description: "创建 t1 以验证 reducer。" });
    expect(r1.op.kind).toBe("create");
    if (r1.op.kind !== "create") return;
    goal = r1.goal;
    api.appendEntry(STATE_ENTRY_TYPE, { goal });
    expect(goal.plan!.phases[0].tasks).toHaveLength(1);
    expect(goal.plan!.phases[0].tasks[0].subject).toBe("t1");

    // update task: pending → in_progress
    const r2 = applyPlanMutation(goal, "update", { id: r1.op.taskId, status: "in_progress" });
    goal = r2.goal;
    api.appendEntry(STATE_ENTRY_TYPE, { goal });
    expect(goal.plan!.phases[0].tasks[0].status).toBe("in_progress");
    expect(goal.plan!.phases[0].status).toBe("in_progress"); // phase 聚合

    // update task: in_progress → done（带 evidence）
    const r3 = applyPlanMutation(goal, "update", { id: r1.op.taskId, status: "done", evidence: "npm test ok" });
    goal = r3.goal;
    api.appendEntry(STATE_ENTRY_TYPE, { goal });
    expect(goal.plan!.phases[0].tasks[0].status).toBe("done");
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
    // 组合协议约定：list/get 不 commit、不 persist（op kind !== create/update）。
    expect(writes.length).toBe(3);
    expect(writes.every((w) => w.type === STATE_ENTRY_TYPE)).toBe(true);
  });

  test("reducer create 缺 subject 时返回 error，组合层不 persist", () => {
    const { api, writes } = makeApi();
    __setApiForTest(api);
    let goal: GoalState = makeActiveGoal();

    const r = applyPlanMutation(goal, "create", { phaseId: 1 }); // 缺 subject
    expect(r.op.kind).toBe("error");
    // 组合层在 error 时不 commit、不 persist。
    expect(writes.length).toBe(0);
    goal = r.goal; // error 时 goal 不变
    expect(goal.plan!.phases[0].tasks).toHaveLength(0);
  });

  test("done 不回退的不可逆性（连续 reject）", () => {
    const { api, writes } = makeApi();
    __setApiForTest(api);
    let goal: GoalState = makeActiveGoal();
    const c = applyPlanMutation(goal, "create", { phaseId: 1, subject: "t", description: "创建 t 以验证不可逆状态。" });
    if (c.op.kind !== "create") throw new Error("setup");
    goal = c.goal; api.appendEntry(STATE_ENTRY_TYPE, { goal });
    const cid = c.op.taskId;
    const started = applyPlanMutation(goal, "update", { id: cid, status: "in_progress" });
    goal = started.goal; api.appendEntry(STATE_ENTRY_TYPE, { goal });
    const r = applyPlanMutation(goal, "update", { id: cid, status: "done", evidence: "ok" });
    goal = r.goal; api.appendEntry(STATE_ENTRY_TYPE, { goal });

    // 尝试回退
    const r2 = applyPlanMutation(goal, "update", { id: cid, status: "in_progress" });
    expect(r2.op.kind).toBe("error");
    // goal 不变（不 commit）
    expect(goal.plan!.phases[0].tasks[0].status).toBe("done");
    // persist 序列：create + in_progress + done = 3 次（reject 不增）
    expect(writes.length).toBe(3);
  });
});

describe("proposalToPlan 转换 + plan 注入", () => {
  test("3 phase 6 task proposal 转换后结构正确", () => {
    const { api } = makeApi();
    __setApiForTest(api);
    // 模拟 phase_plan / goal_plan 内部: proposalToPlan
    const proposal: PlanProposal = {
      objective: "大型任务",
      description: "按调研、实现、验证顺序推进。",
      phases: [
        { subject: "调研", description: "先确认现状。", tasks: [{ subject: "读代码", description: "定位实现。" }, { subject: "看文档", description: "确认契约。" }] },
        { subject: "实现", description: "按契约完成改动。", tasks: [{ subject: "写主逻辑", description: "实现行为。" }, { subject: "写测试", description: "覆盖行为。" }] },
        { subject: "验证", description: "复验完整交付。", tasks: [{ subject: "跑测试", description: "获得测试证据。" }, { subject: "做回归", description: "确认无回归。" }] },
      ],
    };
    // proposalToPlan 是 phase_plan / goal_plan 工具 execute 调用的真实函数
    const plan = proposalToPlan(proposal);
    expect(plan.phases).toHaveLength(3);
    expect(plan.phases[0].tasks).toHaveLength(2);
    expect(plan.phases.map((phase) => phase.id)).toEqual([1, 2, 3]);
    expect(plan.phases.flatMap((phase) => phase.tasks.map((task) => task.id))).toEqual([1, 2, 3, 4, 5, 6]);
    expect(plan.nextId).toBe(7);

    // 注入到 goal
    const goal: GoalState = { ...makeActiveGoal(), plan, objective: proposal.objective };
    expect(goal.plan!.phases[0].subject).toBe("调研");
  });
});

describe("reducer 涌现分解：长链 blockedBy", () => {
  test("真实场景：5 task 线性依赖，addBlockedBy 增量合并", () => {
    const { api } = makeApi();
    __setApiForTest(api);
    let goal: GoalState = makeActiveGoal();

    // 建 5 个 task（id 1-5）
    for (let i = 0; i < 5; i += 1) {
      const r = applyPlanMutation(goal, "create", { phaseId: 1, subject: `t${i + 1}`, description: `创建 t${i + 1} 以验证长依赖链。` });
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

describe("工具 execute · proposal 语义预审状态边界", () => {
  beforeEach(() => {
    __resetGoalForTest();
    __setGoalForTest({ id: "tool-proposal-1", objective: "proposal 测试", description: "等待 proposal。", status: "pending", startedAt: 1, updatedAt: 1, iteration: 0 });
  });

  test("rejected/error 不激活 goal，合法重提才写入 pendingProposal", async () => {
    const params = {
      objective: "proposal 测试",
      description: "验证 proposal 状态边界。",
      verification: "bun test",
      acceptanceCriteria: [{ criterion: "测试通过", evidence: "bun test" }],
      phases: [{ subject: "阶段", description: "完成 proposal 验证。", acceptanceCriteria: [{ criterion: "测试通过", evidence: "bun test" }] }],
    };

    __setProposalSemanticReviewForTest(() => ({ decision: "reject", reason: "human-only condition" }));
    const rejected = await __executePlanProposalForTest(params);
    expect(rejected.details?.error).toBe("semantic review rejected");
    expect(__getGoalForTest()?.status).toBe("pending");
    expect(__getPendingProposalForTest()).toBeUndefined();

    __setProposalSemanticReviewForTest(() => { throw new Error("provider unavailable"); });
    const errored = await __executePlanProposalForTest(params);
    expect(errored.details?.error).toBe("semantic review technical error");
    expect(errored.isError).toBe(true);
    expect(__getGoalForTest()?.status).toBe("pending");
    expect(__getPendingProposalForTest()).toBeUndefined();

    __setProposalSemanticReviewForTest(() => ({
      decision: "approve",
      acceptanceCriteria: params.acceptanceCriteria,
      phaseAcceptanceCriteria: [params.phases[0].acceptanceCriteria],
    }));
    const approved = await __executePlanProposalForTest(params);
    expect(approved.details?.semanticReview).toBe("approve");
    expect(__getGoalForTest()?.status).toBe("pending");
    expect(__getPendingProposalForTest()?.goalId).toBe("tool-proposal-1");
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

  test("phase_plan / goal_plan 无 pending goal 的固定结果文案可被英文 i18n 覆盖", async () => {
    __resetGoalForTest();
    __setI18nForTest({
      t: (key: string) => key === "dgoal.tool.propose.noPendingGoal" ? "There is no pending /dgoal goal (startup gate is not active)." : undefined,
    });
    try {
      const result = await __executePlanProposalForTest({ objective: "o", phases: [{ subject: "p" }], verification: "v" });
      expect(String(result.content?.[0]?.text ?? "")).toBe("There is no pending /dgoal goal (startup gate is not active).");
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
    description: "验证 reducer 与持久化组合。",
    status: "active",
    startedAt: 1,
    updatedAt: 1,
    iteration: 0,
    plan: {
      phases: [{ id: 1, subject: "p1", description: "测试阶段。", status: "pending", tasks: [] }],
      nextId: 2,
    },
  };
}
