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
  goalCheckTool,
  phaseCheckTool,
  phasePlanTool,
  planReadTool,
  resyncGoalFromSession,
  type GoalState,
  type Phase,
  type Task,
  type TaskPlan,
} from "../index.ts";

function task(id: number, subject: string, status: Task["status"] = "pending"): Task {
  return { id, subject, status };
}
function phase(id: number, subject: string, tasks: Task[], status: Phase["status"] = "pending"): Phase {
  return { id, subject, tasks, status };
}
function makeGoal(overrides: Partial<GoalState> = {}): GoalState {
  const plan: TaskPlan = { phases: [phase(1, "p1", [task(1, "a")])], nextId: 2 };
  return {
    id: "g1",
    objective: "测目标",
    status: "active",
    startedAt: 1,
    updatedAt: 1,
    iteration: 0,
    plan,
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
  return { type: "custom", customType: "dgoal-plan-v1", data: { goal } };
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
      plan: { phases: [phase(1, "p1", [task(1, "a", "done")], "done")], nextId: 2 },
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

    resyncGoalFromSession(makeCtx([]) as never); // 新分支无 dgoal-plan-v1 entry

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
    const pending = makeGoal({ id: "lazy-pending", status: "pending", plan: undefined });
    __setProposalSemanticReviewForTest(() => ({ decision: "approve" }));
    const proposalResult = await phasePlanTool.execute("test", {
      objective: "交付", verification: "bun test", acceptanceCriteria: [{ criterion: "通过", evidence: "bun test" }], phases: [{ subject: "实现" }],
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
      expect(widgets.some((item) => item.key === "dgoal-plan" && Array.isArray(item.value) && item.value.length > 0)).toBe(true);
    } finally {
      disposePlanOverlay();
    }
  });

  test("UI 抛错不阻断状态重同步（TUI 边界防护）", () => {
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
