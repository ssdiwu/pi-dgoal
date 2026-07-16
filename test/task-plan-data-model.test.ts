// 切片 1：Task Plan 数据模型 + 持久化往返 + 向后兼容
// 见 doc/40-版本实施方案/41-v0.2.0-TaskPlan与建检循环实施方案.md
import { describe, expect, test } from "bun:test";

import {
  __resetGoalForTest,
  __setApiForTest,
  __setRuntimeStateForTest,
  __getPendingProposalForTest,
  resyncGoalFromSession,
  isGoalState,
  loadGoal,
  persistGoal,
  setPhaseFeedback,
  recordPhaseAuditFeedback,
  clearPhaseFeedback,
  setFinalFeedback,
  appendFinalAuditHistory,
  currentUncheckedPhase,
  type AcceptanceCriterion,
  type GoalState,
  type Phase,
  type Task,
  type TaskPlan,
} from "../index.ts";

// 构造一个带 plan 的 goal（0.2.0 形态）
const acceptanceCriteria: AcceptanceCriterion[] = [{ criterion: "测试通过", evidence: "npm test" }];

function makeGoalWithPlan(overrides: Partial<GoalState> = {}): GoalState {
  const task: Task = {
    id: 1,
    subject: "修登录测试",
    activeForm: "正在修登录测试",
    status: "in_progress",
    evidence: "npm test auth 全过",
  };
  const phase: Phase = {
    id: 1,
    subject: "修复 auth 模块",
    acceptanceCriteria,
    status: "in_progress",
    tasks: [task],
  };
  const plan: TaskPlan = { phases: [phase], nextId: 2 };
  return {
    id: "goal-1",
    objective: "修好测试",
    status: "active",
    startedAt: 1000,
    updatedAt: 2000,
    iteration: 3,
    plan,
    verification: "全量测试通过",
    acceptanceCriteria,
    userReviewItems: ["人工确认 TUI 观感"],
    ...overrides,
  };
}

// 构造一个旧形态 goal（0.1.x，无 plan/verification/pauseReason/rejectedCount）
function makeLegacyGoal(): GoalState {
  return {
    id: "legacy-1",
    objective: "旧目标",
    status: "active",
    startedAt: 1000,
    updatedAt: 2000,
    iteration: 1,
    contextSummary: "旧背景",
  };
}

// mock ctx：getBranch 返回给定 entries
function makeCtx(entries: Array<{ type?: string; customType?: string; data?: unknown }>) {
  return {
    cwd: "/tmp",
    ui: {
      confirm: async () => true,
      notify: () => {},
      setStatus: () => {},
    },
    sessionManager: { getBranch: () => entries },
  };
}

describe("切片1 · isGoalState 向后兼容", () => {
  test("接受 0.2.0 带 plan 的 goal", () => {
    expect(isGoalState(makeGoalWithPlan())).toBe(true);
  });

  test("接受 0.1.x 旧 goal（无 plan 字段）", () => {
    expect(isGoalState(makeLegacyGoal())).toBe(true);
  });

  test("拒绝缺少必填字段的值", () => {
    expect(isGoalState(null)).toBe(false);
    expect(isGoalState({ id: "x" })).toBe(false);
    expect(isGoalState({ id: "x", objective: "o", status: "active", startedAt: 1 })).toBe(false);
  });

  test("plan 内部结构不进 isGoalState 硬校验（由 reducer 保证）", () => {
    // 即便 plan 内部是脏数据，isGoalState 仍只校验 goal 顶层必填字段
    const goal = makeGoalWithPlan({ plan: { phases: [], nextId: 1 } as TaskPlan });
    expect(isGoalState(goal)).toBe(true);
  });
});

describe("切片1 · persist/load 往返", () => {
  test("冻结验收契约 persist 后 load 能完整恢复", () => {
    __resetGoalForTest();
    let captured: { type: string; data: { goal: GoalState | null } } | undefined;
    __setApiForTest({
      appendEntry: (type, data) => {
        captured = { type, data: data as { goal: GoalState | null } };
      },
    });

    const original = makeGoalWithPlan();
    persistGoal(original);

    // persistGoal 写入 captured
    expect(captured?.type).toBe("dgoal-plan-v1");
    expect(captured?.data.goal).not.toBeNull();

    // 用写入的 entry 构造 ctx，loadGoal 应恢复完整 plan
    const ctx = makeCtx([
      { type: "custom", customType: "dgoal-plan-v1", data: captured!.data },
    ]);
    const restored = loadGoal(ctx as never);

    expect(restored).not.toBeUndefined();
    expect(restored!.id).toBe("goal-1");
    expect(restored!.verification).toBe("全量测试通过");
    expect(restored!.plan).toBeDefined();
    expect(restored!.plan!.phases).toHaveLength(1);
    expect(restored!.plan!.phases[0].subject).toBe("修复 auth 模块");
    expect(restored!.plan!.phases[0].tasks).toHaveLength(1);
    expect(restored!.plan!.phases[0].tasks[0].subject).toBe("修登录测试");
    expect(restored!.plan!.phases[0].tasks[0].evidence).toBe("npm test auth 全过");
    expect(restored!.plan!.nextId).toBe(2);
  });

  test("pending proposal 与 pending goal 同 entry 持久化，并在 session 重同步后恢复", () => {
    const writes: Array<{ goal?: GoalState | null; pendingProposal?: unknown }> = [];
    const pendingGoal = makeGoalWithPlan({ id: "pending-proposal", status: "pending", planType: "phase" });
    __setApiForTest({ appendEntry: (_type, data) => { writes.push(data); } });
    __setRuntimeStateForTest({ pendingProposal: { goalId: pendingGoal.id, proposal: { objective: "修好测试", verification: "全量测试通过", acceptanceCriteria, phases: [] } as any } });
    persistGoal(pendingGoal);
    __resetGoalForTest();
    resyncGoalFromSession({
      sessionManager: { getBranch: () => [{ type: "custom", customType: "dgoal-plan-v1", data: writes.at(-1) }] },
      cwd: "/tmp",
      ui: { setStatus: () => {}, notify: () => {} },
    } as any);
    expect(loadGoal({ sessionManager: { getBranch: () => [{ type: "custom", customType: "dgoal-plan-v1", data: writes.at(-1) }] } } as any)?.id).toBe(pendingGoal.id);
    expect(__getPendingProposalForTest()?.goalId).toBe(pendingGoal.id);
    __setApiForTest(undefined);
  });

  test("persistGoal(null) 写入空 goal，loadGoal 返回 undefined", () => {
    __resetGoalForTest();
    let captured: { goal: GoalState | null } | undefined;
    __setApiForTest({
      appendEntry: (_type, data) => {
        captured = data as { goal: GoalState | null };
      },
    });

    persistGoal(null);
    expect(captured!.goal).toBeNull();

    const ctx = makeCtx([{ type: "custom", customType: "dgoal-plan-v1", data: captured! }]);
    expect(loadGoal(ctx as never)).toBeUndefined();
  });
});

describe("切片1 · 旧 entry 隔离", () => {
  test("dgoal-state 与 dgoal-goal-vnext 两代旧 entry 均被忽略", () => {
    const legacy = makeLegacyGoal();
    for (const customType of ["dgoal-state", "dgoal-goal-vnext"]) {
      const ctx = makeCtx([{ type: "custom", customType, data: { goal: legacy } }]);
      expect(loadGoal(ctx as never)).toBeUndefined();
    }
  });

  test("done goal 不恢复，pending goal 保留以便重载后回到启动闸门", () => {
    const completed = makeGoalWithPlan({ status: "done" });
    const pending = makeGoalWithPlan({ status: "pending", id: "p-1" });
    const ctx = makeCtx([
      { type: "custom", customType: "dgoal-plan-v1", data: { goal: completed } },
      { type: "custom", customType: "dgoal-plan-v1", data: { goal: pending } },
    ]);
    expect(loadGoal(ctx as never)?.id).toBe("p-1");
    expect(loadGoal(ctx as never)?.status).toBe("pending");
  });

  test("无关 customType 的 entry 被忽略", () => {
    const goal = makeGoalWithPlan();
    const ctx = makeCtx([
      { type: "custom", customType: "other-type", data: { goal } },
      { type: "message", message: { role: "user" } },
    ]);
    expect(loadGoal(ctx as never)).toBeUndefined();
  });
});

describe("切片1 · 三层内容数据结构", () => {
  test("Task 支持 blockedBy 依赖图（涌现分解）", () => {
    const t1: Task = { id: 1, subject: "A", status: "done" };
    const t2: Task = { id: 2, subject: "B", status: "in_progress", blockedBy: [1] };
    const t3: Task = {
      id: 3,
      subject: "B回归",
      status: "pending",
      blockedBy: [2],
      blockedReason: undefined,
    };
    const phase: Phase = {
      id: 1,
      subject: "阶段",
      status: "in_progress",
      tasks: [t1, t2, t3],
    };
    const plan: TaskPlan = { phases: [phase], nextId: 4 };
    const goal = makeGoalWithPlan({ plan });
    expect(isGoalState(goal)).toBe(true);
    expect(goal.plan!.phases[0].tasks[2].blockedBy).toEqual([2]);
  });

  test("Task blocked 带 reason，evidence 为可复验形态", () => {
    const task: Task = {
      id: 1,
      subject: "需外部权限",
      status: "blocked",
      blockedReason: "缺 prod token",
      evidence: undefined,
    };
    const phase: Phase = { id: 1, subject: "p", status: "blocked", tasks: [task] };
    const goal = makeGoalWithPlan({ plan: { phases: [phase], nextId: 2 } });
    expect(goal.plan!.phases[0].tasks[0].blockedReason).toBe("缺 prod token");
  });
});

// v0.5.2 切片1 · 建检反馈纯函数（ADR 0011）
describe("v0.5.2 · 建检反馈纯函数", () => {
  test("setPhaseFeedback 写入并覆盖最新报告", () => {
    const goal = makeGoalWithPlan();
    const g1 = setPhaseFeedback(goal, 1, "报告 v1");
    expect(g1.phaseFeedbackById!["1"].report).toBe("报告 v1");
    expect(g1.phaseFeedbackById!["1"].phaseId).toBe(1);
    // 同 phase 再次 rejected 覆盖为最新报告
    const g2 = setPhaseFeedback(g1, 1, "报告 v2");
    expect(g2.phaseFeedbackById!["1"].report).toBe("报告 v2");
    expect(Object.keys(g2.phaseFeedbackById!)).toEqual(["1"]);
  });

  test("setPhaseFeedback 不 mutate 入参 goal", () => {
    const goal = makeGoalWithPlan();
    setPhaseFeedback(goal, 1, "报告");
    expect(goal.phaseFeedbackById).toBeUndefined();
  });

  test("阶段审核拒绝时同时保存非阻塞用户复核建议", () => {
    const goal = makeGoalWithPlan();
    const next = recordPhaseAuditFeedback(goal, 1, "## 建议用户复核（不阻塞完成）\n- 在真实 TUI 检查浮层\n\n## 验收结论\n<REJECTED>");
    expect(next.phaseFeedbackById!["1"].report).toContain("<REJECTED>");
    expect(next.userReviewItems).toEqual(["人工确认 TUI 观感", "在真实 TUI 检查浮层"]);
  });

  test("clearPhaseFeedback 清除对应 phase，保留其他 phase", () => {
    const goal = makeGoalWithPlan();
    const g1 = setPhaseFeedback(goal, 1, "phase1 报告");
    const g2 = setPhaseFeedback(g1, 2, "phase2 报告");
    const g3 = clearPhaseFeedback(g2, 1);
    expect(g3.phaseFeedbackById!["1"]).toBeUndefined();
    expect(g3.phaseFeedbackById!["2"].report).toBe("phase2 报告");
  });

  test("clearPhaseFeedback 对无反馈 goal 是 no-op", () => {
    const goal = makeGoalWithPlan();
    const cleared = clearPhaseFeedback(goal, 1);
    expect(cleared).toBe(goal);
  });

  test("setFinalFeedback 记录报告与 rejectedCount", () => {
    const goal = makeGoalWithPlan();
    const g1 = setFinalFeedback(goal, "终审报告", 2);
    expect(g1.finalFeedback!.report).toBe("终审报告");
    expect(g1.finalFeedback!.rejectedCount).toBe(2);
  });

  test("终审修复账本追加每轮失败报告与完成声明", () => {
    const goal = makeGoalWithPlan();
    const first = appendFinalAuditHistory(goal, {
      attempt: 1,
      report: "缺少测试证据",
      summary: "补齐测试",
      verification: "npm test",
      whatChanged: ["补测试"],
      userReview: "人工看一次 UI",
    });
    const second = appendFinalAuditHistory({ ...goal, finalAuditHistory: first }, {
      attempt: 2,
      report: "仍缺文档证据",
      summary: "补文档",
      verification: "rg 通过",
    });
    expect(first).toHaveLength(1);
    expect(second.map((entry) => entry.attempt)).toEqual([1, 2]);
    expect(second[0].report).toBe("缺少测试证据");
    expect(second[1].verification).toBe("rg 通过");
  });

  test("currentUncheckedPhase 返回第一个未 done 的 phase", () => {
    const task: Task = { id: 1, subject: "t", status: "done" };
    const ph1: Phase = { id: 1, subject: "已完成", status: "done", tasks: [task] };
    const ph2: Phase = { id: 2, subject: "进行中", status: "in_progress", tasks: [{ id: 2, subject: "t2", status: "in_progress" }] };
    const goal = makeGoalWithPlan({ plan: { phases: [ph1, ph2], nextId: 3 } });
    const current = currentUncheckedPhase(goal);
    expect(current?.id).toBe(2);
  });

  test("currentUncheckedPhase 全 done 时返回 undefined", () => {
    const task: Task = { id: 1, subject: "t", status: "done" };
    const ph: Phase = { id: 1, subject: "已完成", status: "done", tasks: [task] };
    const goal = makeGoalWithPlan({ plan: { phases: [ph], nextId: 2 } });
    expect(currentUncheckedPhase(goal)).toBeUndefined();
  });

  test("旧 goal 缺少验收契约字段仍可 isGoalState（向后兼容）", () => {
    const legacy = makeLegacyGoal();
    expect(isGoalState(legacy)).toBe(true);
    expect(legacy.phaseFeedbackById).toBeUndefined();
    expect(legacy.finalFeedback).toBeUndefined();
    expect(legacy.acceptanceCriteria).toBeUndefined();
    expect(legacy.userReviewItems).toBeUndefined();
  });

  test("带 feedback 的 goal persist 后 load 能完整恢复 phase 和 final feedback", () => {
    __resetGoalForTest();
    let captured: { type: string; data: { goal: GoalState | null } } | undefined;
    __setApiForTest({
      appendEntry: (type, data) => {
        captured = { type, data: data as { goal: GoalState | null } };
      },
    });

    const original = setFinalFeedback(setPhaseFeedback(makeGoalWithPlan(), 1, "phase 报告"), "final 报告", 1);
    persistGoal(original);

    const ctx = makeCtx([{ type: "custom", customType: "dgoal-plan-v1", data: captured!.data }]);
    const restored = loadGoal(ctx as never);

    expect(restored).not.toBeUndefined();
    expect(restored!.acceptanceCriteria).toEqual(acceptanceCriteria);
    expect(restored!.userReviewItems).toEqual(["人工确认 TUI 观感"]);
    expect(restored!.plan!.phases[0].acceptanceCriteria).toEqual(acceptanceCriteria);
    expect(restored!.phaseFeedbackById!["1"].report).toBe("phase 报告");
    expect(restored!.phaseFeedbackById!["1"].phaseId).toBe(1);
    expect(restored!.finalFeedback!.report).toBe("final 报告");
    expect(restored!.finalFeedback!.rejectedCount).toBe(1);
  });

  test("阶段建检序列：rejected 写 feedback，approved 只清 feedback", () => {
    let goal = makeGoalWithPlan();
    goal = setPhaseFeedback(goal, 1, "phase1 未通过报告");
    expect(goal.phaseFeedbackById!["1"].report).toBe("phase1 未通过报告");

    goal = clearPhaseFeedback(goal, 1);
    expect(goal.phaseFeedbackById!["1"]).toBeUndefined();
    expect(goal.plan!.phases[0].status).toBe("in_progress");
  });
});
