// session_tree 事件重同步测试。
// 根因：/tree（navigateTree）原地切 session 分支，不发 session_start，只发 session_tree。
// pi-dgoal 此前未监听 session_tree，导致 currentGoal 停在旧分支、overlay 显示陈旧状态
// （阶段明明完成了还显示未完成，计时器也冻住）。修复：session_start / session_tree 共用 resyncGoalFromSession。
import { describe, expect, test } from "bun:test";

import dgoal, {
  __getGoalForTest,
  __resetGoalForTest,
  __setCompletionAuditorOverrideForTest,
  __setGoalForTest,
  __setPhaseCheckOverrideForTest,
  __setPlanOverlayForTest,
  __setProposalSemanticReviewForTest,
  disposePlanOverlay,
  buildBodyLines,
  goalCheckTool,
  loadGoal,
  phaseCheckTool,
  phasePlanTool,
  planReadTool,
  resyncGoalFromSession,
  sendContinuation,
  type GoalState,
  type Phase,
  type Task,
  type TaskPlan,
} from "../index.ts";

function task(id: number, subject: string, status: Task["status"] = "pending"): Task {
  return { id, subject, description: `${subject} 的任务说明。`, status };
}
function phase(id: number, subject: string, tasks: Task[], status: Phase["status"] = "pending"): Phase {
  return { id, subject, description: `${subject} 的阶段说明。`, tasks, status };
}
function makeGoal(overrides: Partial<GoalState> = {}): GoalState {
  const plan: TaskPlan = { phases: [phase(1, "p1", [task(1, "a")])], nextId: 2 };
  return {
    id: "g1",
    objective: "测目标",
    description: "验证 session 重同步。",
    planType: "phase",
    status: "active",
    startedAt: 1,
    updatedAt: 1,
    iteration: 0,
    plan,
    verification: "bun test test/session-tree-resync.test.ts",
    acceptanceCriteria: [{ criterion: "session 分支状态正确重同步", evidence: "bun test test/session-tree-resync.test.ts" }],
    ...overrides,
  };
}

function makeCtx(entries: Array<{ type?: string; customType?: string; data?: unknown }>, ui?: Partial<{ setStatus: () => void }>) {
  return {
    cwd: "/tmp",
    ui: { confirm: async () => true, notify: () => {}, setStatus: ui?.setStatus ?? (() => {}) },
    sessionManager: { getBranch: () => entries },
  };
}

function dgoalEntry(goal: GoalState) {
  return { type: "custom", customType: "dgoal-plan-v2", data: { goal } };
}

function captureHandlers() {
  const handlers: Record<string, (event: unknown, ctx: unknown) => unknown> = {};
  dgoal({
    registerTool: () => {},
    registerCommand: () => {},
    on: (event: string, handler: (event: unknown, ctx: unknown) => unknown) => { handlers[event] = handler; },
    events: { emit: () => {} },
    sendUserMessage: () => {},
    appendEntry: () => {},
  } as never);
  return handlers;
}

describe("session_tree 重同步（resyncGoalFromSession）", () => {
  test("tree 到含更新 goal 状态的分支 → currentGoal 反映新分支状态", () => {
    __resetGoalForTest();
    // tree 之前：currentGoal 是旧状态（phase 1 pending）
    const staleGoal = makeGoal();
    __setGoalForTest(staleGoal);

    // tree 之后：新分支的 goal 已推进（phase 1 done，task done）
    const newGoal = makeGoal({
      plan: { phases: [phase(1, "p1", [{ ...task(1, "a", "done"), evidence: "bun test" }], "done")], nextId: 2 },
      updatedAt: 999,
    });
    resyncGoalFromSession(makeCtx([dgoalEntry(newGoal)]) as never);

    // currentGoal 应被重新 load 成新分支的状态（不再停在 staleGoal）
    const after = __getGoalForTest();
    expect(after).not.toBe(staleGoal);
    expect(after?.updatedAt).toBe(999);
    expect(after?.plan?.phases[0].status).toBe("done");
    expect(after?.plan?.phases[0].tasks[0].status).toBe("done");
  });

  test("tree 到无 goal 的分支 → currentGoal 清空", () => {
    __resetGoalForTest();
    __setGoalForTest(makeGoal()); // tree 之前有 goal

    resyncGoalFromSession(makeCtx([]) as never); // 新分支无 dgoal-plan-v2 entry

    expect(__getGoalForTest()).toBeUndefined();
  });

  test("pending goal 在 reload/tree 重同步后保留并回到启动闸门", () => {
    __resetGoalForTest();
    const pending = makeGoal({ id: "pending-after-reload", status: "pending" });
    resyncGoalFromSession(makeCtx([dgoalEntry(pending)]) as never);
    expect(__getGoalForTest()?.id).toBe("pending-after-reload");
    expect(__getGoalForTest()?.status).toBe("pending");
  });

  test("session_compact 复用恢复入口加载持久化 goal", () => {
    __resetGoalForTest();
    const compactedGoal = makeGoal({ id: "compact-goal", status: "active" });
    const handlers = captureHandlers();
    __setGoalForTest(undefined);
    handlers.session_compact({}, makeCtx([dgoalEntry(compactedGoal)]) as never);
    expect(__getGoalForTest()?.id).toBe("compact-goal");
    expect(__getGoalForTest()?.status).toBe("active");
  });

  test("内存 Plan 为空时 public read/check tools 从 session 惰性恢复", async () => {
    __resetGoalForTest();
    const active = makeGoal({ id: "lazy-active", plan: { phases: [phase(1, "p1", [task(1, "a", "pending")])], nextId: 2 } });
    const context = makeCtx([dgoalEntry(active)]) as never;
    const planResult = await planReadTool.execute("test", { target: "plan" }, undefined, undefined, context);
    expect(planResult.details?.error).toBeUndefined();
    expect(__getGoalForTest()?.id).toBe("lazy-active");

    __setGoalForTest(undefined);
    const pending = makeGoal({ id: "lazy-pending", status: "pending", planType: undefined, plan: undefined, verification: undefined, acceptanceCriteria: undefined });
    __setProposalSemanticReviewForTest(() => ({ decision: "approve" }));
    const proposalResult = await phasePlanTool.execute("test", {
      objective: "交付", description: "完成交付并保持既定边界。", verification: "bun test", acceptanceCriteria: [{ criterion: "通过", evidence: "bun test" }], phases: [{ subject: "实现", description: "实现交付结果。" }],
    }, undefined, undefined, makeCtx([dgoalEntry(pending)]) as never);
    expect(proposalResult.details?.planType).toBe("phase");
    expect(__getGoalForTest()?.id).toBe("lazy-pending");

    __setGoalForTest(undefined);
    const checkGoal = makeGoal({ id: "lazy-check", planType: "goal", plan: { revision: 0, phases: [{ ...phase(1, "p1", [{ ...task(1, "a", "done"), evidence: "bun test" }], "in_progress"), acceptanceCriteria: [{ criterion: "ok", evidence: "bun test" }] }], nextId: 2 } });
    __setPhaseCheckOverrideForTest(async () => ({ approved: true, aborted: false, output: "<APPROVED>", liveness: "approved" }));
    const checkResult = await phaseCheckTool.execute("test", { phaseId: 1 }, undefined, undefined, makeCtx([dgoalEntry(checkGoal)]) as never);
    expect(checkResult.details?.approved).toBe(true);
    expect(__getGoalForTest()?.id).toBe("lazy-check");

    __setGoalForTest(undefined);
    const goalToCheck = makeGoal({
      id: "lazy-goal-check",
      planType: "phase",
      verification: "通过测试",
      acceptanceCriteria: [{ criterion: "测试通过", evidence: "npm test" }],
      plan: { revision: 0, phases: [phase(1, "p1", [{ ...task(1, "a", "done"), evidence: "npm test" }], "done")], nextId: 2 },
    });
    __setCompletionAuditorOverrideForTest(async () => ({ approved: true, aborted: false, output: "<APPROVED>", liveness: "approved" }));
    const goalResult = await goalCheckTool.execute("test", { summary: "完成", verification: "npm test" }, undefined, undefined, makeCtx([dgoalEntry(goalToCheck)]) as never);
    expect(goalResult.details?.approved).toBe(true);
    __setPhaseCheckOverrideForTest(undefined);
    __setCompletionAuditorOverrideForTest(undefined);
    __setProposalSemanticReviewForTest(undefined);
  });

  test("stale session context 不清空现有 goal，其他读取错误继续抛出", () => {
    __resetGoalForTest();
    const current = makeGoal({ id: "keep-on-stale" });
    __setGoalForTest(current);
    const staleCtx = { ...makeCtx([]), sessionManager: { getBranch: () => { throw new Error("stale after session replacement"); } } };
    expect(() => resyncGoalFromSession(staleCtx as never)).not.toThrow();
    expect(__getGoalForTest()?.id).toBe("keep-on-stale");

    const brokenCtx = { ...makeCtx([]), sessionManager: { getBranch: () => { throw new Error("permission denied"); } } };
    expect(() => resyncGoalFromSession(brokenCtx as never)).toThrow("permission denied");
    expect(__getGoalForTest()?.id).toBe("keep-on-stale");
  });

  test("tree 到 done 状态 goal 的分支 → 不恢复（loadGoal 沿用既有行为）", () => {
    __resetGoalForTest();
    __setGoalForTest(makeGoal());

    const doneGoal = makeGoal({ status: "done" });
    resyncGoalFromSession(makeCtx([dgoalEntry(doneGoal)]) as never);

    // done/pending 状态 loadGoal 不返回 → currentGoal 清空
    expect(__getGoalForTest()).toBeUndefined();
  });

  test("reload/tree 无 hasUI/mode 标记时仍按 setWidget 能力恢复持续浮层", () => {
    __resetGoalForTest();
    __setPlanOverlayForTest(undefined);
    const newGoal = makeGoal({ updatedAt: 777 });
    const widgets: Array<{ key: string; value: unknown }> = [];
    const ctx = {
      ...makeCtx([dgoalEntry(newGoal)]),
      ui: {
        confirm: async () => true, notify: () => {}, setStatus: () => {},
        setWidget: (key: string, value: unknown) => widgets.push({ key, value }),
        getToolsExpanded: () => false,
        onTerminalInput: () => () => {},
      },
    };
    try {
      resyncGoalFromSession(ctx as never);
      const widget = widgets.find((item) => item.key === "dgoal-plan")?.value;
      expect(typeof widget).toBe("function");
      const factory = widget as (tui: unknown, theme: unknown) => { render(width: number): string[] };
      expect(factory({}, {}).render(80).length).toBeGreaterThan(0);
    } finally {
      disposePlanOverlay();
    }
  });

  test("resync 后丢弃同 goal ID/revision 的旧 goal_check 结果", async () => {
    __resetGoalForTest();
    let resolveAudit!: (result: { approved: boolean; aborted: boolean; output: string; liveness: "approved" }) => void;
    const oldGoal = makeGoal({
      planType: "phase", verification: "bun test", acceptanceCriteria: [{ criterion: "通过", evidence: "bun test" }],
      plan: { revision: 0, phases: [phase(1, "p1", [{ ...task(1, "a", "done"), evidence: "bun test" }], "done")], nextId: 2 },
    });
    __setGoalForTest(oldGoal);
    __setCompletionAuditorOverrideForTest(() => new Promise((resolve) => { resolveAudit = resolve; }));
    const pending = goalCheckTool.execute("test", { summary: "完成", verification: "bun test" }, undefined, undefined, makeCtx([dgoalEntry(oldGoal)]) as never);
    const newBranchGoal = { ...oldGoal, updatedAt: 2, plan: { ...oldGoal.plan!, phases: oldGoal.plan!.phases.map((item) => ({ ...item, subject: "新分支 goal" })) } };
    resyncGoalFromSession(makeCtx([dgoalEntry(newBranchGoal)]) as never);
    resolveAudit({ approved: true, aborted: false, output: "<APPROVED>", liveness: "approved" });
    const result = await pending;
    expect(result.details?.stale).toBe(true);
    expect(__getGoalForTest()?.goalCheck).toBeUndefined();
    __setCompletionAuditorOverrideForTest(undefined);
  });

  test("resync 后丢弃同 goal ID/revision 的旧 phase_check 结果", async () => {
    __resetGoalForTest();
    let resolveAudit!: (result: { approved: boolean; aborted: boolean; output: string; liveness: "approved" }) => void;
    const oldGoal = makeGoal({
      planType: "goal",
      plan: { revision: 0, phases: [{ ...phase(1, "p1", [{ ...task(1, "a", "done"), evidence: "bun test" }], "in_progress"), acceptanceCriteria: [{ criterion: "通过", evidence: "bun test" }] }], nextId: 2 },
    });
    __setGoalForTest(oldGoal);
    __setPhaseCheckOverrideForTest(() => new Promise((resolve) => { resolveAudit = resolve; }));
    const pending = phaseCheckTool.execute("test", { phaseId: 1 }, undefined, undefined, makeCtx([dgoalEntry(oldGoal)]) as never);
    const newBranchGoal = { ...oldGoal, updatedAt: 2, plan: { ...oldGoal.plan!, phases: oldGoal.plan!.phases.map((item) => ({ ...item, subject: "新分支 phase" })) } };
    resyncGoalFromSession(makeCtx([dgoalEntry(newBranchGoal)]) as never);
    resolveAudit({ approved: true, aborted: false, output: "<APPROVED>", liveness: "approved" });
    const result = await pending;
    expect(result.details?.stale).toBe(true);
    expect(__getGoalForTest()?.plan?.phases[0].subject).toBe("新分支 phase");
    expect(__getGoalForTest()?.plan?.phases[0].check).toBeUndefined();
    __setPhaseCheckOverrideForTest(undefined);
  });

  test("resync 取消已发送但尚未派发的旧 continuation", async () => {
    __resetGoalForTest();
    const oldGoal = makeGoal();
    __setGoalForTest(oldGoal);
    const handlers = captureHandlers();
    let resolveSend!: () => void;
    let prompt = "";
    const pi = { sendUserMessage: (value: string) => { prompt = value; return new Promise<void>((resolve) => { resolveSend = resolve; }); } } as never;
    const context = { ...makeCtx([dgoalEntry(oldGoal)]), isIdle: () => true } as never;
    const pending = sendContinuation(pi, context, oldGoal);
    await Promise.resolve();
    resyncGoalFromSession(makeCtx([dgoalEntry(makeGoal({ updatedAt: 2 }))]) as never);
    expect(handlers.input({ source: "extension", text: prompt }, context)).toEqual({ action: "handled" });
    resolveSend();
    await pending;
  });

  test("v2 拒绝缺 tasks 的旧 phase，不再规范化兼容", () => {
    __resetGoalForTest();
    const legacy = makeGoal({ plan: { phases: [{ id: 1, subject: "legacy", description: "legacy desc", status: "in_progress" } as never], nextId: 2 } });
    const context = makeCtx([dgoalEntry(legacy)]);
    expect(loadGoal(context as never)).toBeUndefined();
    expect(() => resyncGoalFromSession(context as never)).not.toThrow();
    expect(__getGoalForTest()).toBeUndefined();
    expect(() => buildBodyLines(__getGoalForTest())).not.toThrow();
  });

  test("v2 拒绝仍带 activeForm 的旧 task", () => {
    __resetGoalForTest();
    const legacy = makeGoal({ plan: { phases: [phase(1, "legacy", [{ ...task(1, "旧任务"), activeForm: "旧进行时" } as never], "in_progress")], nextId: 2 } });
    const context = makeCtx([dgoalEntry(legacy)]);
    expect(loadGoal(context as never)).toBeUndefined();
    resyncGoalFromSession(context as never);
    expect(__getGoalForTest()).toBeUndefined();
  });

  test("UI 抛错不阻断状态重同步（TUI边界防护）", () => {
    __resetGoalForTest();
    const newGoal = makeGoal({ updatedAt: 555 });
    // setStatus 抛错模拟 TUI 渲染崩溃（如 Spacer is not defined）
    const ctx = {
      cwd: "/tmp",
      ui: { confirm: async () => true, notify: () => {}, setStatus: () => { throw new Error("TUI boom"); } },
      sessionManager: { getBranch: () => [dgoalEntry(newGoal)] },
    };
    // 不应抛出——currentGoal 已在 setStatus 之前 load 完
    expect(() => resyncGoalFromSession(ctx as never)).not.toThrow();
    expect(__getGoalForTest()?.updatedAt).toBe(555);
  });
});
