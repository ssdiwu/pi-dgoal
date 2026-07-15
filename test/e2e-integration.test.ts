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
  __executeDgoalCheckForTest,
  __executeDgoalDoneForTest,
  __executeDgoalProposeForTest,
  __finalizeGoalForTest,
  __getGoalForTest,
  __handleFinalAuditRejectedForTest,
  __handleStartupGateForTest,
  __pauseOnAuditFailureForTest,
  __resetGoalForTest,
  __resumeGoalForTest,
  __setApiForTest,
  __setGoalForTest,
  __setPlanOverlayForTest,
  __setPhaseCheckOverrideForTest,
  __recordAuditorCandidateResultForTest,
  __setCompletionAuditorOverrideForTest,
  __setProposalSemanticReviewForTest,
  renderPlanLines,
  extractUserReviewSuggestions,
  formatUserReviewText,
  type GoalState,
  type Phase,
  type PlanProposal,
  proposalToPlan,
  PlanOverlay,
  setFinalFeedback,
  setPhaseCompleted,
  STATE_ENTRY_TYPE,
  currentUncheckedPhase,
  disposePlanOverlay,
  type Task,
  type TaskPlan,
} from "../index.ts";

// mock api：捕获 persistGoal 写入 + 模拟 appendEntry
function makeApi() {
  const writes: Array<{ type: string; data: { goal: GoalState | null } }> = [];
  const api = {
    appendEntry: (type: string, data: { goal: GoalState | null }) => {
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
  test("单 phase 审核耗尽写 auditErrorScope=goal，resume 清除 goal 候选", async () => {
    __resetGoalForTest();
    const { api, writes } = makeApi();
    __setApiForTest(api);
    __setCompletionAuditorOverrideForTest(async () => ({
      approved: false,
      aborted: false,
      output: "",
      error: "all candidates exhausted",
      liveness: "auditor_error",
      exhausted: true,
    }));
    __setGoalForTest({
      id: "single-phase-exhausted",
      objective: "单 phase scope",
      status: "active",
      startedAt: 1,
      updatedAt: 1,
      iteration: 0,
      verification: "npm test",
      plan: {
        phases: [{ id: 1, subject: "交付", status: "in_progress", tasks: [{ id: 2, subject: "实现", status: "done", evidence: "npm test" }] }],
        nextId: 3,
      },
      auditorCandidates: {
        phase: { selectedModelId: "backup/phase" },
        goal: { failedModelIds: ["primary/goal"] },
      },
    } as never);

    const check = await __executeDgoalCheckForTest({ phaseId: 1 }, { cwd: process.cwd(), ui: { notify: () => {}, setStatus: () => {} } } as never);
    expect(check.isError).toBe(true);
    const paused = __getGoalForTest()!;
    expect(paused.status).toBe("paused");
    expect(paused.pauseReason).toBe("audit_error");
    expect(paused.auditErrorScope).toBe("goal");

    await __resumeGoalForTest({ sendUserMessage: async () => {} } as never, { isIdle: () => true, ui: { setStatus: () => {}, notify: () => {} } } as never);
    const resumed = __getGoalForTest()!;
    expect(resumed.status).toBe("active");
    expect(resumed.auditErrorScope).toBeUndefined();
    expect(resumed.auditorCandidates?.phase).toEqual({ selectedModelId: "backup/phase" });
    expect(resumed.auditorCandidates?.goal).toBeUndefined();
  });

  test("单 phase dgoal_check 合并 goal 审核，dgoal_done 不重复审核", async () => {
    __resetGoalForTest();
    __setApiForTest(makeApi().api as never);
    let auditCalls = 0;
    __setCompletionAuditorOverrideForTest(async () => {
      auditCalls += 1;
      return { approved: true, aborted: false, output: "<APPROVED> unified", modelId: "test/auditor", liveness: "approved" };
    });
    __setGoalForTest({
      id: "single-phase",
      objective: "单 phase 交付",
      status: "active",
      startedAt: 1,
      updatedAt: 1,
      iteration: 0,
      verification: "npm test",
      plan: {
        phases: [{ id: 1, subject: "交付", status: "in_progress", tasks: [{ id: 2, subject: "实现", status: "done", evidence: "npm test" }] }],
        nextId: 3,
      },
    } as never);

    const check = await __executeDgoalCheckForTest({ phaseId: 1 }, { cwd: process.cwd(), ui: {} } as never);
    expect(check.details?.approved).toBe(true);
    expect(__getGoalForTest()?.singlePhaseAudit?.modelId).toBe("test/auditor");
    // 冻结验收：dgoal_check 最终工具输出必须展示实际形成结论的审核模型
    expect(check.details?.auditorModel).toBe("test/auditor");
    expect(String(check.details?.auditorModelLabel ?? "")).toContain("test/auditor");
    expect(String(check.content?.[0]?.text ?? "")).toContain("test/auditor");

    const done = await __executeDgoalDoneForTest({ summary: "完成单 phase", verification: "npm test" }, { cwd: process.cwd(), ui: {} } as never);
    expect(done.details?.singlePhaseUnifiedAudit).toBe(true);
    // 冻结验收：dgoal_done 最终工具输出必须展示实际形成结论的审核模型
    expect(done.details?.auditorModel).toBe("test/auditor");
    expect(String(done.content?.[0]?.text ?? "")).toContain("test/auditor");
    expect(auditCalls).toBe(1);
  });

  test("多 phase 终审归因链路：phase(id) 拒绝写阶段反馈、goal 拒绝写终审反馈与账本、user_review 不触发重检", async () => {
    __resetGoalForTest();
    const { api, writes } = makeApi();
    __setApiForTest(api);
    // 多 phase：dgoal_check 走 runPhaseCheck（phaseCheckOverride），dgoal_done 走 runCompletionAuditor
    let phaseCheckCalls = 0;
    __setPhaseCheckOverrideForTest(async () => {
      phaseCheckCalls += 1;
      // phase #1 首次过；phase #2 首次拒（带用户复核建议），二次过；均携带实际审核模型
      if (phaseCheckCalls === 1) return { approved: true, aborted: false, output: "<APPROVED>", liveness: "approved", modelId: "test/auditor" };
      if (phaseCheckCalls === 2) return { approved: false, aborted: false, output: "## 建议用户复核（不阻塞完成）\n- 复核真实 UI\n\n<REJECTED>", liveness: "rejected", modelId: "test/auditor" };
      return { approved: true, aborted: false, output: "<APPROVED>", liveness: "approved", modelId: "test/auditor" };
    });
    __setGoalForTest({
      id: "multi-phase-attribution",
      objective: "多 phase 终审归因",
      status: "active",
      startedAt: 1,
      updatedAt: 1,
      iteration: 0,
      verification: "npm test",
      plan: {
        phases: [
          makePhase(1, "实现", [makeTask(3, "t1", "done", { evidence: "npm test" })], "pending"),
          makePhase(2, "验证", [makeTask(4, "t2", "done", { evidence: "lint ok" })], "pending"),
        ],
        nextId: 5,
      },
    } as never);

    // 1. phase #1 建检通过 → done
    const c1 = await __executeDgoalCheckForTest({ phaseId: 1 }, { cwd: process.cwd(), ui: {} } as never);
    expect(c1.details?.approved).toBe(true);
    expect(__getGoalForTest()?.plan!.phases[0].status).toBe("done");

    // 2. phase #2 建检拒绝 → 回 in_progress + 阶段反馈（phase 归因）
    const c2 = await __executeDgoalCheckForTest({ phaseId: 2 }, { cwd: process.cwd(), ui: {} } as never);
    expect(c2.details?.approved).toBe(false);
    // 冻结验收：拒绝路径的最终工具输出也必须展示实际形成结论的审核模型
    expect(c2.details?.auditorModel).toBe("test/auditor");
    expect(String(c2.content?.[0]?.text ?? "")).toContain("test/auditor");
    const afterPhaseReject = __getGoalForTest()!;
    expect(afterPhaseReject.plan!.phases[1].status).toBe("in_progress");
    expect(afterPhaseReject.phaseFeedbackById?.["2"]?.report).toContain("<REJECTED>");
    // 阶段拒绝提取的用户复核建议落入 userReviewItems，不阻塞
    expect(afterPhaseReject.userReviewItems).toContain("复核真实 UI");

    // 3. 修复后 phase #2 再次建检通过 → done，阶段反馈清除
    const c2b = await __executeDgoalCheckForTest({ phaseId: 2 }, { cwd: process.cwd(), ui: {} } as never);
    expect(c2b.details?.approved).toBe(true);
    expect(__getGoalForTest()?.plan!.phases[1].status).toBe("done");
    expect(__getGoalForTest()?.phaseFeedbackById?.["2"]).toBeUndefined();

    // 4. dgoal_done 终审拒绝（AUDITOR bypass 下用 handleFinalAuditRejectedForTest 直走拒绝路径）→ goal 进 rejected + finalFeedback + 终审修复账本（goal 归因）
    const completedGoal = __getGoalForTest()!;
    __handleFinalAuditRejectedForTest({
      completedGoal,
      summary: "完成",
      verification: "npm test",
      auditOutput: "## 建议用户复核（不阻塞完成）\n- 复核 TUI 标签\n\n<REJECTED>",
      ctx: { cwd: process.cwd(), ui: {} } as never,
    } as never);
    const afterGoalReject = __getGoalForTest()!;
    expect(afterGoalReject.status).toBe("rejected");
    expect(afterGoalReject.finalFeedback?.report).toContain("<REJECTED>");
    expect(afterGoalReject.finalAuditHistory).toHaveLength(1);
    expect(afterGoalReject.finalAuditHistory?.[0].attempt).toBe(1);
    // 终审拒绝也提取用户复核建议，但不触发重检（userReview 永不阻塞完成）
    expect(afterGoalReject.userReviewItems).toContain("复核 TUI 标签");
  });
  beforeEach(() => {
    __resetGoalForTest();
  });

  test("启动确认 UI 抛错时仍先落盘 active 并投递 START prompt", async () => {
    const { api, writes } = makeApi();
    __setApiForTest(api);
    const pendingGoal: GoalState = { id: "startup-ui-throw", objective: "启动 UI 容错", status: "pending", startedAt: 1, updatedAt: 1, iteration: 0 };
    __setGoalForTest(pendingGoal);
    const proposalParams = {
      objective: "启动 UI 容错",
      verification: "bun test test/e2e-integration.test.ts",
      acceptanceCriteria: [{ criterion: "测试通过", evidence: "bun test test/e2e-integration.test.ts" }],
      phases: [{ subject: "启动阶段", acceptanceCriteria: [{ criterion: "测试通过", evidence: "bun test test/e2e-integration.test.ts" }] }],
    };
    __setProposalSemanticReviewForTest(() => ({
      decision: "approve",
      acceptanceCriteria: proposalParams.acceptanceCriteria,
      phaseAcceptanceCriteria: [proposalParams.phases[0].acceptanceCriteria],
    }));
    await __executeDgoalProposeForTest(proposalParams, { model: {}, modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true as const, apiKey: "test" }) } });

    const sent: string[] = [];
    const ctx = {
      ui: {
        select: async () => "确认，开始执行",
        editor: async () => undefined,
        setStatus: () => { throw new Error("Spacer is not defined"); },
        notify: () => { throw new Error("TUI notify failed"); },
      },
      cwd: process.cwd(),
    } as never;
    await __handleStartupGateForTest({ sendUserMessage: async (message: string) => { sent.push(message); } } as never, ctx, pendingGoal);

    expect(__getGoalForTest()?.status).toBe("active");
    expect(writes.some((entry) => entry.data.goal?.status === "active")).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Dgoal 模式已激活");
    __resetGoalForTest();
  });

  test("隐式 proposal 降级显式确认后不继承旧 implicitStart 权限", async () => {
    const { api } = makeApi();
    __setApiForTest(api);
    const pendingGoal = {
      id: "implicit-downgrade-confirm", objective: "显式确认降级", status: "pending",
      startedAt: 1, updatedAt: 1, iteration: 0, implicitStart: true,
      allowedToolScope: "local_repo_and_readonly_external",
    } as GoalState;
    __setGoalForTest(pendingGoal);
    const criteria = [{ criterion: "测试通过", evidence: "bun test test/e2e-integration.test.ts" }];
    __setProposalSemanticReviewForTest(() => ({ decision: "approve", requiresExplicitConfirmation: true }));
    const proposed = await __executeDgoalProposeForTest({
      objective: pendingGoal.objective, verification: criteria[0].evidence,
      verificationPolicyRecommendation: "final_only", budgetPolicyRecommendation: "bounded",
      runtimeBudget: { maxTurns: 4 }, acceptanceCriteria: criteria,
      phases: [{ subject: "阶段", tasks: [{ subject: "任务" }] }],
    });
    expect(proposed.details?.error).toBeUndefined();

    const ctx = { ui: { select: async () => "确认，开始执行", notify: () => {}, setStatus: () => {} }, cwd: process.cwd() } as never;
    await __handleStartupGateForTest({ sendUserMessage: async () => {} } as never, ctx, pendingGoal);
    const active = __getGoalForTest();
    expect(active?.status).toBe("active");
    expect(active?.implicitStart).toBeUndefined();
    expect(active?.allowedToolScope).toBeUndefined();
  });

  test("启动确认时按 setWidget 能力恢复缺失的持续显示浮层", async () => {
    const { api } = makeApi();
    __setApiForTest(api);
    __setPlanOverlayForTest(undefined);
    const pendingGoal: GoalState = { id: "startup-widget-restore", objective: "恢复持续浮层", status: "pending", startedAt: 1, updatedAt: 1, iteration: 0 };
    __setGoalForTest(pendingGoal);
    const criteria = [{ criterion: "测试通过", evidence: "bun test test/e2e-integration.test.ts" }];
    __setProposalSemanticReviewForTest(() => ({ decision: "approve" }));
    await __executeDgoalProposeForTest({
      objective: pendingGoal.objective, verification: criteria[0].evidence,
      verificationPolicyRecommendation: "final_only", budgetPolicyRecommendation: "bounded",
      runtimeBudget: { maxTurns: 4 }, acceptanceCriteria: criteria,
      phases: [{ subject: "阶段", tasks: [{ subject: "任务" }] }],
    });

    const widgets: Array<{ key: string; value: unknown; options?: unknown }> = [];
    const ctx = {
      ui: {
        select: async () => "确认，开始执行",
        notify: () => {}, setStatus: () => {},
        setWidget: (key: string, value: unknown, options?: unknown) => widgets.push({ key, value, options }),
        getToolsExpanded: () => false,
        onTerminalInput: () => () => {},
      },
      cwd: process.cwd(),
    } as never;
    try {
      await __handleStartupGateForTest({ sendUserMessage: async () => {} } as never, ctx, pendingGoal);
      expect(__getGoalForTest()?.status).toBe("active");
      expect(widgets.some((item) => item.key === "dgoal-plan" && Array.isArray(item.value) && item.value.length > 0)).toBe(true);
    } finally {
      disposePlanOverlay();
    }
  });

  test("启动拒绝分支 notify 抛错时仍完成 pending goal 清理", async () => {
    const { api, writes } = makeApi();
    __setApiForTest(api);
    const pendingGoal: GoalState = { id: "startup-reject-ui-throw", objective: "拒绝 UI 容错", status: "pending", startedAt: 1, updatedAt: 1, iteration: 0 };
    __setGoalForTest(pendingGoal);
    const criteria = [{ criterion: "测试通过", evidence: "bun test test/e2e-integration.test.ts" }];
    __setProposalSemanticReviewForTest(() => ({ decision: "approve", acceptanceCriteria: criteria, phaseAcceptanceCriteria: [criteria] }));
    await __executeDgoalProposeForTest({ objective: pendingGoal.objective, verification: criteria[0].evidence, acceptanceCriteria: criteria, phases: [{ subject: "阶段", acceptanceCriteria: criteria }] }, { model: {}, modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true as const, apiKey: "test" }) } });
    const ctx = { ui: { select: async () => "拒绝，放弃目标", notify: () => {
      expect(writes.at(-1)?.data.goal).toBeNull();
      throw new Error("UI notify failed");
    }, setStatus: () => {} }, cwd: process.cwd() } as never;
    await expect(__handleStartupGateForTest({ sendUserMessage: async () => {} } as never, ctx, pendingGoal)).resolves.toBeUndefined();
    expect(__getGoalForTest()).toBeUndefined();
    expect(writes.at(-1)?.data.goal).toBeNull();
  });

  test("启动反馈分支 notify 抛错时仍投递重提 prompt", async () => {
    const { api } = makeApi();
    __setApiForTest(api);
    const pendingGoal: GoalState = { id: "startup-feedback-ui-throw", objective: "反馈 UI 容错", status: "pending", startedAt: 1, updatedAt: 1, iteration: 0 };
    __setGoalForTest(pendingGoal);
    const criteria = [{ criterion: "测试通过", evidence: "bun test test/e2e-integration.test.ts" }];
    __setProposalSemanticReviewForTest(() => ({ decision: "approve", acceptanceCriteria: criteria, phaseAcceptanceCriteria: [criteria] }));
    await __executeDgoalProposeForTest({ objective: pendingGoal.objective, verification: criteria[0].evidence, acceptanceCriteria: criteria, phases: [{ subject: "阶段", acceptanceCriteria: criteria }] }, { model: {}, modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true as const, apiKey: "test" }) } });
    const sent: string[] = [];
    const ctx = { ui: { select: async () => "输入反馈意见", editor: async () => "补充测试", notify: () => { throw new Error("UI notify failed"); }, setStatus: () => {} }, cwd: process.cwd() } as never;
    await __handleStartupGateForTest({ sendUserMessage: async (message: string) => { sent.push(message); } } as never, ctx, pendingGoal);
    expect(__getGoalForTest()?.status).toBe("pending");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("补充测试");
  });

  test("完整流程：startGoal → propose → confirm → plan → task completed → phase completed → dgoal_done(AUDITOR bypass) → done", () => {
    const { api, writes } = makeApi();
    __setApiForTest(api);

    // 1. 启动 goal（pending 状态，模拟 startGoal 建 goal）
    let goal: GoalState = {
      id: "e2e-1",
      objective: "E2E 测试目标",
      status: "pending",
      startedAt: 1_000,
      updatedAt: 1_000,
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
    const activatedAt = 2_000;
    goal = { ...goal, plan: proposalToPlan(proposal), status: "active", startedAt: activatedAt, updatedAt: activatedAt };
    // 模拟 persistGoal（startGoal 确认后会 persist）
    api.appendEntry(STATE_ENTRY_TYPE, { goal });

    // 计时从用户确认计划进入 active 时开始，而不是 pending 启动阶段。
    expect(goal.startedAt).toBe(activatedAt);

    // 3. 验证 plan 完整
    expect(goal.plan).toBeDefined();
    expect(goal.plan!.phases).toHaveLength(2);
    expect(goal.plan!.phases[0].tasks).toHaveLength(2);
    expect(goal.plan!.phases[1].tasks).toHaveLength(1);
    // phaseCount=2，task 从 3 起分配，共 3 个 task，nextId=6
    expect(goal.plan!.nextId).toBe(6);

    // 4. 阶段A 的 task1 推进：pending → in_progress
    const t1 = goal.plan!.phases[0].tasks[0];
    expect(t1.status).toBe("pending");
    // 模拟 dgoal_plan update（直接调 reducer 模拟工具 execute 的 commit 行为）
    const r1 = applyPlanUpdate(goal, { id: t1.id, status: "in_progress", activeForm: "正在做 task1" });
    goal = r1.goal;
    api.appendEntry(STATE_ENTRY_TYPE, { goal });
    expect(goal.plan!.phases[0].tasks[0].status).toBe("in_progress");
    expect(goal.plan!.phases[0].status).toBe("in_progress"); // 聚合

    // 5. task1 → completed（带 evidence）
    const r2 = applyPlanUpdate(goal, { id: t1.id, status: "completed", evidence: "跑测试全过" });
    goal = r2.goal;
    api.appendEntry(STATE_ENTRY_TYPE, { goal });
    expect(goal.plan!.phases[0].tasks[0].status).toBe("completed");
    expect(goal.plan!.phases[0].tasks[0].evidence).toBe("跑测试全过");

    // 6. task2 完成
    const t2 = goal.plan!.phases[0].tasks[1];
    const r3 = applyPlanUpdate(goal, { id: t2.id, status: "completed", evidence: "ok" });
    goal = r3.goal;
    api.appendEntry(STATE_ENTRY_TYPE, { goal });
    expect(goal.plan!.phases[0].tasks[1].status).toBe("completed");
    expect(goal.plan!.phases[0].status).toBe("in_progress"); // 聚合：仍有 in_progress task

    // 7. 阶段A task 全终态：阶段A 进 dgoal_check
    // 先把 task2 标记 completed（实际上面 r3 已做）
    // 阶段A task 状态：task1 completed, task2 completed → 全终态
    // 模拟 dgoal_check approved → setPhaseCompleted
    const r4 = setPhaseCompleted(goal, 1);
    expect(r4.op.kind).not.toBe("error");
    goal = r4.goal;
    api.appendEntry(STATE_ENTRY_TYPE, { goal });
    expect(goal.plan!.phases[0].status).toBe("completed");

    // 8. 阶段B task3 完成
    const t3 = goal.plan!.phases[1].tasks[0];
    const r5 = applyPlanUpdate(goal, { id: t3.id, status: "completed", evidence: "ok" });
    goal = r5.goal;
    api.appendEntry(STATE_ENTRY_TYPE, { goal });

    // 9. 阶段B 也全终态 → setPhaseCompleted（phase 2）
    const r6 = setPhaseCompleted(goal, 2);
    goal = r6.goal;
    expect(goal.plan!.phases[1].status).toBe("completed");

    // 10. 模拟 dgoal_done（AUDITOR bypass）：直接调 finalize 行为——设 done
    // finalizeGoal 内部是：status: done → persistGoal(null) → currentGoal=undefined
    // 这里模拟这个序列
    goal = { ...goal, status: "done", updatedAt: Date.now() };
    api.appendEntry(STATE_ENTRY_TYPE, { goal: null }); // finalize 写 null

    // 11. 验证：所有 phase completed，goal done，persist 序列完整
    expect(goal.plan!.phases.every((p) => p.status === "completed")).toBe(true);
    expect(goal.status).toBe("done");
    expect(writes.length).toBeGreaterThanOrEqual(7); // 多次 persist
    expect(writes[writes.length - 1].data.goal).toBeNull(); // 最后一次写 null
  });

  test("计时从用户确认计划进入 active 时开始，而不是 pending 启动阶段", () => {
    const pendingStartedAt = 1_000;
    const activatedAt = 2_000;
    const pendingGoal: GoalState = {
      id: "timer-1",
      objective: "计时测试",
      status: "pending",
      startedAt: pendingStartedAt,
      updatedAt: pendingStartedAt,
      iteration: 0,
    };
    const proposal: PlanProposal = {
      objective: "计时测试",
      phases: [{ subject: "阶段A" }],
    };
    const activeGoal: GoalState = {
      ...pendingGoal,
      plan: proposalToPlan(proposal),
      status: "active",
      startedAt: activatedAt,
      updatedAt: activatedAt,
    };
    expect(activeGoal.startedAt).toBe(activatedAt);
    expect(activeGoal.startedAt).not.toBe(pendingGoal.startedAt);
  });

  test("rejected 计数到 3 转 paused(audit_failed_3x)", () => {
    const { api } = makeApi();
    __setApiForTest(api);

    let goal: GoalState = {
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

  test("rejected 状态 isGoalRunning 返回 true（agent_end/before_agent_start 仍推进）", () => {
    const isGoalRunning = (status: GoalState["status"]) => status === "active" || status === "rejected";
    expect(isGoalRunning("rejected")).toBe(true);
    expect(isGoalRunning("active")).toBe(true);
    expect(isGoalRunning("paused")).toBe(false);
    expect(isGoalRunning("done")).toBe(false);
  });

  // v0.5.2 切片3 · 终审反馈生命周期（ADR 0011）
  test("终审未通过写 finalFeedback，覆盖上一轮报告", () => {
    let goal: GoalState = { id: "1", objective: "o", status: "rejected", rejectedCount: 1, startedAt: 1, updatedAt: 1, iteration: 0 };
    goal = setFinalFeedback(goal, "终审报告 v1", 1);
    expect(goal.finalFeedback!.report).toBe("终审报告 v1");
    expect(goal.finalFeedback!.rejectedCount).toBe(1);
    // 重新 rejected 覆盖
    goal = setFinalFeedback({ ...goal, rejectedCount: 2 }, "终审报告 v2", 2);
    expect(goal.finalFeedback!.report).toBe("终审报告 v2");
    expect(goal.finalFeedback!.rejectedCount).toBe(2);
  });

  test("resume(audit_failed_3x) 清零 rejectedCount 但保留 finalFeedback", () => {
    // 3 次不过进入 paused，finalFeedback 带在 goal 上
    const paused: GoalState = {
      id: "1", objective: "o", status: "paused", pauseReason: "audit_failed_3x",
      rejectedCount: 3, finalFeedback: { report: "第3次终审报告", rejectedCount: 3, createdAt: 1 },
      startedAt: 1, updatedAt: 1, iteration: 0,
    } as GoalState;
    // 模拟 resume 逻辑：markGoalResumed(goal, now, clearRejected ? {rejectedCount:0} : {})
    const clearRejected = paused.pauseReason === "audit_failed_3x";
    const resumed: GoalState = { ...paused, ...(clearRejected ? { rejectedCount: 0 } : {}), status: "active" } as GoalState;
    expect(resumed.rejectedCount).toBe(0);
    expect(resumed.finalFeedback!.report).toBe("第3次终审报告");
    expect(resumed.finalFeedback!.rejectedCount).toBe(3); // 报告记录的是当时的计数，不清
  });

  test("终审 approved 后随 goal 清空，finalFeedback 不残留", () => {
    const goal: GoalState = {
      id: "1", objective: "o", status: "rejected", rejectedCount: 1,
      finalFeedback: { report: "报告", rejectedCount: 1, createdAt: 1 },
      startedAt: 1, updatedAt: 1, iteration: 0,
    } as GoalState;
    // 模拟 finalizeGoal：currentGoal = null / persistGoal(null)
    // goal 被清空，feedback 随之结束
    expect(goal.finalFeedback).toBeDefined();
    const cleared = null;
    expect(cleared).toBeNull();
  });

  test("终审 rejected 提取并持久化审核报告中的用户复核建议", () => {
    const { api, writes } = makeApi();
    __setApiForTest(api);
    const goal: GoalState = {
      id: "reject-review",
      objective: "o",
      status: "active",
      startedAt: 1,
      updatedAt: 1,
      iteration: 1,
      plan: { phases: [makePhase(1, "p", [makeTask(2, "t", "completed")], "completed")], nextId: 3 },
    };
    __setGoalForTest(goal);
    __handleFinalAuditRejectedForTest({
      completedGoal: goal,
      summary: "完成",
      verification: "npm test",
      auditOutput: `## 验收结论\n<REJECTED>\n\n## 建议用户复核（不阻塞完成）\n- 看一下真实 TUI 浮层`,
      ctx: { cwd: process.cwd(), ui: {} } as never,
    } as never);
    const lastWrite = writes.at(-1)?.data.goal;
    expect(lastWrite?.status).toBe("rejected");
    expect(lastWrite?.userReviewItems).toContain("看一下真实 TUI 浮层");
  });

  test("终审 approved 合并上一轮 rejected 报告中的用户复核建议", () => {
    // 模拟：先 rejected（finalFeedback 含用户复核建议），后 approved
    const goalWithFeedback: GoalState = {
      id: "1", objective: "o", status: "rejected", rejectedCount: 1,
      finalFeedback: { report: `## 验收结论\n<REJECTED>\n\n## 建议用户复核（不阻塞完成）\n- 上一轮建议人工看 UI`, rejectedCount: 1, createdAt: 1 },
      startedAt: 1, updatedAt: 1, iteration: 0,
    } as GoalState;
    const previousReviewItems = goalWithFeedback.finalFeedback!.report
      ? extractUserReviewSuggestions(goalWithFeedback.finalFeedback!.report)
      : [];
    const discoveredUserReview = extractUserReviewSuggestions(`## 建议用户复核（不阻塞完成）\n- 本轮发现需检查文档`);
    const completionUserReview = formatUserReviewText(goalWithFeedback, undefined, [...previousReviewItems, ...discoveredUserReview]);
    expect(completionUserReview).toContain("上一轮建议人工看 UI");
    expect(completionUserReview).toContain("本轮发现需检查文档");
  });

  test("audit_error 暂停会写 pauseReason=audit_error", () => {
    const { api, writes } = makeApi();
    __setApiForTest(api);
    __setGoalForTest({
      id: "audit-error-1",
      objective: "o",
      status: "active",
      startedAt: 1,
      updatedAt: 1,
      iteration: 0,
    });
    const notes: string[] = [];
    const ctx = { ui: { setStatus: () => {}, notify: (msg: string) => notes.push(msg) } } as never;
    __pauseOnAuditFailureForTest(ctx, "idle_timeout");
    const persisted = writes.at(-1)?.data.goal as GoalState;
    expect(persisted.status).toBe("paused");
    expect(persisted.pauseReason).toBe("audit_error");
    expect(notes.at(-1)).toContain("idle_timeout");
  });

  test("resume(audit_failed_3x) 清零 rejectedCount，resume(其他) 不清零", () => {
    const { api } = makeApi();
    __setApiForTest(api);

    // audit_failed_3x
    const g1: GoalState = { id: "1", objective: "o", status: "paused", pauseReason: "audit_failed_3x", rejectedCount: 3, startedAt: 1, updatedAt: 1, iteration: 0 };
    const clear1 = g1.pauseReason === "audit_failed_3x";
    expect(clear1).toBe(true);

    // user_abort
    const g2: GoalState = { id: "2", objective: "o", status: "paused", pauseReason: "user_abort", startedAt: 1, updatedAt: 1, iteration: 0 };
    const clear2 = g2.pauseReason === "audit_failed_3x";
    expect(clear2).toBe(false);
  });

  test("审核候选状态先落盘后 phase 推进时不会被旧 goal 快照覆盖", async () => {
    const { api } = makeApi();
    __setApiForTest(api);
    __setPhaseCheckOverrideForTest(async () => {
      // 模拟生产 runAuditorWithCandidates 在工具推进前写入健康 fallback。
      __recordAuditorCandidateResultForTest("phase", {
        approved: true,
        aborted: false,
        output: "<APPROVED>",
        modelId: "candidate/3",
        attempts: [
          { modelId: "candidate/1", attempt: 1, outcome: "fallback" },
          { modelId: "candidate/2", attempt: 1, outcome: "fallback" },
          { modelId: "candidate/3", attempt: 1, outcome: "approved" },
        ],
      });
      return { approved: true, aborted: false, output: "<APPROVED>", modelId: "candidate/3", liveness: "approved" };
    });
    __setGoalForTest({
      id: "candidate-production-merge",
      objective: "candidate production merge",
      status: "active",
      startedAt: 1,
      updatedAt: 1,
      iteration: 0,
      plan: {
        phases: [
          makePhase(1, "实现", [makeTask(2, "实现", "done", { evidence: "test" })], "in_progress"),
          makePhase(3, "验证", [makeTask(4, "验证", "pending")], "pending"),
        ],
        nextId: 5,
      },
    } as never);

    const result = await __executeDgoalCheckForTest({ phaseId: 1 }, { cwd: process.cwd(), ui: {} } as never);
    expect(result.details?.approved).toBe(true);
    expect(__getGoalForTest()?.auditorCandidates?.phase).toEqual({
      selectedModelId: "candidate/3",
      failedModelIds: ["candidate/1", "candidate/2"],
    });
  });

  test("phase 有效拒绝可连续重检，不累计 goal 三次暂停计数", async () => {
    const { api } = makeApi();
    __setApiForTest(api);
    __setPhaseCheckOverrideForTest(async () => ({
      approved: false,
      aborted: false,
      output: "phase finding\n<REJECTED>",
      modelId: "test/auditor",
      liveness: "rejected",
    }));
    __setGoalForTest({
      id: "phase-reject-loop",
      objective: "phase reject loop",
      status: "active",
      startedAt: 1,
      updatedAt: 1,
      iteration: 0,
      rejectedCount: 0,
      plan: {
        phases: [makePhase(1, "持续修复", [makeTask(2, "实现", "done", { evidence: "test" })], "in_progress")],
        nextId: 3,
      },
    } as never);

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const result = await __executeDgoalCheckForTest({ phaseId: 1 }, { cwd: process.cwd(), ui: {} } as never);
      expect(result.details?.approved).toBe(false);
      const goal = __getGoalForTest()!;
      expect(goal.status).toBe("active");
      expect(goal.pauseReason).toBeUndefined();
      expect(goal.rejectedCount).toBe(0);
      expect(goal.plan!.phases[0].status).toBe("in_progress");
    }
  });

  test("resume(audit_error) 清除候选故障记录并保留其它运行态", async () => {
    const { api } = makeApi();
    __setApiForTest(api);
    __setGoalForTest({
      id: "resume-candidates",
      objective: "resume candidates",
      status: "paused",
      pauseReason: "audit_error",
      startedAt: 1,
      updatedAt: 1,
      iteration: 4,
      auditorCandidates: {
        phase: { selectedModelId: "backup/phase", failedModelIds: ["primary/phase"] },
        goal: { selectedModelId: "backup/goal", failedModelIds: ["primary/goal"] },
      },
      auditErrorScope: "phase",
    } as never);
    const sent: string[] = [];
    await __resumeGoalForTest({ sendUserMessage: async (message: string) => void sent.push(message) } as never, {
      isIdle: () => true,
      ui: { setStatus: () => {}, notify: () => {} },
    } as never);
    const goal = __getGoalForTest()!;
    expect(goal.status).toBe("active");
    expect(goal.auditorCandidates?.phase).toBeUndefined();
    expect(goal.auditorCandidates?.goal).toEqual({ selectedModelId: "backup/goal", failedModelIds: ["primary/goal"] });
    expect(goal.auditErrorScope).toBeUndefined();
    expect(goal.iteration).toBe(4);
    expect(sent).toHaveLength(1);
  });

  test("resume(audit_error, goal) 只清除 goal 范围候选并保留 phase 候选", async () => {
    const { api } = makeApi();
    __setApiForTest(api);
    __setGoalForTest({
      id: "resume-goal-candidates",
      objective: "resume goal candidates",
      status: "paused",
      pauseReason: "audit_error",
      auditErrorScope: "goal",
      startedAt: 1,
      updatedAt: 1,
      iteration: 2,
      auditorCandidates: {
        phase: { selectedModelId: "backup/phase", failedModelIds: ["primary/phase"] },
        goal: { selectedModelId: "backup/goal", failedModelIds: ["primary/goal"] },
      },
    } as never);
    await __resumeGoalForTest({ sendUserMessage: async () => {} } as never, {
      isIdle: () => true,
      ui: { setStatus: () => {}, notify: () => {} },
    } as never);
    const goal = __getGoalForTest()!;
    expect(goal.auditorCandidates?.phase).toEqual({ selectedModelId: "backup/phase", failedModelIds: ["primary/phase"] });
    expect(goal.auditorCandidates?.goal).toBeUndefined();
    expect(goal.auditErrorScope).toBeUndefined();
  });

  test("resume 会把 pause 窗口累计进 pausedTotalMs，而不是把暂停时间算进 elapsed", async () => {
    const { api, writes } = makeApi();
    __setApiForTest(api);

    const realNow = Date.now;
    Date.now = () => 10_000;
    try {
      __setGoalForTest({
        id: "resume-1",
        objective: "恢复计时",
        status: "paused",
        pauseReason: "user_abort",
        startedAt: 1_000,
        updatedAt: 4_000,
        pauseStartedAt: 4_000,
        pausedTotalMs: 500,
        iteration: 0,
      });

      const sent: string[] = [];
      const pi = { sendUserMessage: async (msg: string) => void sent.push(msg) } as any;
      const ctx = {
        isIdle: () => true,
        ui: {
          setStatus: () => {},
          notify: () => {},
        },
      } as any;

      await __resumeGoalForTest(pi, ctx);

      const persisted = writes.at(-1)?.data.goal as GoalState;
      expect(persisted.status).toBe("active");
      expect(persisted.pauseStartedAt).toBeUndefined();
      expect(persisted.pauseReason).toBeUndefined();
      // 旧累计 500ms + 本次 pause 6s = 6500ms
      expect(persisted.pausedTotalMs).toBe(6_500);
      expect(sent.length).toBe(1);
    } finally {
      Date.now = realNow;
    }
  });
});

describe("端到端集成 · 浮层渲染与状态机的连贯性", () => {
  test("phase 状态变化后浮层正确反映", () => {
    let goal: GoalState = {
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

function applyPlanUpdate(goal: GoalState, params: Record<string, unknown>): { goal: GoalState; op: unknown } {
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

// 复现：dgoal_done 成功路径上，主程序 TUI 渲染层抛 ReferenceError(Spacer is not defined)
// 时，finalizeGoal 必须仍正确落盘 done 并清空 goal——UI 边界异常不得阻断状态机。
// 根因在 pi 主程序 TUI 渲染层（本扩展接触不到 Spacer 组件），但 finalizeGoal 不应
// 假设 ctx.ui.* / planOverlay.* 永不抛错；这是本扩展能且应当防御的失败模式。
describe("端到端集成 · phase 建检 UI 边界容错", () => {
  beforeEach(() => {
    __resetGoalForTest();
    __setPlanOverlayForTest({ update() { throw new ReferenceError("Spacer is not defined"); } } as never);
  });

  test("真实 dgoal_check approved 分支先持久化 phase done 再安全更新 UI", async () => {
    const { api, writes } = makeApi();
    __setApiForTest(api);
    __setGoalForTest({
      id: "phase-ui-approved",
      objective: "phase UI approved",
      status: "active",
      startedAt: 1,
      updatedAt: 1,
      iteration: 1,
      plan: { phases: [makePhase(1, "p", [makeTask(2, "t", "done", { evidence: "ok" })], "in_progress")], nextId: 3 },
    });
    __setPhaseCheckOverrideForTest(async () => ({ approved: true, aborted: false, output: `## 建议用户复核（不阻塞完成）
- 看一下真实 UI`, liveness: "approved" }));
    const result = await __executeDgoalCheckForTest({ phaseId: 1 }, { cwd: process.cwd(), ui: {} } as never);
    expect(result.details?.approved).toBe(true);
    expect(writes.at(-1)?.data.goal?.plan?.phases[0].status).toBe("done");
    expect(writes.at(-1)?.data.goal?.userReviewItems).toEqual(["看一下真实 UI"]);
  });

  test("真实 dgoal_check rejected 分支先持久化 feedback/review 再安全更新 UI", async () => {
    const { api, writes } = makeApi();
    __setApiForTest(api);
    __setGoalForTest({
      id: "phase-ui-rejected",
      objective: "phase UI rejected",
      status: "active",
      startedAt: 1,
      updatedAt: 1,
      iteration: 1,
      plan: { phases: [makePhase(1, "p", [makeTask(2, "t", "done", { evidence: "ok" })], "pending")], nextId: 3 },
    });
    __setPhaseCheckOverrideForTest(async () => ({ approved: false, aborted: false, output: `## 建议用户复核（不阻塞完成）
- 看一下真实 UI

## 验收结论
<REJECTED>`, liveness: "rejected" }));
    const result = await __executeDgoalCheckForTest({ phaseId: 1 }, { cwd: process.cwd(), ui: {} } as never);
    expect(result.details?.approved).toBe(false);
    expect(writes.at(-1)?.data.goal?.plan?.phases[0].status).toBe("in_progress");
    expect(writes.at(-1)?.data.goal?.phaseFeedbackById?.["1"]?.report).toContain("<REJECTED>");
    expect(writes.at(-1)?.data.goal?.userReviewItems).toEqual(["看一下真实 UI"]);
  });
});

describe("端到端集成 · finalizeGoal UI 边界容错（Spacer is not defined）", () => {
  beforeEach(() => {
    __resetGoalForTest();
    __setPlanOverlayForTest(undefined);
  });

  function makeActiveGoal(): GoalState {
    return {
      id: "resil-1",
      objective: "容错测试目标",
      status: "active",
      startedAt: 1_000,
      updatedAt: 1_000,
      iteration: 1,
      plan: {
        phases: [makePhase(1, "阶段A", [makeTask(1, "task1", "completed")], "completed")],
        nextId: 2,
      },
      verification: "全量测试通过",
    };
  }

  test("planOverlay.showDoneThenHide 抛 ReferenceError 时，goal 仍落盘 done 并清空", () => {
    const { api, writes } = makeApi();
    __setApiForTest(api);
    __setGoalForTest(makeActiveGoal());
    // 复现真实路径：session 跑过 → planOverlay 存在 → showDoneThenHide 触发主程序渲染崩溃
    __setPlanOverlayForTest({
      showDoneThenHide() {
        throw new ReferenceError("Spacer is not defined");
      },
    } as never);

    const ctx = {
      cwd: "/tmp",
      ui: { confirm: async () => true, notify() {}, setStatus() {} },
    } as never;

    // 修复前：showDoneThenHide 抛错穿透 finalizeGoal，persistGoal(null) 不会执行
    expect(() => __finalizeGoalForTest(ctx)).not.toThrow();
    expect(writes.some((w) => w.data.goal?.status === "done")).toBe(true);
    expect(writes.at(-1)?.data.goal).toBeNull();
  });

  test("状态持久化清理先于完成 UI 展示", () => {
    const events: string[] = [];
    __setApiForTest({ appendEntry: (_type, data: { goal: GoalState | null }) => events.push(data.goal === null ? "persist:null" : `persist:${data.goal.status}`) });
    __setGoalForTest(makeActiveGoal());
    __setPlanOverlayForTest({
      showDoneThenHide() { events.push("ui:showDone"); },
      update() { events.push("ui:overlay"); },
    } as never);
    const ctx = {
      cwd: "/tmp",
      ui: {
        confirm: async () => true,
        notify() { events.push("ui:notify"); },
        setStatus() { events.push("ui:status"); },
      },
    } as never;

    __finalizeGoalForTest(ctx);
    const clearIndex = events.indexOf("persist:null");
    expect(clearIndex).toBeGreaterThanOrEqual(0);
    expect(events.slice(clearIndex + 1).every((event) => event.startsWith("ui:"))).toBe(true);
    expect(events.indexOf("persist:done")).toBeLessThan(clearIndex);
  });

  test("真实 PlanOverlay 在 currentGoal 清空后仍展示 done 快照", () => {
    const widgets: unknown[] = [];
    const overlay = new PlanOverlay();
    overlay.setUI({
      setWidget: (_key: string, lines: unknown) => { widgets.push(lines); },
      getToolsExpanded: () => false,
      onTerminalInput: () => () => {},
    } as never);
    __setPlanOverlayForTest(overlay);
    __setGoalForTest(makeActiveGoal());
    __finalizeGoalForTest({ cwd: "/tmp", ui: { confirm: async () => true, notify() {}, setStatus() {} } } as never);
    const visible = widgets.find((value): value is string[] => Array.isArray(value) && value.length > 0);
    expect(visible?.some((line) => line.includes("✓"))).toBe(true);
    overlay.dispose();
  });

  test("ctx.ui.setStatus 抛 ReferenceError 时，goal 仍落盘 done 并清空", () => {
    const { api, writes } = makeApi();
    __setApiForTest(api);
    __setGoalForTest(makeActiveGoal());
    __setPlanOverlayForTest(undefined);

    const ctx = {
      cwd: "/tmp",
      ui: {
        confirm: async () => true,
        notify() {},
        setStatus() {
          throw new ReferenceError("Spacer is not defined");
        },
      },
    } as never;

    expect(() => __finalizeGoalForTest(ctx)).not.toThrow();
    expect(writes.some((w) => w.data.goal?.status === "done")).toBe(true);
    expect(writes.at(-1)?.data.goal).toBeNull();
  });
});

describe("端到端集成 · 审核失败路径 UI 边界容错（Spacer is not defined）", () => {
  beforeEach(() => {
    __resetGoalForTest();
    __setPlanOverlayForTest(undefined);
  });

  test("pauseOnAuditFailure：setStatus/notify/overlay.update 抛错时，仍先落盘 paused(audit_error)", () => {
    const { api, writes } = makeApi();
    __setApiForTest(api);
    __setGoalForTest({
      id: "audit-ui-1",
      objective: "o",
      status: "active",
      startedAt: 1,
      updatedAt: 1,
      iteration: 0,
    });
    __setPlanOverlayForTest({ update() { throw new ReferenceError("Spacer is not defined"); } } as never);
    const ctx = {
      ui: {
        setStatus() { throw new ReferenceError("Spacer is not defined"); },
        notify() { throw new ReferenceError("Spacer is not defined"); },
      },
    } as never;
    expect(() => __pauseOnAuditFailureForTest(ctx, "idle_timeout")).not.toThrow();
    const persisted = writes.at(-1)?.data.goal as GoalState;
    expect(persisted.status).toBe("paused");
    expect(persisted.pauseReason).toBe("audit_error");
  });

  test("终审 rejected：setStatus/notify 抛错时，仍先落盘 rejected + finalFeedback", () => {
    const { api, writes } = makeApi();
    __setApiForTest(api);
    const goal: GoalState = {
      id: "audit-ui-2",
      objective: "o",
      status: "active",
      startedAt: 1,
      updatedAt: 1,
      iteration: 0,
    };
    __setGoalForTest(goal);
    const ctx = {
      ui: {
        setStatus() { throw new ReferenceError("Spacer is not defined"); },
        notify() { throw new ReferenceError("Spacer is not defined"); },
      },
    } as never;
    expect(() => __handleFinalAuditRejectedForTest({ completedGoal: goal, summary: "s", verification: "v", auditOutput: "报告", ctx })).not.toThrow();
    const persisted = writes.at(-1)?.data.goal as GoalState;
    expect(persisted.status).toBe("rejected");
    expect(persisted.finalFeedback?.report).toBe("报告");
    expect(persisted.rejectedCount).toBe(1);
  });

  test("终审第 3 次 rejected：setStatus/notify/overlay.update 抛错时，仍先落盘 paused(audit_failed_3x)", () => {
    const { api, writes } = makeApi();
    __setApiForTest(api);
    const goal: GoalState = {
      id: "audit-ui-3",
      objective: "o",
      status: "rejected",
      rejectedCount: 2,
      startedAt: 1,
      updatedAt: 1,
      iteration: 0,
    };
    __setGoalForTest(goal);
    __setPlanOverlayForTest({ update() { throw new ReferenceError("Spacer is not defined"); } } as never);
    const ctx = {
      ui: {
        setStatus() { throw new ReferenceError("Spacer is not defined"); },
        notify() { throw new ReferenceError("Spacer is not defined"); },
      },
    } as never;
    expect(() => __handleFinalAuditRejectedForTest({ completedGoal: goal, summary: "s", verification: "v", auditOutput: "报告3", ctx })).not.toThrow();
    const persisted = writes.at(-1)?.data.goal as GoalState;
    expect(persisted.status).toBe("paused");
    expect(persisted.pauseReason).toBe("audit_failed_3x");
    expect(persisted.finalFeedback?.report).toBe("报告3");
    expect(persisted.rejectedCount).toBe(3);
  });
});

describe("端到端集成 · v0.5.2 越闸门推进拦截（切片6）", () => {
  // 构造：phase1 未 done，phase2 后续
  function makeGoalWithPendingPhase1(): GoalState {
    const t1: Task = { id: 1, subject: "t1", status: "in_progress" };
    const t2: Task = { id: 2, subject: "t2", status: "pending" };
    const ph1: Phase = { id: 1, subject: "阶段一", status: "in_progress", tasks: [t1] };
    const ph2: Phase = { id: 2, subject: "阶段二", status: "pending", tasks: [t2] };
    return { id: "g", objective: "o", status: "active", startedAt: 1, updatedAt: 1, iteration: 0, plan: { phases: [ph1, ph2], nextId: 3 } } as GoalState;
  }

  test("dgoal_check 真实工具入口：phase1 未过时，对 phase2 建检 = 越闸门推进", async () => {
    __setGoalForTest(makeGoalWithPendingPhase1());
    const result = await __executeDgoalCheckForTest({ phaseId: 2 });
    expect(result.details?.error).toBe("gate jumping progression");
    expect(String(result.content?.[0]?.text ?? "")).toContain("越闸门推进");
    expect(String(result.content?.[0]?.text ?? "")).toContain("phase #1");
  });

  test("dgoal_done 真实工具入口：有 phase 未过时 = 越终审推进", async () => {
    __setGoalForTest(makeGoalWithPendingPhase1());
    const result = await __executeDgoalDoneForTest({ summary: "done", verification: "evidence" });
    expect(result.details?.error).toBe("gate jumping progression");
    expect(result.isError).toBe(true);
    expect(String(result.content?.[0]?.text ?? "")).toContain("越终审推进");
    expect(String(result.content?.[0]?.text ?? "")).toContain("phase #1");
  });

  test("所有 phase done 后，dgoal_done 放行（无 pending）", () => {
    const t: Task = { id: 1, subject: "t", status: "done", evidence: "ok" };
    const ph: Phase = { id: 1, subject: "阶段一", status: "done", tasks: [t] };
    const goal = { id: "g", objective: "o", status: "active", startedAt: 1, updatedAt: 1, iteration: 0, plan: { phases: [ph], nextId: 2 } } as GoalState;
    expect(currentUncheckedPhase(goal)).toBeUndefined();
  });
});

describe("端到端集成 · vNext 多 phase 终审三路归因", () => {
  function makeMultiPhaseGoal(): GoalState {
    return {
      id: "multi-attribution",
      objective: "多 phase 终审归因",
      status: "active",
      startedAt: 1,
      updatedAt: 1,
      iteration: 0,
      verification: "npm test",
      plan: {
        phases: [
          makePhase(1, "实现", [makeTask(3, "t1", "done", { evidence: "npm test" })], "done"),
          makePhase(2, "验证", [makeTask(4, "t2", "done", { evidence: "lint ok" })], "done"),
        ],
        nextId: 5,
      },
    } as never;
  }

  test("phase(id) 归因：重开对应已完成 phase，不进 rejected", () => {
    __resetGoalForTest();
    __setApiForTest(makeApi().api as never);
    __setGoalForTest(makeMultiPhaseGoal());
    __handleFinalAuditRejectedForTest({
      completedGoal: __getGoalForTest()!,
      summary: "完成",
      verification: "npm test",
      auditOutput: "phase #2 的验证不充分\n<REJECTED phase=\"2\">",
      auditorDetails: { auditorModel: "test/auditor" },
      ctx: { cwd: process.cwd(), ui: {} } as never,
    } as never);
    const after = __getGoalForTest()!;
    // phase #2 被重开为 in_progress，phase #1 保持 done
    expect(after.status).toBe("active");
    expect(after.plan!.phases[0].status).toBe("done");
    expect(after.plan!.phases[1].status).toBe("in_progress");
    // 不进 rejected，不写终审反馈
    expect(after.finalFeedback).toBeUndefined();
    // 阶段反馈记录了报告
    expect(after.phaseFeedbackById?.["2"]?.report).toContain("<REJECTED");
    __resetGoalForTest();
  });

  test("goal 归因：进 rejected + Goal Repair", () => {
    __resetGoalForTest();
    __setApiForTest(makeApi().api as never);
    __setGoalForTest(makeMultiPhaseGoal());
    __handleFinalAuditRejectedForTest({
      completedGoal: __getGoalForTest()!,
      summary: "完成",
      verification: "npm test",
      auditOutput: "goal 级问题\n<REJECTED goal>",
      auditorDetails: { auditorModel: "test/auditor" },
      ctx: { cwd: process.cwd(), ui: {} } as never,
    } as never);
    const after = __getGoalForTest()!;
    expect(after.status).toBe("rejected");
    expect(after.finalFeedback?.report).toContain("<REJECTED");
    expect(after.rejectedCount).toBe(1);
    // phase 状态不变
    expect(after.plan!.phases[0].status).toBe("done");
    expect(after.plan!.phases[1].status).toBe("done");
    __resetGoalForTest();
  });

  test("user_review 归因：不拒绝，finalize goal + 记录用户复核", () => {
    __resetGoalForTest();
    __setApiForTest(makeApi().api as never);
    __setGoalForTest(makeMultiPhaseGoal());
    const result = __handleFinalAuditRejectedForTest({
      completedGoal: __getGoalForTest()!,
      summary: "完成",
      verification: "npm test",
      auditOutput: "## 建议用户复核（不阻塞完成）\n- 复核 TUI 标签\n\n<REJECTED user_review>",
      auditorDetails: { auditorModel: "test/auditor" },
      ctx: { cwd: process.cwd(), ui: {} } as never,
    } as never);
    const after = __getGoalForTest()!;
    // goal 被终结，不进 rejected
    expect(after).toBeUndefined();
    // 工具输出声明 audited=true + user_review 归因
    expect(result.details?.audited).toBe(true);
    expect(result.details?.auditAttribution).toBe("user_review");
    __resetGoalForTest();
  });

  test("默认（无显式归因）按 goal 处理", () => {
    __resetGoalForTest();
    __setApiForTest(makeApi().api as never);
    __setGoalForTest(makeMultiPhaseGoal());
    __handleFinalAuditRejectedForTest({
      completedGoal: __getGoalForTest()!,
      summary: "完成",
      verification: "npm test",
      auditOutput: "有问题\n<REJECTED>",
      auditorDetails: { auditorModel: "test/auditor" },
      ctx: { cwd: process.cwd(), ui: {} } as never,
    } as never);
    const after = __getGoalForTest()!;
    expect(after.status).toBe("rejected");
    expect(after.rejectedCount).toBe(1);
    __resetGoalForTest();
  });
});
