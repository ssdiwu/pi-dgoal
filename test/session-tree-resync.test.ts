// session_tree 事件重同步：分支切换必须恢复同一 Work List，并隔离迟到审核与旧 continuation。
import { describe, expect, test } from "bun:test";

import dgoal, {
  __getGoalForTest,
  __getPendingProposalForTest,
  __resetGoalForTest,
  __setCompletionAuditorOverrideForTest,
  __setGoalForTest,
  __setPhaseCheckOverrideForTest,
  __setPlanOverlayForTest,
  buildBodyLines,
  disposePlanOverlay,
  goalCheckTool,
  loadGoal,
  phaseCheckTool,
  resyncGoalFromSession,
  sendContinuation,
  workReadTool,
  type GoalState,
  type WorkItem,
  type WorkPhase,
} from "../index.ts";

function item(id: number, subject: string, status: WorkItem["status"] = "pending"): WorkItem {
  return { id, subject, description: `${subject} 的工作说明。`, status, ...(status === "done" ? { evidence: "bun test" } : {}) };
}

function phase(id: number, subject: string, items: WorkItem[], status: WorkPhase["status"] = "in_progress"): WorkPhase {
  return {
    id, subject, description: `${subject} 的阶段说明。`, status, revision: 0, items,
    acceptanceCriteria: [{ criterion: `${subject} 可测试`, evidence: "bun test" }],
  };
}

function makeGoal(overrides: Partial<GoalState> = {}): GoalState {
  return {
    id: "g1",
    objective: "测目标",
    description: "验证 session 重同步。",
    status: "active",
    startedAt: 1,
    updatedAt: 1,
    iteration: 0,
    workList: { items: [], phases: [phase(1, "p1", [item(1, "a")])], nextItemId: 2, nextPhaseId: 2, revision: 0 },
    contract: {
      id: "run-g1", profile: "staged_check", startedAt: 1, revision: 0,
      transitions: [{ to: "staged_check", at: 1, revision: 0 }],
      verification: "bun test test/session-tree-resync.test.ts",
      acceptanceCriteria: [{ criterion: "session 分支状态正确重同步", evidence: "bun test test/session-tree-resync.test.ts" }],
    },
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

function dgoalEntry(goal: GoalState | null) {
  return { type: "custom", customType: "dgoal-work-v1", data: { goal } };
}

function captureHandlers(withPrompts = false) {
  const handlers: Record<string, (event: any, ctx: any) => any> = {};
  const prompts: string[] = [];
  dgoal({
    registerTool: () => {}, registerCommand: () => {},
    on: (event: string, handler: (event: unknown, ctx: unknown) => unknown) => { handlers[event] = handler; },
    events: { emit: () => {} },
    sendUserMessage: (prompt: string) => { if (withPrompts) prompts.push(prompt); },
    appendEntry: () => {},
  } as never);
  return { handlers, prompts };
}

describe("session_tree resynchronizes the current Work List", () => {
  test("switching to an updated branch replaces stale in-memory state", () => {
    __resetGoalForTest();
    const stale = makeGoal();
    __setGoalForTest(stale);
    const updated = makeGoal({
      updatedAt: 999,
      workList: { items: [], phases: [phase(1, "p1", [item(1, "a", "done")])], nextItemId: 2, nextPhaseId: 2, revision: 2 },
      contract: { ...stale.contract!, revision: 2 },
    });
    resyncGoalFromSession(makeCtx([dgoalEntry(updated)]) as never);
    expect(__getGoalForTest()).not.toBe(stale);
    expect(__getGoalForTest()?.updatedAt).toBe(999);
    expect(__getGoalForTest()?.workList?.phases[0].status).toBe("in_progress");
    expect(__getGoalForTest()?.workList?.phases[0].items[0].status).toBe("done");
  });

  test("an empty branch clears state while a pending Goal is restored", () => {
    __resetGoalForTest();
    __setGoalForTest(makeGoal());
    resyncGoalFromSession(makeCtx([]) as never);
    expect(__getGoalForTest()).toBeUndefined();
    const pending = makeGoal({ id: "pending-after-reload", status: "pending", workList: undefined, contract: undefined });
    resyncGoalFromSession(makeCtx([dgoalEntry(pending)]) as never);
    expect(__getGoalForTest()).toMatchObject({ id: "pending-after-reload", status: "pending" });
  });

  test("session_compact preserves deliverables and resumes an active Execution Plan once", async () => {
    __resetGoalForTest();
    const execution = makeGoal({
      id: "compact-execution",
      workList: {
        items: [{ ...item(1, "同步文档"), deliverables: [{ target: "README.md", description: "同步真实行为" }] }],
        phases: [], nextItemId: 2, nextPhaseId: 1, revision: 0,
      },
      contract: {
        id: "run-execution", profile: "execution", startedAt: 1, revision: 0,
        transitions: [{ to: "execution", at: 1, revision: 0 }],
      },
    });
    const { handlers, prompts } = captureHandlers(true);
    await handlers.session_compact({ willRetry: false }, { ...makeCtx([dgoalEntry(execution)]), isIdle: () => true } as never);
    expect(__getGoalForTest()?.workList?.items[0].deliverables).toEqual([{ target: "README.md", description: "同步真实行为" }]);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("Execution Plan");
    expect(prompts[0]).toContain("pi-dgoal-continuation:compact-execution");

    prompts.length = 0;
    await handlers.session_compact({ willRetry: true }, { ...makeCtx([dgoalEntry(execution)]), isIdle: () => true } as never);
    expect(prompts).toHaveLength(0);
  });

  test("public read and check tools lazily restore from the session branch", async () => {
    __resetGoalForTest();
    const active = makeGoal({ id: "lazy-active" });
    const read = await workReadTool.execute("test", { target: "list", id: null }, undefined, undefined, makeCtx([dgoalEntry(active)]) as never);
    expect(read.details?.error).toBeUndefined();
    expect(__getGoalForTest()?.id).toBe("lazy-active");

    __setGoalForTest(undefined);
    const checkedPhase = phase(1, "p1", [item(1, "a", "done")]);
    const phaseGoal = makeGoal({ id: "lazy-phase", workList: { items: [], phases: [checkedPhase], nextItemId: 2, nextPhaseId: 2, revision: 0 } });
    __setPhaseCheckOverrideForTest(async () => ({ approved: true, aborted: false, output: "<APPROVED>", liveness: "approved" }));
    const phaseResult = await phaseCheckTool.execute("test", { phaseId: 1 }, undefined, undefined, makeCtx([dgoalEntry(phaseGoal)]) as never);
    expect(phaseResult.details?.approved).toBe(true);
    expect(__getGoalForTest()?.id).toBe("lazy-phase");

    __setGoalForTest(undefined);
    const rootDone = makeGoal({
      id: "lazy-goal",
      workList: { items: [item(1, "done", "done")], phases: [], nextItemId: 2, nextPhaseId: 1, revision: 0 },
      contract: {
        id: "run-goal", profile: "goal_check", startedAt: 1, revision: 0,
        transitions: [{ to: "goal_check", at: 1, revision: 0 }], verification: "bun test",
        acceptanceCriteria: [{ criterion: "通过", evidence: "bun test" }],
      },
    });
    __setCompletionAuditorOverrideForTest(async () => ({ approved: true, aborted: false, output: "<APPROVED>", liveness: "approved" }));
    const goalResult = await goalCheckTool.execute("test", { summary: "完成", verification: "bun test" }, undefined, undefined, makeCtx([dgoalEntry(rootDone)]) as never);
    expect(goalResult.details?.approved).toBe(true);
    __setPhaseCheckOverrideForTest(undefined);
    __setCompletionAuditorOverrideForTest(undefined);
  });

  test("stale session errors preserve state while unrelated read failures remain visible", () => {
    __resetGoalForTest();
    __setGoalForTest(makeGoal({ id: "keep-on-stale" }));
    const staleCtx = { ...makeCtx([]), sessionManager: { getBranch: () => { throw new Error("stale after session replacement"); } } };
    expect(() => resyncGoalFromSession(staleCtx as never)).not.toThrow();
    expect(__getGoalForTest()?.id).toBe("keep-on-stale");
    const brokenCtx = { ...makeCtx([]), sessionManager: { getBranch: () => { throw new Error("permission denied"); } } };
    expect(() => resyncGoalFromSession(brokenCtx as never)).toThrow("permission denied");
    expect(__getGoalForTest()?.id).toBe("keep-on-stale");
  });

  test("done Goals and the removed persistence key are not restored", () => {
    __resetGoalForTest();
    __setGoalForTest(makeGoal());
    resyncGoalFromSession(makeCtx([dgoalEntry(makeGoal({ status: "done" }))]) as never);
    expect(__getGoalForTest()).toBeUndefined();
    const removedKeyEntry = { type: "custom", customType: "dgoal-plan-v2", data: { goal: makeGoal() } };
    expect(loadGoal(makeCtx([removedKeyEntry]) as never)).toBeUndefined();
    expect(() => buildBodyLines(__getGoalForTest())).not.toThrow();
  });

  test("damaged Work List scalars and malformed check records fail closed during restore", () => {
    const malformedSubject = {
      ...makeGoal(),
      workList: {
        items: [],
        phases: [{ id: 1, subject: 7, description: "坏数据", status: "pending", revision: 0, items: [] }],
        nextItemId: 1, nextPhaseId: 2, revision: 0,
      },
    } as unknown as GoalState;
    expect(() => loadGoal(makeCtx([dgoalEntry(malformedSubject)]) as never)).not.toThrow();
    expect(loadGoal(makeCtx([dgoalEntry(malformedSubject)]) as never)).toBeUndefined();

    const malformedCheck = makeGoal({
      workList: {
        items: [],
        phases: [{
          ...phase(1, "p1", [item(1, "a", "done")], "done"),
          check: { status: "approved", revision: 0, checkedAt: "not-a-number" },
        } as unknown as WorkPhase],
        nextItemId: 2, nextPhaseId: 2, revision: 0,
      },
    });
    expect(loadGoal(makeCtx([dgoalEntry(malformedCheck)]) as never)).toBeUndefined();
  });

  test("persisted pending proposal cannot downgrade an active Goal Check or replace its frozen contract", () => {
    __resetGoalForTest();
    const active = makeGoal({
      id: "active-goal-check",
      objective: "保持冻结目标",
      description: "恢复时不能接受伪造同档 proposal。",
      workList: { items: [item(1, "done", "done")], phases: [], nextItemId: 2, nextPhaseId: 1, revision: 0 },
      contract: {
        id: "run-active-goal-check", profile: "goal_check", startedAt: 1, revision: 0,
        transitions: [{ to: "goal_check", at: 1, revision: 0 }], verification: "bun test",
        acceptanceCriteria: [{ criterion: "原冻结条件", evidence: "bun test" }],
      },
    });
    const tamperedPending = {
      goalId: active.id,
      proposal: {
        objective: "篡改目标",
        description: "篡改说明",
        assuranceProfile: "goal_check",
        workList: structuredClone(active.workList),
        verification: "bun test",
        acceptanceCriteria: [{ criterion: "篡改条件", evidence: "bun test" }],
        phases: [],
      },
    };
    const entry = { type: "custom", customType: "dgoal-work-v1", data: { goal: active, pendingProposal: tamperedPending } };
    resyncGoalFromSession(makeCtx([entry]) as never);
    expect(__getGoalForTest()?.objective).toBe("保持冻结目标");
    expect(__getGoalForTest()?.contract?.acceptanceCriteria?.[0].criterion).toBe("原冻结条件");
    expect(__getPendingProposalForTest()).toBeUndefined();
  });

  test("resync restores the overlay by capability and UI failures stay fail-soft", () => {
    __resetGoalForTest();
    __setPlanOverlayForTest(undefined);
    const restored = makeGoal({ updatedAt: 777 });
    const widgets: Array<{ key: string; value: unknown }> = [];
    const ctx = {
      ...makeCtx([dgoalEntry(restored)]),
      ui: {
        confirm: async () => true, notify: () => {}, setStatus: () => {},
        setWidget: (key: string, value: unknown) => widgets.push({ key, value }),
        getToolsExpanded: () => false, onTerminalInput: () => () => {},
      },
    };
    try {
      resyncGoalFromSession(ctx as never);
      const widget = widgets.find((entry) => entry.key === "dgoal-plan")?.value;
      expect(typeof widget).toBe("function");
      expect((widget as (tui: unknown, theme: unknown) => { render(width: number): string[] })({}, {}).render(80).length).toBeGreaterThan(0);
      const brokenUi = { ...makeCtx([dgoalEntry(makeGoal({ updatedAt: 888 }))]), ui: { setStatus: () => { throw new Error("TUI boom"); } } };
      expect(() => resyncGoalFromSession(brokenUi as never)).not.toThrow();
      expect(__getGoalForTest()?.updatedAt).toBe(888);
    } finally {
      disposePlanOverlay();
    }
  });

  test("resync discards a late goal_check result even for the same Goal and revision", async () => {
    __resetGoalForTest();
    let resolveAudit!: (result: { approved: boolean; aborted: boolean; output: string; liveness: "approved" }) => void;
    const base = makeGoal();
    const oldGoal = makeGoal({
      workList: { items: [item(1, "old", "done")], phases: [], nextItemId: 2, nextPhaseId: 1, revision: 0 },
      contract: {
        id: "run-goal-late", profile: "goal_check", startedAt: 1, revision: 0,
        transitions: [{ to: "goal_check", at: 1, revision: 0 }], verification: "bun test",
        acceptanceCriteria: base.contract!.acceptanceCriteria,
      },
    });
    __setGoalForTest(oldGoal);
    __setCompletionAuditorOverrideForTest(() => new Promise((resolve) => { resolveAudit = resolve; }));
    const pending = goalCheckTool.execute("test", { summary: "完成", verification: "bun test" }, undefined, undefined, makeCtx([dgoalEntry(oldGoal)]) as never);
    const newBranch = { ...oldGoal, updatedAt: 2, workList: { ...oldGoal.workList!, items: [item(1, "new", "done")] } };
    resyncGoalFromSession(makeCtx([dgoalEntry(newBranch)]) as never);
    resolveAudit({ approved: true, aborted: false, output: "<APPROVED>", liveness: "approved" });
    const result = await pending;
    expect(result.details?.stale).toBe(true);
    expect(__getGoalForTest()?.contract?.goalCheck).toBeUndefined();
    __setCompletionAuditorOverrideForTest(undefined);
  });

  test("resync discards a late phase_check result and keeps the new branch", async () => {
    __resetGoalForTest();
    let resolveAudit!: (result: { approved: boolean; aborted: boolean; output: string; liveness: "approved" }) => void;
    const oldGoal = makeGoal({ workList: { items: [], phases: [phase(1, "old phase", [item(1, "a", "done")])], nextItemId: 2, nextPhaseId: 2, revision: 0 } });
    __setGoalForTest(oldGoal);
    __setPhaseCheckOverrideForTest(() => new Promise((resolve) => { resolveAudit = resolve; }));
    const pending = phaseCheckTool.execute("test", { phaseId: 1 }, undefined, undefined, makeCtx([dgoalEntry(oldGoal)]) as never);
    const newBranch = { ...oldGoal, updatedAt: 2, workList: { ...oldGoal.workList!, phases: [phase(1, "new phase", [item(1, "a", "done")])] } };
    resyncGoalFromSession(makeCtx([dgoalEntry(newBranch)]) as never);
    resolveAudit({ approved: true, aborted: false, output: "<APPROVED>", liveness: "approved" });
    const result = await pending;
    expect(result.details?.stale).toBe(true);
    expect(__getGoalForTest()?.workList?.phases[0].subject).toBe("new phase");
    expect(__getGoalForTest()?.workList?.phases[0].check).toBeUndefined();
    __setPhaseCheckOverrideForTest(undefined);
  });

  test("resync cancels a continuation that was sent but not yet dispatched", async () => {
    __resetGoalForTest();
    const execution = makeGoal({
      contract: { id: "run-exec", profile: "execution", startedAt: 1, revision: 0, transitions: [{ to: "execution", at: 1, revision: 0 }] },
    });
    __setGoalForTest(execution);
    const { handlers } = captureHandlers();
    let resolveSend!: () => void;
    let prompt = "";
    const pi = { sendUserMessage: (value: string) => { prompt = value; return new Promise<void>((resolve) => { resolveSend = resolve; }); } } as never;
    const context = { ...makeCtx([dgoalEntry(execution)]), isIdle: () => true } as never;
    const pending = sendContinuation(pi, context, execution);
    await Promise.resolve();
    resyncGoalFromSession(makeCtx([dgoalEntry({ ...execution, updatedAt: 2 })]) as never);
    expect(handlers.input({ source: "extension", text: prompt }, context)).toEqual({ action: "handled" });
    resolveSend();
    await pending;
  });
});
