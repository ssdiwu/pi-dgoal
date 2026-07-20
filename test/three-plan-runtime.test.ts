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
  __setPlanOverlayForTest,
  __setPhaseCheckOverrideForTest,
  __setProposalSemanticReviewForTest,
  goalCheckTool,
  phasePlanTool,
  phaseCheckTool,
  planCreateTool,
  planReadTool,
  planUpdateTool,
  PlanOverlay,
  registerDgoal,
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

function withDescriptions(tool: { name?: string }, params: Record<string, unknown>): Record<string, unknown> {
  if (tool.name === "task_plan") {
    const objective = String(params.objective ?? "目标");
    return {
      ...params,
      description: params.description ?? `推进 ${objective}，保持方法与用户目标一致。`,
      tasks: Array.isArray(params.tasks) ? params.tasks.map((task, index) => ({
        ...(task as Record<string, unknown>),
        description: (task as Record<string, unknown>).description ?? `完成第 ${index + 1} 项以推进 ${objective}。`,
      })) : params.tasks,
    };
  }
  if (tool.name === "phase_plan" || tool.name === "goal_plan") {
    const objective = String(params.objective ?? "目标");
    return {
      ...params,
      description: params.description ?? `推进 ${objective}，保持确认的方法边界。`,
      phases: Array.isArray(params.phases) ? params.phases.map((phase, phaseIndex) => {
        const item = phase as Record<string, unknown>;
        return {
          ...item,
          description: item.description ?? `第 ${phaseIndex + 1} 阶段服务于 ${objective}。`,
          tasks: Array.isArray(item.tasks) ? item.tasks.map((task, taskIndex) => ({
            ...(task as Record<string, unknown>),
            description: (task as Record<string, unknown>).description ?? `第 ${taskIndex + 1} 个任务推进当前阶段。`,
          })) : item.tasks,
        };
      }) : params.phases,
    };
  }
  if (tool.name === "plan_create") return { description: "新增此任务以推进当前目标。", ...params };
  return params;
}

async function execute(tool: { name?: string; execute: Function }, params: Record<string, unknown>) {
  return tool.execute("call", withDescriptions(tool, params), undefined, undefined, ctx);
}

async function executeRaw(tool: { execute: Function }, params: Record<string, unknown>) {
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
  test("exports the registration function by name as well as default", () => {
    expect(registerDgoal).toBe(dgoal);
  });

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

  test("public Plan schemas require descriptions and do not expose activeForm/contextSummary", () => {
    const taskPlanProperties = (taskPlanTool.parameters as any).properties;
    const taskEntry = taskPlanProperties.tasks.items.properties;
    const phaseTaskEntry = (phasePlanTool.parameters as any).properties.phases.items.properties.tasks.items.properties;
    expect(taskEntry.activeForm).toBeUndefined();
    expect(phaseTaskEntry.activeForm).toBeUndefined();
    expect((planCreateTool.parameters as any).properties.activeForm).toBeUndefined();
    expect((planUpdateTool.parameters as any).properties.activeForm).toBeUndefined();
    expect(taskPlanProperties.description).toBeDefined();
    expect(taskEntry.description).toBeDefined();
    expect((phasePlanTool.parameters as any).properties.description).toBeDefined();
    expect((phasePlanTool.parameters as any).properties.contextSummary).toBeUndefined();
    expect((phasePlanTool.parameters as any).properties.phases.items.properties.description).toBeDefined();
    expect((planCreateTool.parameters as any).properties.description).toBeDefined();
  });

  test("an explicit natural-language /dgoal request cannot silently downgrade to Task Plan", async () => {
    authorizeNaturalLanguageStart("请使用 dgoal 完成");
    const result = await execute(taskPlanTool, { objective: "交付", tasks: [{ subject: "实现" }] });
    expect(result.details.error).toBe("explicit dgoal requested");
    expect(__getGoalForTest()).toBeUndefined();
  });

  test("Task Plan replacement clears a stale done snapshot", async () => {
    const overlay = new PlanOverlay();
    let cleared = 0;
    overlay.clearDoneSnapshot = () => { cleared += 1; };
    __setPlanOverlayForTest(overlay);
    try {
      const result = await execute(taskPlanTool, { objective: "新目标", tasks: [{ subject: "任务" }] });
      expect(result.isError).not.toBe(true);
      expect(cleared).toBe(1);
    } finally {
      __setPlanOverlayForTest(undefined);
      overlay.dispose();
    }
  });

  test("Task Plan automatically closes when its last task completes", async () => {
    const persistedStatuses: Array<string | null> = [];
    __setApiForTest({
      appendEntry: (_type: string, data: { goal?: { status?: string } | null }) => {
        persistedStatuses.push(data.goal?.status ?? null);
      },
    });
    await execute(taskPlanTool, { objective: "更新文档", tasks: [{ subject: "更新 README" }] });
    await execute(planUpdateTool, { target: "task", id: 1, status: "in_progress" });

    const finished = await execute(planUpdateTool, {
      target: "task",
      id: 1,
      status: "done",
      evidence: "README 已更新并通过检查",
    });

    expect(finished.details).toMatchObject({ target: "task", taskId: 1, status: "done", completed: true, planType: "task" });
    expect(finished.content[0].text).toContain("Task Plan 的全部 1 个 task 已完成");
    expect(finished.content[0].text).toContain("Task Plan 无独立审核");
    expect(__getGoalForTest()).toBeUndefined();
    expect(persistedStatuses.slice(-2)).toEqual(["done", null]);
  });

  test("Task Plan auto-close remains correct when the completion overlay throws", async () => {
    const overlay = new PlanOverlay();
    overlay.showDoneThenHide = () => { throw new Error("Spacer is not defined"); };
    __setPlanOverlayForTest(overlay);
    try {
      await execute(taskPlanTool, { objective: "修复展示", tasks: [{ subject: "验证完成路径" }] });
      await execute(planUpdateTool, { target: "task", id: 1, status: "in_progress" });
      const finished = await execute(planUpdateTool, {
        target: "task",
        id: 1,
        status: "done",
        evidence: "完成路径已验证",
      });
      expect(finished.details).toMatchObject({ completed: true, planType: "task" });
      expect(__getGoalForTest()).toBeUndefined();
    } finally {
      __setPlanOverlayForTest(undefined);
      overlay.dispose();
    }
  });

  test("Task Plan is direct, task-first, replaceable, and auto-closes without audit", async () => {
    const started = await execute(taskPlanTool, {
      objective: "修复键盘",
      tasks: [{ subject: "定位" }, { subject: "修复", blockedBy: [1] }, { subject: "验证", blockedBy: [2] }],
    });
    expect(started.details).toMatchObject({ planType: "task", revision: 0 });
    expect(started.content[0].text).toBe("Task Plan 已建立：修复键盘（0/3 tasks）");
    expect(started.content[0].text).not.toContain("Start the first task");
    expect(__getGoalForTest()?.planType).toBe("task");
    expect(__getGoalForTest()?.plan?.phases).toHaveLength(1);
    expect(__getGoalForTest()?.plan?.phases[0].id).toBe(1);
    expect(__getGoalForTest()?.plan?.nextId).toBe(4);

    let lines = renderPlanLines(__getGoalForTest(), { expandTasks: false });
    expect(lines[0]).toContain("0/3 tasks");
    expect(lines.some((line) => line.includes("定位"))).toBe(true);
    expect(lines.some((line) => line.includes("Ctrl+O 展开详情"))).toBe(false);
    expect(lines.some((line) => line.includes("修复键盘 · 0/3 tasks"))).toBe(true);

    const initialTasks = __getGoalForTest()?.plan?.phases[0].tasks ?? [];
    expect(initialTasks.map((task) => task.id)).toEqual([1, 2, 3]);
    expect(initialTasks[1]?.blockedBy).toEqual([1]);
    await execute(planUpdateTool, { target: "task", id: 1, status: "in_progress" });
    expect(__getGoalForTest()?.plan?.phases[0].tasks[0].status).toBe("in_progress");
    await execute(planUpdateTool, { target: "task", id: 1, status: "done", evidence: "located" });
    expect(__getGoalForTest()?.plan?.phases[0].tasks[0].status).toBe("done");
    await execute(planUpdateTool, { target: "task", id: 2, status: "in_progress" });
    await execute(planUpdateTool, { target: "task", id: 2, status: "done", evidence: "fixed" });
    lines = renderPlanLines(__getGoalForTest(), { expandTasks: false });
    expect(lines[0]).toContain("2/3 tasks");
    __setGoalForTest({ ...__getGoalForTest()!, iteration: 5, pausedTotalMs: 1_000 });

    const replaced = await execute(taskPlanTool, { objective: "改为修文档", description: "改为维护文档，不继续键盘实现。", tasks: [{ subject: "更新 README", description: "同步用户可见说明。" }] });
    expect(replaced.details.revision).toBeGreaterThan(0);
    expect(__getGoalForTest()?.objective).toBe("改为修文档");
    expect(__getGoalForTest()?.plan?.phases[0].tasks).toHaveLength(1);
    expect(__getGoalForTest()).toMatchObject({ iteration: 0, pausedTotalMs: 0, description: "改为维护文档，不继续键盘实现。" });
    expect(renderPlanLines(__getGoalForTest(), { expandTasks: false })[0]).toContain("0/1 tasks");
    await execute(planUpdateTool, { target: "task", id: 1, status: "in_progress" });
    const finished = await execute(planUpdateTool, { target: "task", id: 1, status: "done", evidence: "README updated" });
    expect(finished.details).toMatchObject({ completed: true, planType: "task" });
    expect(__getGoalForTest()).toBeUndefined();
  });

  test("missing descriptions are rejected across creation paths", async () => {
    expect((await executeRaw(taskPlanTool, { objective: "目标", tasks: [{ subject: "任务", description: "作用" }] })).details.error).toBe("no description");
    expect((await executeRaw(taskPlanTool, { objective: "目标", description: "方法", tasks: [{ subject: "任务" }] })).details.error).toContain("description is required");

    await execute(taskPlanTool, { objective: "目标", tasks: [{ subject: "已有任务" }] });
    expect((await executeRaw(planCreateTool, { subject: "新增任务" })).details.error).toBe("no description");
    expect((await executeRaw(planUpdateTool, { target: "task", id: 1, description: "" })).details.error).toBe("description cannot be blank");
  });

  test("pre-change Task Plan IDs remain mutable after reload", async () => {
    __setGoalForTest({
      id: "legacy-task-ids", objective: "旧 Task Plan", description: "保留现有 task ID 并继续推进。", planType: "task", status: "active",
      startedAt: 1, updatedAt: 1, iteration: 0,
      plan: {
        revision: 0,
        nextId: 3,
        phases: [{ id: 1, subject: "旧内部 phase", status: "pending", tasks: [{ id: 2, subject: "旧任务", description: "验证现有 ID 可继续更新。", status: "pending" }] }],
      },
    } as never);
    expect((await execute(planUpdateTool, { target: "task", id: 2, status: "in_progress" })).details.status).toBe("in_progress");
    const created = await execute(planCreateTool, { subject: "后续任务" });
    expect(created.content[0].text).toContain("task #3");
    expect(__getGoalForTest()?.plan?.phases[0].tasks.map((task) => task.id)).toEqual([2, 3]);
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
    expect(read.content[0].text).toContain("Task Plan · 0/2 tasks");
    expect(read.content[0].text).toContain("├─ task #1 · ○ A");
    expect(read.content[0].text).toContain("├─ task #2 · ○ B");
    expect(read.content[0].text).toContain("当前 frontier：task #1 已就绪但尚未开始");
    expect(read.content[0].text).toContain("下一合法动作：调用 plan_update 将 task #1 设为 in_progress");
    expect(read.content[0].text).not.toContain('"tasks"');
    expect(read.details).toMatchObject({ target: "plan", planType: "task", readOnly: true });

    const goal = await execute(planReadTool, { target: "goal" });
    expect(goal.content[0].text).toContain("Task Plan · 0/2 tasks · active");
    expect(goal.details.value).toBeUndefined();

    expect((await execute(planCreateTool, { phaseId: 1, subject: "C" })).details.error).toBe("hidden phase");
    expect((await execute(planReadTool, { target: "phase", id: 1 })).details.error).toBe("hidden phase");
  });

  test("plan_read projects only the latest audit feedback and completion claim", async () => {
    __setGoalForTest({
      id: "latest-audit-read", objective: "交付", description: "完成交付。", planType: "phase", status: "active",
      startedAt: 1, updatedAt: 1, iteration: 0,
      plan: { revision: 2, nextId: 2, phases: [{
        id: 1, subject: "实现", description: "完成实现。", status: "done",
        tasks: [{ id: 1, subject: "编码", description: "实现行为。", status: "done", evidence: "bun test" }],
      }] },
      goalCheck: { status: "rejected", report: "最新反馈", modelId: "test/model", checkedAt: 2, revision: 2 },
      finalFeedback: { report: "最新反馈", rejectedCount: 2, createdAt: 2 },
      finalAuditHistory: [
        { attempt: 1, report: "旧反馈", summary: "旧声明", verification: "旧验证", createdAt: 1 },
        { attempt: 2, report: "最新反馈", summary: "最新声明", verification: "最新验证", createdAt: 2 },
      ],
    });
    const read = await execute(planReadTool, { target: "goal" });
    expect(read.content[0].text).toContain("最新建检：rejected · 模型 test/model · revision 2");
    expect(read.content[0].text).toContain("最新反馈：最新反馈");
    expect(read.content[0].text).toContain("最新完成声明：第 2 次 · 最新声明｜验证：最新验证");
    expect(read.content[0].text).not.toContain("旧声明");
    expect(read.content[0].text).not.toContain("旧反馈");
  });

  test("phase/task descriptions can be revised with trace while goal description stays frozen", async () => {
    __setGoalForTest({
      id: "description-updates", objective: "交付", description: "按确认方法交付。", planType: "phase", status: "active",
      startedAt: 1, updatedAt: 1, iteration: 0,
      plan: { revision: 0, nextId: 2, phases: [{
        id: 1, subject: "实现", description: "按既定阶段推进。", status: "in_progress",
        tasks: [{ id: 1, subject: "编码", description: "完成最小实现。", status: "in_progress" }],
      }] },
    });

    const taskUpdated = await execute(planUpdateTool, { target: "task", id: 1, description: "先完成最小实现，再验证公开契约。" });
    expect(taskUpdated.details.display).toContain("先完成最小实现，再验证公开契约。");
    expect(__getGoalForTest()?.plan?.revision).toBe(1);

    const phaseUpdated = await execute(planUpdateTool, { target: "phase", id: 1, description: "保持当前阶段边界，不顺手重构。" });
    expect(phaseUpdated.details.display).toContain("保持当前阶段边界，不顺手重构。");
    expect(__getGoalForTest()?.plan?.revision).toBe(2);
    expect((await executeRaw(planUpdateTool, { target: "phase", id: 1, description: "" })).details.error).toBe("description cannot be blank");
    expect((await executeRaw(planUpdateTool, { target: "goal", description: "偷偷改方法" })).details.error).toBe("goal description frozen");
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
    expect(__getGoalForTest()?.plan?.phases[0].check?.revision).toBe(0);
    await execute(planCreateTool, { phaseId: 1, subject: "补回归" });
    expect(__getGoalForTest()?.plan?.revision).toBe(8);
    expect(__getGoalForTest()?.plan?.phases[0].check).toBeUndefined();
    expect(__getGoalForTest()?.auditCheckpoints).toBeUndefined();
    await execute(planUpdateTool, { target: "task", id: 3, status: "in_progress" });
    await execute(planUpdateTool, { target: "task", id: 3, status: "done", evidence: "bun test" });
    const phaseDone = await execute(planUpdateTool, { target: "phase", id: 1, status: "done" });
    expect(phaseDone.details.error).toBe("phase check required");
  });

  test("unrelated Plan revision changes preserve an in-flight phase_check while goal_check stays global", async () => {
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
    expect(phaseResult.details.approved).toBe(true);
    expect(__getGoalForTest()?.plan?.phases[0].check).toMatchObject({ status: "approved", revision: 0 });

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
    expect(__getGoalForTest()?.plan?.phases[0].check).toMatchObject({ status: "rejected", revision: 0 });
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
    expect(__getGoalForTest()?.plan?.phases[0].check).toMatchObject({ status: "audit_error", report: "provider down", revision: 0 });
    expect(__getRuntimeStateForTest().currentCheckSnapshot).toBeUndefined();
  });

  test("goal_check rejects whitespace-only completion claims before auditing", async () => {
    __setGoalForTest({
      id: "blank-claim", objective: "交付", planType: "phase", status: "active", startedAt: 1, updatedAt: 1, iteration: 0,
      verification: "tests", acceptanceCriteria: [{ criterion: "passes", evidence: "bun test" }],
      plan: { revision: 2, nextId: 3, phases: [{
        id: 1, subject: "实现", status: "done",
        tasks: [{ id: 2, subject: "做完", status: "done", evidence: "bun test" }],
      }] },
    } as never);
    let auditorCalls = 0;
    __setCompletionAuditorOverrideForTest(async () => {
      auditorCalls += 1;
      return { approved: false, aborted: false, output: "不应调用", liveness: "rejected" };
    });

    const blankSummary = await execute(goalCheckTool, { summary: "   ", verification: "bun test" });
    expect(blankSummary.details.error).toBe("completion claim required");
    const blankVerification = await execute(goalCheckTool, { summary: "完成", verification: "   " });
    expect(blankVerification.details.error).toBe("completion claim required");
    expect(auditorCalls).toBe(0);
    expect(__getGoalForTest()?.finalAuditHistory).toBeUndefined();
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
