import { beforeEach, describe, expect, test } from "bun:test";
import dgoal, {
  __getGoalForTest,
  __getRuntimeStateForTest,
  __handleStartupGateForTest,
  __resetGoalForTest,
  __setApiForTest,
  __setCheckSnapshotForTest,
  __setCompletionAuditorOverrideForTest,
  __setGoalForTest,
  __setPhaseCheckOverrideForTest,
  __setProposalSemanticReviewForTest,
  goalCheckTool,
  phasePlanTool,
  phaseCheckTool,
  planCreateTool,
  planReadTool,
  planUpdateTool,
  renderPlanLines,
  taskPlanTool,
} from "../index.ts";
import { authorizeNaturalLanguageStart } from "../src/goal-runtime/state.ts";

const ctx = {
  cwd: process.cwd(),
  ui: {
    setStatus: () => {},
    setWidget: () => {},
    notify: () => {},
    getToolsExpanded: () => false,
    onTerminalInput: () => () => {},
  },
  sessionManager: { getBranch: () => [] },
  isIdle: () => true,
} as never;

async function execute(tool: { execute: Function }, params: Record<string, unknown>) {
  return tool.execute("call", params, undefined, undefined, ctx);
}

beforeEach(() => {
  __resetGoalForTest();
  __setApiForTest({ appendEntry: () => {} });
  __setPhaseCheckOverrideForTest(undefined);
  __setCompletionAuditorOverrideForTest(undefined);
  __setProposalSemanticReviewForTest(undefined);
});

describe("Three-Plan public tool surface", () => {
  test("registers exactly the eight two-word tools", () => {
    const names: string[] = [];
    dgoal({
      registerTool: (tool: { name: string }) => names.push(tool.name),
      registerCommand: () => {},
      on: () => {},
      events: { emit: () => {} },
      appendEntry: () => {},
    } as never);
    expect(names).toEqual([
      "task_plan", "phase_plan", "goal_plan",
      "plan_create", "plan_read", "plan_update",
      "phase_check", "goal_check",
    ]);
    expect(names.every((name) => name.split("_").length === 2)).toBe(true);
  });

  test("an explicit natural-language /dgoal request cannot silently downgrade to Task Plan", async () => {
    authorizeNaturalLanguageStart("请使用 dgoal 完成");
    const result = await execute(taskPlanTool, { objective: "交付", tasks: [{ subject: "实现" }] });
    expect(result.details.error).toBe("explicit dgoal requested");
    expect(__getGoalForTest()).toBeUndefined();
  });

  test("Task Plan is direct, task-first, replaceable, and closes without audit", async () => {
    const started = await execute(taskPlanTool, {
      objective: "修复键盘",
      tasks: [{ subject: "定位" }, { subject: "修复", blockedBy: [1] }, { subject: "验证", blockedBy: [2] }],
    });
    expect(started.details).toMatchObject({ planType: "task", revision: 0 });
    expect(__getGoalForTest()?.planType).toBe("task");
    expect(__getGoalForTest()?.plan?.phases).toHaveLength(1);

    let lines = renderPlanLines(__getGoalForTest(), { hiddenPhaseIds: new Set(), expandTasks: false });
    expect(lines[0]).toContain("0/3 tasks");
    expect(lines.some((line) => line.includes("定位"))).toBe(true);
    expect(lines.some((line) => line.includes("修复键盘 · 0/3 tasks"))).toBe(true);

    // task ids start at 2; dependency #1 resolves to task id 2, so the first task is #2.
    await execute(planUpdateTool, { target: "task", id: 2, status: "in_progress" });
    expect(__getGoalForTest()?.plan?.phases[0].tasks[0].status).toBe("in_progress");
    await execute(planUpdateTool, { target: "task", id: 2, status: "done", evidence: "located" });
    expect(__getGoalForTest()?.plan?.phases[0].tasks[0].status).toBe("done");
    await execute(planUpdateTool, { target: "task", id: 3, status: "in_progress" });
    await execute(planUpdateTool, { target: "task", id: 3, status: "done", evidence: "fixed" });
    await execute(planUpdateTool, { target: "task", id: 4, status: "in_progress" });
    await execute(planUpdateTool, { target: "task", id: 4, status: "done", evidence: "tests pass" });
    lines = renderPlanLines(__getGoalForTest(), { hiddenPhaseIds: new Set(), expandTasks: false });
    expect(lines[0]).toContain("3/3 tasks");
    __setGoalForTest({ ...__getGoalForTest()!, iteration: 5, pausedTotalMs: 1_000, contextSummary: "旧任务背景" });

    const replaced = await execute(taskPlanTool, { objective: "改为修文档", tasks: [{ subject: "更新 README" }] });
    expect(replaced.details.revision).toBeGreaterThan(0);
    expect(__getGoalForTest()?.objective).toBe("改为修文档");
    expect(__getGoalForTest()?.plan?.phases[0].tasks).toHaveLength(1);
    expect(__getGoalForTest()).toMatchObject({ iteration: 0, pausedTotalMs: 0 });
    expect(__getGoalForTest()?.contextSummary).toBeUndefined();
    expect(renderPlanLines(__getGoalForTest(), { hiddenPhaseIds: new Set(), expandTasks: false })[0]).toContain("0/1 tasks");
    await execute(planUpdateTool, { target: "task", id: 2, status: "in_progress" });
    await execute(planUpdateTool, { target: "task", id: 2, status: "done", evidence: "README updated" });
    const finished = await execute(planUpdateTool, { target: "goal", status: "done", summary: "更新文档", verification: "README 可读" });
    expect(finished.details.completed).toBe(true);
    expect(__getGoalForTest()).toBeUndefined();
  });

  test("Phase Plan uses explicit proposal confirmation and persists no legacy policy/budget fields", async () => {
    __setGoalForTest({ id: "pending", objective: "交付", status: "pending", startedAt: 1, updatedAt: 1, iteration: 0 } as never);
    __setProposalSemanticReviewForTest(() => ({ decision: "approve" }));
    const submitted = await execute(phasePlanTool, {
      objective: "交付",
      verification: "bun test",
      acceptanceCriteria: [{ criterion: "测试通过", evidence: "bun test" }],
      phases: [{ subject: "实现", tasks: [{ subject: "编码" }] }],
    });
    expect(submitted.details.planType).toBe("phase");
    const pending = __getGoalForTest()!;
    await __handleStartupGateForTest(
      { sendUserMessage: async () => {} } as never,
      {
        ...ctx,
        ui: { ...(ctx as any).ui, select: async (_title: string, options: string[]) => options[0] },
      } as never,
      pending,
    );
    const active = __getGoalForTest() as any;
    expect(active.planType).toBe("phase");
    expect(active.status).toBe("active");
    for (const field of ["verificationPolicy", "budgetPolicy", "runtimeBudget", "budgetUsage", "implicitStart"]) {
      expect(active[field]).toBeUndefined();
    }
  });

  test("audited Plan entry rejects missing or cyclic local task dependencies before semantic review", async () => {
    __setGoalForTest({ id: "pending-graph", objective: "交付", status: "pending", startedAt: 1, updatedAt: 1, iteration: 0 } as never);
    let semanticReviewCalled = false;
    __setProposalSemanticReviewForTest(() => {
      semanticReviewCalled = true;
      return { decision: "approve" };
    });
    const common = {
      objective: "交付",
      verification: "bun test",
      acceptanceCriteria: [{ criterion: "测试通过", evidence: "bun test" }],
    };
    const missing = await execute(phasePlanTool, { ...common, phases: [{ subject: "实现", tasks: [{ subject: "A", blockedBy: [2] }] }] });
    expect(missing.details.error).toBe("invalid task graph");
    const cyclic = await execute(phasePlanTool, { ...common, phases: [{ subject: "实现", tasks: [{ subject: "A", blockedBy: [2] }, { subject: "B", blockedBy: [1] }] }] });
    expect(cyclic.details.error).toBe("invalid task graph");
    expect(semanticReviewCalled).toBe(false);
  });

  test("plan_update owns bounded agent-blocked pause state", async () => {
    await execute(taskPlanTool, { objective: "等待决策", tasks: [{ subject: "确认兼容策略" }] });
    expect((await execute(planUpdateTool, { target: "goal", status: "paused", reason: "" })).details.error).toBe("missing pause reason");
    expect((await execute(planUpdateTool, { target: "goal", status: "paused", reason: "x".repeat(1_001) })).details.error).toBe("pause reason too long");
    const paused = await execute(planUpdateTool, { target: "goal", status: "paused", reason: "需要用户选择兼容还是破坏性升级" });
    expect(paused.details.status).toBe("paused");
    expect(__getGoalForTest()?.status).toBe("paused");
    expect(__getGoalForTest()?.pauseReason).toBe("agent_blocked");
  });

  test("plan_create only adds task and Task Plan never exposes its structural phase", async () => {
    await execute(taskPlanTool, { objective: "任务", tasks: [{ subject: "A" }] });
    const created = await execute(planCreateTool, { target: "task", subject: "B" });
    expect(created.details.target).toBe("task");
    expect(created.details.phaseId).toBeUndefined();
    expect(created.content[0].text).not.toContain("phase");
    const read = await execute(planReadTool, { target: "plan" });
    const parsed = JSON.parse(read.content[0].text);
    expect(parsed.planType).toBe("task");
    expect(parsed.tasks).toHaveLength(2);
    expect(parsed.phases).toBeUndefined();

    expect((await execute(planCreateTool, { phaseId: 1, subject: "C" })).details.error).toBe("hidden phase");
    expect((await execute(planReadTool, { target: "phase", id: 1 })).details.error).toBe("hidden phase");
  });

  test("Plan mutations invalidate stale phase approvals", async () => {
    __setGoalForTest({
      id: "stale", objective: "交付", planType: "goal", status: "active", startedAt: 1, updatedAt: 1, iteration: 0,
      verification: "tests", acceptanceCriteria: [{ criterion: "passes", evidence: "bun test" }],
      auditCheckpoints: { phase: { workspaceFingerprint: "old", commands: [] } },
      plan: { revision: 7, nextId: 3, phases: [{
        id: 1, subject: "实现", status: "in_progress",
        acceptanceCriteria: [{ criterion: "implemented", evidence: "bun test" }],
        tasks: [{ id: 2, subject: "做完", status: "done", evidence: "bun test" }],
      }] },
    } as never);
    __setPhaseCheckOverrideForTest(async () => ({ approved: true, output: "<APPROVED>", liveness: "approved" }));
    await execute(phaseCheckTool, { phaseId: 1 });
    expect(__getGoalForTest()?.plan?.phases[0].check?.revision).toBe(7);
    await execute(planCreateTool, { phaseId: 1, subject: "补回归" });
    expect(__getGoalForTest()?.plan?.revision).toBe(8);
    expect(__getGoalForTest()?.plan?.phases[0].check).toBeUndefined();
    expect(__getGoalForTest()?.auditCheckpoints).toBeUndefined();
    await execute(planUpdateTool, { target: "task", id: 3, status: "in_progress" });
    await execute(planUpdateTool, { target: "task", id: 3, status: "done", evidence: "bun test" });
    const phaseDone = await execute(planUpdateTool, { target: "phase", id: 1, status: "done" });
    expect(phaseDone.details.error).toBe("phase check required");
  });

  test("concurrent Plan revision changes discard stale phase_check and goal_check results", async () => {
    __setGoalForTest({
      id: "concurrent-phase", objective: "交付", planType: "goal", status: "active", startedAt: 1, updatedAt: 1, iteration: 0,
      verification: "tests", acceptanceCriteria: [{ criterion: "passes", evidence: "bun test" }],
      plan: { revision: 7, nextId: 3, phases: [{
        id: 1, subject: "实现", status: "in_progress", acceptanceCriteria: [{ criterion: "ok", evidence: "bun test" }],
        tasks: [{ id: 2, subject: "做完", status: "done", evidence: "bun test" }],
      }] },
    } as never);
    __setPhaseCheckOverrideForTest(async () => {
      const current = __getGoalForTest()!;
      __setGoalForTest({ ...current, plan: { ...current.plan!, revision: 8 } });
      return { approved: true, output: "<APPROVED>", liveness: "approved" };
    });
    const phaseResult = await execute(phaseCheckTool, { phaseId: 1 });
    expect(phaseResult.details).toMatchObject({ stale: true, checkedRevision: 7, currentRevision: 8 });
    expect(__getGoalForTest()?.plan?.phases[0].check).toBeUndefined();

    __setGoalForTest({
      id: "concurrent-goal", objective: "交付", planType: "phase", status: "active", startedAt: 1, updatedAt: 1, iteration: 0,
      verification: "tests", acceptanceCriteria: [{ criterion: "passes", evidence: "bun test" }],
      plan: { revision: 4, nextId: 3, phases: [{
        id: 1, subject: "实现", status: "done", tasks: [{ id: 2, subject: "做完", status: "done", evidence: "bun test" }],
      }] },
    } as never);
    __setCompletionAuditorOverrideForTest(async () => {
      const current = __getGoalForTest()!;
      __setGoalForTest({ ...current, plan: { ...current.plan!, revision: 5 } });
      return { approved: true, aborted: false, output: "<APPROVED>", liveness: "approved" };
    });
    const goalResult = await execute(goalCheckTool, { summary: "完成", verification: "bun test" });
    expect(goalResult.details).toMatchObject({ stale: true, checkedRevision: 4, currentRevision: 5 });
    expect(__getGoalForTest()?.goalCheck).toBeUndefined();
  });

  test("phase_check rejection records a check without changing phase status", async () => {
    __setGoalForTest({
      id: "phase-rejected", objective: "交付", planType: "goal", status: "active", startedAt: 1, updatedAt: 1, iteration: 0,
      plan: { revision: 4, nextId: 3, phases: [{
        id: 1, subject: "实现", status: "pending", acceptanceCriteria: [{ criterion: "ok", evidence: "bun test" }],
        tasks: [{ id: 2, subject: "做完", status: "done", evidence: "bun test" }],
      }] },
    } as never);
    __setPhaseCheckOverrideForTest(async () => ({ approved: false, output: "缺少回归", liveness: "rejected" }));

    const result = await execute(phaseCheckTool, { phaseId: 1 });
    expect(result.details.approved).toBe(false);
    expect(__getGoalForTest()?.plan?.phases[0].status).toBe("pending");
    expect(__getGoalForTest()?.plan?.phases[0].check).toMatchObject({ status: "rejected", revision: 4 });
  });

  test("audit errors are recorded before the Plan pauses", async () => {
    __setGoalForTest({
      id: "audit-error", objective: "交付", planType: "goal", status: "active", startedAt: 1, updatedAt: 1, iteration: 0,
      plan: { revision: 2, nextId: 3, phases: [{
        id: 1, subject: "实现", status: "in_progress", acceptanceCriteria: [{ criterion: "ok", evidence: "bun test" }],
        tasks: [{ id: 2, subject: "做完", status: "done", evidence: "bun test" }],
      }] },
    } as never);
    __setCheckSnapshotForTest({ liveness: "tool_running", currentTool: "read", idleSecondsLeft: 10, idleSecondsTotal: 10 });
    __setPhaseCheckOverrideForTest(async () => ({ approved: false, output: "", liveness: "auditor_error", error: "provider down" }));
    const result = await execute(phaseCheckTool, { phaseId: 1 });
    expect(result.isError).toBe(true);
    expect(__getGoalForTest()?.status).toBe("paused");
    expect(__getGoalForTest()?.plan?.phases[0].check).toMatchObject({ status: "audit_error", report: "provider down", revision: 2 });
    expect(__getRuntimeStateForTest().currentCheckSnapshot).toBeUndefined();
  });

  test("goal_check rejection stays active and only permits in_progress phase reopen", async () => {
    __setGoalForTest({
      id: "goal-rejected", objective: "交付", planType: "goal", status: "active", startedAt: 1, updatedAt: 1, iteration: 0,
      verification: "tests", acceptanceCriteria: [{ criterion: "passes", evidence: "bun test" }],
      plan: { revision: 2, nextId: 3, phases: [{
        id: 1, subject: "实现", status: "done", acceptanceCriteria: [{ criterion: "implemented", evidence: "bun test" }],
        tasks: [{ id: 2, subject: "做完", status: "done", evidence: "bun test" }],
        check: { status: "approved", report: "ok", revision: 1 },
      }] },
    } as never);
    __setCompletionAuditorOverrideForTest(async () => ({ approved: false, aborted: false, output: "phase 仍有缺口", liveness: "rejected" }));

    const checked = await execute(goalCheckTool, { summary: "完成", verification: "bun test" });
    expect(checked.details.approved).toBe(false);
    expect(__getGoalForTest()?.status).toBe("active");
    expect(__getGoalForTest()?.goalCheck?.status).toBe("rejected");
    expect(__getGoalForTest()?.finalAuditHistory?.at(-1)).toMatchObject({ attempt: 1, report: "phase 仍有缺口" });
    expect((await execute(planUpdateTool, { target: "phase", id: 1, status: "pending" })).details.error).toBe("phase done");
    expect((await execute(planUpdateTool, { target: "phase", id: 1, status: "paused" })).details.error).toBe("invalid phase status");

    const reopened = await execute(planUpdateTool, { target: "phase", id: 1, status: "in_progress" });
    expect(reopened.details.status).toBe("in_progress");
    expect(__getGoalForTest()?.plan?.revision).toBe(3);
    expect(__getGoalForTest()?.plan?.phases[0].check).toBeUndefined();
    expect(__getGoalForTest()?.goalCheck).toBeUndefined();
  });

  test("audited Plan completion rejects missing, rejected, and stale goal_check records", async () => {
    const base = {
      id: "goal-guard", objective: "交付", planType: "phase", status: "active", startedAt: 1, updatedAt: 1, iteration: 0,
      verification: "tests", acceptanceCriteria: [{ criterion: "passes", evidence: "bun test" }],
      plan: { revision: 4, nextId: 3, phases: [{
        id: 1, subject: "实现", status: "done",
        tasks: [{ id: 2, subject: "做完", status: "done", evidence: "bun test" }],
      }] },
    } as const;
    for (const goalCheck of [
      undefined,
      { status: "rejected", report: "缺口", revision: 4 },
      { status: "approved", report: "旧批准", revision: 3 },
    ] as const) {
      __setGoalForTest({ ...base, goalCheck } as never);
      const result = await execute(planUpdateTool, { target: "goal", status: "done", summary: "完成", verification: "bun test" });
      expect(result.details.error).toBe("goal check required");
      expect(__getGoalForTest()?.status).toBe("active");
    }
  });

  test("Goal Plan separates phase_check, phase state update, goal_check and goal state update", async () => {
    __setGoalForTest({
      id: "g", objective: "交付", planType: "goal",
      status: "active", startedAt: 1, updatedAt: 1, iteration: 0,
      verification: "tests", acceptanceCriteria: [{ criterion: "passes", evidence: "bun test" }],
      plan: { revision: 0, nextId: 3, phases: [{
        id: 1, subject: "实现", status: "in_progress",
        acceptanceCriteria: [{ criterion: "implemented", evidence: "bun test" }],
        tasks: [{ id: 2, subject: "做完", status: "done", evidence: "bun test" }],
      }] },
    } as never);
    __setPhaseCheckOverrideForTest(async () => ({ approved: true, output: "<APPROVED>", liveness: "approved", modelId: "test/model" }));
    const checked = await execute(phaseCheckTool, { phaseId: 1 });
    expect(checked.details.approved).toBe(true);
    expect(__getGoalForTest()?.plan?.phases[0].status).toBe("in_progress");
    expect(__getGoalForTest()?.plan?.phases[0].check?.status).toBe("approved");

    await execute(planUpdateTool, { target: "phase", id: 1, status: "done" });
    expect(__getGoalForTest()?.plan?.phases[0].status).toBe("done");

    __setCompletionAuditorOverrideForTest(async () => ({ approved: true, output: "<APPROVED>", liveness: "approved", modelId: "test/model" }));
    const goalChecked = await execute(goalCheckTool, { summary: "完成", verification: "bun test" });
    expect(goalChecked.details.approved).toBe(true);
    expect(__getGoalForTest()?.status).toBe("active");
    expect(__getGoalForTest()?.goalCheck?.status).toBe("approved");
    const finished = await execute(planUpdateTool, { target: "goal", status: "done", summary: "完成", verification: "bun test" });
    expect(finished.details.completed).toBe(true);
    expect(__getGoalForTest()).toBeUndefined();
  });
});
