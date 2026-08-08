import { beforeEach, describe, expect, test } from "bun:test";
import {
  __getGoalForTest,
  __getPendingProposalForTest,
  __resetGoalForTest,
  __setApiForTest,
  __setCompletionAuditorOverrideForTest,
  __setPhaseCheckOverrideForTest,
  __setProposalSemanticReviewForTest,
  buildPlanContractContext,
  executionPlanTool,
  goalCheckTool,
  goalPlanTool,
  handleDgoalCommand,
  handleStartupGate,
  loadGoal,
  phaseCheckTool,
  registerDgoal,
  stagedPlanTool,
  workCreateTool,
  workUpdateTool,
} from "../index.ts";

type Entry = { type: "custom"; customType: string; data: unknown };

function makeHarness() {
  const entries: Entry[] = [];
  const sent: string[] = [];
  const handlers = new Map<string, Function>();
  let confirmation: "confirm" | "reject" = "confirm";
  let selectionError = false;
  const ctx = {
    cwd: process.cwd(),
    ui: {
      setStatus: () => {}, setWidget: () => {}, notify: () => {},
      getToolsExpanded: () => false, onTerminalInput: () => () => {},
      select: (_title: string, options: string[]) => {
        if (selectionError) throw new Error("Spacer is not defined");
        return confirmation === "confirm" ? options[0] : options[1];
      },
    },
    sessionManager: { getBranch: () => entries },
    isIdle: () => true,
    hasPendingMessages: () => false,
  } as never;
  const pi = {
    registerTool: () => {}, registerCommand: () => {},
    on: (name: string, handler: Function) => handlers.set(name, handler),
    events: { emit: () => {} },
    appendEntry: (customType: string, data: unknown) => entries.push({ type: "custom", customType, data }),
    sendUserMessage: (message: string) => { sent.push(message); },
  } as never;
  registerDgoal(pi);
  return {
    entries, sent, handlers, ctx, pi,
    setConfirmation: (value: "confirm" | "reject") => { confirmation = value; },
    setSelectionError: (value: boolean) => { selectionError = value; },
  };
}

async function execute(tool: { execute: Function }, params: Record<string, unknown>, ctx: unknown) {
  return tool.execute("call", params, undefined, undefined, ctx);
}

const criterion = (name: string) => ({ criterion: name, evidence: `bun test ${name}` });

async function authorizeCurrentUpgrade(harness: ReturnType<typeof makeHarness>) {
  const goal = __getGoalForTest()!;
  await handleDgoalCommand(goal.objective, harness.pi, harness.ctx);
}

async function confirmPending(harness: ReturnType<typeof makeHarness>) {
  await handleStartupGate(harness.pi, harness.ctx, __getGoalForTest()!);
}

beforeEach(() => {
  __resetGoalForTest();
  __setApiForTest(undefined);
  __setProposalSemanticReviewForTest(() => ({ decision: "approve" }));
  __setPhaseCheckOverrideForTest(undefined);
  __setCompletionAuditorOverrideForTest(undefined);
});

describe("ADR 0051 audited Work List profiles", () => {
  test("Goal Check Plan upgrades the same Plan Run, allows zero Phase, and keeps check/update separate", async () => {
    const harness = makeHarness();
    await execute(executionPlanTool, {
      objective: "交付平铺结果",
      description: "同一清单持续推进。",
      items: [{ subject: "完成结果", description: "完成并提供证据。" }],
      phases: [],
    }, harness.ctx);
    const before = __getGoalForTest()!;
    const planRunId = before.contract!.id;

    const unauthorized = await execute(goalPlanTool, {
      objective: before.objective,
      description: before.description,
      verification: "运行定向测试",
      acceptanceCriteria: [criterion("结果可复验")],
      items: [{ subject: "完成结果", description: "完成并提供证据。" }],
      phases: [],
    }, harness.ctx);
    expect(unauthorized.details.error).toBe("no pending goal");
    expect(__getGoalForTest()?.contract?.profile).toBe("execution");

    await authorizeCurrentUpgrade(harness);
    const submitted = await execute(goalPlanTool, {
      objective: before.objective,
      description: before.description,
      verification: "运行定向测试",
      acceptanceCriteria: [criterion("结果可复验")],
      items: [{ subject: "完成结果", description: "完成并提供证据。" }],
      phases: [],
    }, harness.ctx);
    expect(submitted.details).toMatchObject({ profile: "goal_check", phaseCount: 0, startMode: "explicit_confirmation" });
    expect(__getGoalForTest()?.contract?.profile).toBe("execution");
    await confirmPending(harness);

    const active = __getGoalForTest()!;
    expect(active.id).toBe(before.id);
    expect(active.contract?.id).toBe(planRunId);
    expect(active.contract?.profile).toBe("goal_check");
    expect(active.workList?.phases).toEqual([]);
    expect(loadGoal(harness.ctx)?.contract?.profile).toBe("goal_check");

    await execute(workUpdateTool, { target: "item", id: 1, status: "in_progress" }, harness.ctx);
    await execute(workUpdateTool, { target: "item", id: 1, status: "done", evidence: "bun test passed" }, harness.ctx);
    const premature = await execute(workUpdateTool, { target: "goal", status: "done", summary: "完成", verification: "bun test" }, harness.ctx);
    expect(premature.details.error).toBe("goal check required");

    __setCompletionAuditorOverrideForTest(async () => ({ approved: true, output: "<APPROVED>", liveness: "approved", modelId: "test/auditor" }));
    const checked = await execute(goalCheckTool, { summary: "完成", verification: "bun test" }, harness.ctx);
    expect(checked.details).toMatchObject({ approved: true, profile: "goal_check" });
    expect(__getGoalForTest()?.status).toBe("active");
    const done = await execute(workUpdateTool, { target: "goal", status: "done", summary: "完成", verification: "bun test" }, harness.ctx);
    expect(done.details).toMatchObject({ status: "done", profile: "goal_check" });
    expect(__getGoalForTest()).toBeUndefined();
  });

  test("proposal semantic rejection and confirmation rejection leave the active Execution Plan unchanged", async () => {
    const harness = makeHarness();
    await execute(executionPlanTool, {
      objective: "保持原计划",
      description: "拒绝升级时不得丢状态。",
      items: [{ subject: "原任务", description: "保留该任务。" }],
      phases: [],
    }, harness.ctx);
    const before = structuredClone(__getGoalForTest()!);

    __setProposalSemanticReviewForTest(() => ({ decision: "reject", reason: "不可独立验收" }));
    await authorizeCurrentUpgrade(harness);
    const rejected = await execute(goalPlanTool, {
      objective: before.objective,
      description: before.description,
      verification: "人工签字",
      acceptanceCriteria: [criterion("不可接受")],
      items: [{ subject: "替换任务", description: "不应落状态。" }],
      phases: [],
    }, harness.ctx);
    expect(rejected.details.error).toBe("semantic review rejected");
    expect(__getGoalForTest()).toEqual(before);

    __setProposalSemanticReviewForTest(() => ({ decision: "approve" }));
    await authorizeCurrentUpgrade(harness);
    await execute(goalPlanTool, {
      objective: before.objective,
      description: before.description,
      verification: "bun test",
      acceptanceCriteria: [criterion("可验证")],
      items: [{ subject: "替换任务", description: "仍不应落状态。" }],
      phases: [],
    }, harness.ctx);
    harness.setConfirmation("reject");
    await confirmPending(harness);
    expect(__getGoalForTest()).toEqual(before);
  });

  test("pending Staged proposal cannot diverge from the semantically reviewed Phase projection", async () => {
    const harness = makeHarness();
    await execute(executionPlanTool, {
      objective: "保护 Phase 契约投影",
      description: "待确认结构必须等于语义预审结果。",
      items: [],
      phases: [{ subject: "实现", description: "完成实现。", items: [{ subject: "编码", description: "实现功能。" }] }],
    }, harness.ctx);
    const before = structuredClone(__getGoalForTest()!);
    await authorizeCurrentUpgrade(harness);
    await execute(stagedPlanTool, {
      objective: before.objective,
      description: before.description,
      verification: "bun test",
      acceptanceCriteria: [criterion("Goal 通过")],
      phases: [{ subject: "实现", description: "完成实现。", acceptanceCriteria: [criterion("Phase 通过")], items: [{ id: 1, subject: "编码", description: "实现功能。" }] }],
    }, harness.ctx);
    __getPendingProposalForTest()!.proposal.workList.phases[0].acceptanceCriteria = [criterion("篡改后的 Phase 条件")];
    await confirmPending(harness);
    expect(__getGoalForTest()).toEqual(before);
  });

  test("Goal Check → Staged Check preserves terminal Work Items and the frozen Goal contract", async () => {
    const harness = makeHarness();
    await execute(executionPlanTool, {
      objective: "单向提升保障",
      description: "保留完成事实并把剩余工作纳入 Phase。",
      items: [
        { subject: "已完成项", description: "在升级前完成。" },
        { subject: "待完成项", description: "进入 Staged Phase。" },
      ],
      phases: [],
    }, harness.ctx);
    await execute(workUpdateTool, { target: "item", id: 1, status: "in_progress" }, harness.ctx);
    await execute(workUpdateTool, { target: "item", id: 1, status: "done", evidence: "pre-upgrade evidence" }, harness.ctx);
    const planRunId = __getGoalForTest()!.contract!.id;
    const goalCriteria = [criterion("目标契约保持")];
    const nonGoals = ["不替换既有完成事实"];
    const guardrails = ["保持 Work Item ID 稳定"];

    await authorizeCurrentUpgrade(harness);
    await execute(goalPlanTool, {
      objective: "单向提升保障",
      description: "保留完成事实并把剩余工作纳入 Phase。",
      verification: "bun test",
      acceptanceCriteria: goalCriteria,
      nonGoals,
      guardrails,
      phases: [],
    }, harness.ctx);
    await confirmPending(harness);
    expect(__getGoalForTest()?.workList?.items[0]).toMatchObject({ id: 1, status: "done", evidence: "pre-upgrade evidence" });

    await authorizeCurrentUpgrade(harness);
    const changed = await execute(stagedPlanTool, {
      objective: "单向提升保障",
      description: "保留完成事实并把剩余工作纳入 Phase。",
      verification: "bun test",
      acceptanceCriteria: [criterion("擅自改变契约")],
      nonGoals,
      guardrails,
      phases: [{ subject: "剩余阶段", description: "完成剩余工作。", acceptanceCriteria: [criterion("阶段通过")], items: [{ id: 2, subject: "待完成项", description: "进入 Staged Phase。" }] }],
    }, harness.ctx);
    expect(changed.details.error).toBe("frozen goal contract changed");
    expect(__getGoalForTest()?.contract?.profile).toBe("goal_check");

    await authorizeCurrentUpgrade(harness);
    const changedBoundary = await execute(stagedPlanTool, {
      objective: "单向提升保障",
      description: "保留完成事实并把剩余工作纳入 Phase。",
      verification: "bun test",
      acceptanceCriteria: goalCriteria,
      nonGoals: ["擅自改动 nonGoals"],
      guardrails,
      phases: [{ subject: "剩余阶段", description: "完成剩余工作。", acceptanceCriteria: [criterion("阶段通过")], items: [{ id: 2, subject: "待完成项", description: "进入 Staged Phase。" }] }],
    }, harness.ctx);
    expect(changedBoundary.details.error).toBe("frozen goal contract changed");

    __setProposalSemanticReviewForTest(() => ({
      decision: "rewrite",
      acceptanceCriteria: [criterion("reviewer 擅自改写冻结条件")],
      phaseAcceptanceCriteria: [[criterion("阶段通过")]],
      userReviewItems: ["原冻结条件改为人工复核"],
      migratedUserReviewItems: [{ sourceCriterion: "目标契约保持", userReviewItem: "原冻结条件改为人工复核" }],
    }));
    await authorizeCurrentUpgrade(harness);
    const semanticRewrite = await execute(stagedPlanTool, {
      objective: "单向提升保障",
      description: "保留完成事实并把剩余工作纳入 Phase。",
      verification: "bun test",
      acceptanceCriteria: goalCriteria,
      nonGoals,
      guardrails,
      phases: [{ subject: "剩余阶段", description: "完成剩余工作。", acceptanceCriteria: [criterion("阶段通过")], items: [{ id: 2, subject: "待完成项", description: "进入 Staged Phase。" }] }],
    }, harness.ctx);
    expect(semanticRewrite.details.error).toBe("frozen goal contract changed during semantic review");
    expect(__getGoalForTest()?.contract).toMatchObject({ profile: "goal_check", acceptanceCriteria: goalCriteria, nonGoals, guardrails });
    __setProposalSemanticReviewForTest(() => ({ decision: "approve" }));

    await authorizeCurrentUpgrade(harness);
    await execute(stagedPlanTool, {
      objective: "单向提升保障",
      description: "保留完成事实并把剩余工作纳入 Phase。",
      verification: "bun test",
      acceptanceCriteria: goalCriteria,
      nonGoals,
      guardrails,
      phases: [{ subject: "剩余阶段", description: "完成剩余工作。", acceptanceCriteria: [criterion("阶段通过")], items: [{ id: 2, subject: "待完成项", description: "进入 Staged Phase。" }] }],
    }, harness.ctx);
    __getPendingProposalForTest()!.proposal.acceptanceCriteria = [criterion("待确认提案被篡改")];
    await confirmPending(harness);
    expect(__getGoalForTest()?.contract).toMatchObject({ profile: "goal_check", acceptanceCriteria: goalCriteria, nonGoals, guardrails });

    await authorizeCurrentUpgrade(harness);
    await execute(stagedPlanTool, {
      objective: "单向提升保障",
      description: "保留完成事实并把剩余工作纳入 Phase。",
      verification: "bun test",
      acceptanceCriteria: goalCriteria,
      nonGoals,
      guardrails,
      phases: [{ subject: "剩余阶段", description: "完成剩余工作。", acceptanceCriteria: [criterion("阶段通过")], items: [{ id: 2, subject: "待完成项", description: "进入 Staged Phase。" }] }],
    }, harness.ctx);
    const profileTamper = __getPendingProposalForTest()!.proposal;
    profileTamper.assuranceProfile = "goal_check";
    profileTamper.objective = "篡改后的目标";
    profileTamper.acceptanceCriteria = [criterion("篡改后的条件")];
    await confirmPending(harness);
    expect(__getGoalForTest()?.contract).toMatchObject({ profile: "goal_check", acceptanceCriteria: goalCriteria, nonGoals, guardrails });

    await authorizeCurrentUpgrade(harness);
    await execute(stagedPlanTool, {
      objective: "单向提升保障",
      description: "保留完成事实并把剩余工作纳入 Phase。",
      verification: "bun test",
      acceptanceCriteria: goalCriteria,
      nonGoals,
      guardrails,
      phases: [{ subject: "剩余阶段", description: "完成剩余工作。", acceptanceCriteria: [criterion("阶段通过")], items: [{ id: 2, subject: "待完成项", description: "进入 Staged Phase。" }] }],
    }, harness.ctx);
    await confirmPending(harness);
    const staged = __getGoalForTest()!;
    expect(staged.contract).toMatchObject({ id: planRunId, profile: "staged_check", acceptanceCriteria: goalCriteria, nonGoals, guardrails });
    expect(staged.workList?.items[0]).toMatchObject({ id: 1, status: "done", evidence: "pre-upgrade evidence" });
    expect(staged.workList?.phases[0].items[0]).toMatchObject({ id: 2, status: "pending" });
  });

  test("confirmation UI failure restores the pending proposal without changing the active Plan", async () => {
    const harness = makeHarness();
    await execute(executionPlanTool, {
      objective: "UI fail-soft",
      description: "展示失败不改变业务状态。",
      items: [{ subject: "工作", description: "保留当前状态。" }],
      phases: [],
    }, harness.ctx);
    const planRunId = __getGoalForTest()!.contract!.id;
    await authorizeCurrentUpgrade(harness);
    await execute(goalPlanTool, {
      objective: "UI fail-soft",
      description: "展示失败不改变业务状态。",
      verification: "bun test",
      acceptanceCriteria: [criterion("业务状态正确")],
      phases: [],
    }, harness.ctx);
    harness.setSelectionError(true);
    await confirmPending(harness);
    expect(__getGoalForTest()?.contract).toMatchObject({ id: planRunId, profile: "execution" });
    harness.setSelectionError(false);
    await confirmPending(harness);
    expect(__getGoalForTest()?.contract).toMatchObject({ id: planRunId, profile: "goal_check" });
  });

  test("Staged Check Plan enforces serial Phase checks and explicit Phase completion", async () => {
    const harness = makeHarness();
    await execute(executionPlanTool, {
      objective: "分阶段交付",
      description: "两个阶段严格串行。",
      items: [],
      phases: [
        { subject: "阶段一", description: "先完成基础。", items: [{ subject: "基础", description: "实现基础。" }] },
        { subject: "阶段二", description: "再完成集成。", items: [{ subject: "集成", description: "完成集成。", blockedBy: [1] }] },
      ],
    }, harness.ctx);
    const before = __getGoalForTest()!;
    await authorizeCurrentUpgrade(harness);
    await execute(stagedPlanTool, {
      objective: before.objective,
      description: before.description,
      verification: "全量测试通过",
      acceptanceCriteria: [criterion("端到端通过")],
      phases: [
        { subject: "阶段一", description: "先完成基础。", acceptanceCriteria: [criterion("基础通过")], items: [{ subject: "基础", description: "实现基础。" }] },
        { subject: "阶段二", description: "再完成集成。", acceptanceCriteria: [criterion("集成通过")], items: [{ subject: "集成", description: "完成集成。", blockedBy: [1] }] },
      ],
    }, harness.ctx);
    await confirmPending(harness);
    expect(__getGoalForTest()?.contract?.profile).toBe("staged_check");

    const rootBeforePhasesDone = await execute(workCreateTool, {
      target: "item", subject: "越过阶段的根工作", description: "不应绕过逐阶段建检。",
    }, harness.ctx);
    expect(rootBeforePhasesDone.details.error).toBe("staged root item requires completed phases");

    const outOfOrder = await execute(phaseCheckTool, { phaseId: 2 }, harness.ctx);
    expect(outOfOrder.details.error).toBe("phase order violation");
    await execute(workUpdateTool, { target: "phase", id: 1, status: "in_progress" }, harness.ctx);
    await execute(workUpdateTool, { target: "item", id: 1, status: "in_progress" }, harness.ctx);
    await execute(workUpdateTool, { target: "item", id: 1, status: "done", evidence: "phase one test" }, harness.ctx);
    expect(__getGoalForTest()?.workList?.phases[0].status).toBe("in_progress");
    const beforeCheckDone = await execute(workUpdateTool, { target: "phase", id: 1, status: "done" }, harness.ctx);
    expect(beforeCheckDone.details.error).toBe("phase check required");

    __setPhaseCheckOverrideForTest(async () => ({ approved: true, output: "<APPROVED>", liveness: "approved" }));
    const phaseOneCheck = await execute(phaseCheckTool, { phaseId: 1 }, harness.ctx);
    expect(phaseOneCheck.details.approved).toBe(true);
    expect(__getGoalForTest()?.workList?.phases[0].status).toBe("in_progress");
    const checkedRevision = __getGoalForTest()!.workList!.phases[0].revision!;
    await execute(workUpdateTool, { target: "phase", id: 1, status: "blocked", blockedReason: "复核期间发现阻塞" }, harness.ctx);
    expect(__getGoalForTest()?.workList?.phases[0].check).toBeUndefined();
    expect(__getGoalForTest()?.workList?.phases[0].revision).toBe(checkedRevision + 1);
    await execute(workUpdateTool, { target: "phase", id: 1, status: "in_progress" }, harness.ctx);
    await execute(phaseCheckTool, { phaseId: 1 }, harness.ctx);
    await execute(workUpdateTool, { target: "phase", id: 1, status: "done" }, harness.ctx);

    await execute(workUpdateTool, { target: "phase", id: 2, status: "in_progress" }, harness.ctx);
    await execute(workUpdateTool, { target: "item", id: 2, status: "in_progress" }, harness.ctx);
    await execute(workUpdateTool, { target: "item", id: 2, status: "done", evidence: "phase two test" }, harness.ctx);
    await execute(phaseCheckTool, { phaseId: 2 }, harness.ctx);
    await execute(workUpdateTool, { target: "phase", id: 2, status: "done" }, harness.ctx);

    const approvedCheck = structuredClone(__getGoalForTest()!.workList!.phases[0].check);
    const mutateDone = await execute(workUpdateTool, { target: "phase", id: 1, description: "不应改写完成阶段。" }, harness.ctx);
    expect(mutateDone.details.error).toBe("phase already done");
    expect(__getGoalForTest()?.workList?.phases[0].check).toEqual(approvedCheck);

    __setCompletionAuditorOverrideForTest(async () => ({ approved: true, output: "<APPROVED>", liveness: "approved" }));
    await execute(goalCheckTool, { summary: "两阶段完成", verification: "bun test" }, harness.ctx);
    const done = await execute(workUpdateTool, { target: "goal", status: "done", summary: "两阶段完成", verification: "bun test" }, harness.ctx);
    expect(done.details).toMatchObject({ status: "done", profile: "staged_check" });
  });

  test("rejected goal feedback survives repairs and a late Phase audit cannot cross a local revision", async () => {
    const harness = makeHarness();
    await execute(executionPlanTool, {
      objective: "修复并隔离迟到审核",
      description: "保留最新反馈并隔离旧 revision。",
      items: [],
      phases: [{ subject: "唯一阶段", description: "完成后独立审核。", items: [{ subject: "实现", description: "实现并验证。" }] }],
    }, harness.ctx);
    const base = __getGoalForTest()!;
    await authorizeCurrentUpgrade(harness);
    await execute(stagedPlanTool, {
      objective: base.objective,
      description: base.description,
      verification: "bun test",
      acceptanceCriteria: [criterion("目标通过")],
      phases: [{ subject: "唯一阶段", description: "完成后独立审核。", acceptanceCriteria: [criterion("阶段通过")], items: [{ subject: "实现", description: "实现并验证。" }] }],
    }, harness.ctx);
    await confirmPending(harness);
    await execute(workUpdateTool, { target: "phase", id: 1, status: "in_progress" }, harness.ctx);
    await execute(workUpdateTool, { target: "item", id: 1, status: "in_progress" }, harness.ctx);
    await execute(workUpdateTool, { target: "item", id: 1, status: "done", evidence: "bun test" }, harness.ctx);

    let resolveAudit!: (value: { approved: boolean; output: string; liveness: "approved" }) => void;
    __setPhaseCheckOverrideForTest(() => new Promise((resolve) => { resolveAudit = resolve; }));
    const pending = execute(phaseCheckTool, { phaseId: 1 }, harness.ctx);
    await Promise.resolve();
    await execute(workUpdateTool, { target: "phase", id: 1, description: "审核期间修订阶段说明。" }, harness.ctx);
    resolveAudit({ approved: true, output: "<APPROVED>", liveness: "approved" });
    const stale = await pending;
    expect(stale.details).toMatchObject({ stale: true, error: "plan changed during check" });
    expect(__getGoalForTest()?.workList?.phases[0].check).toBeUndefined();

    __setPhaseCheckOverrideForTest(async () => ({ approved: true, output: "<APPROVED>", liveness: "approved" }));
    await execute(phaseCheckTool, { phaseId: 1 }, harness.ctx);
    await execute(workUpdateTool, { target: "phase", id: 1, status: "done" }, harness.ctx);
    __setCompletionAuditorOverrideForTest(async () => ({ approved: false, output: "缺少端到端证据", liveness: "rejected" }));
    await execute(goalCheckTool, { summary: "完成", verification: "当前证据" }, harness.ctx);
    expect(__getGoalForTest()?.contract?.finalFeedback?.report).toContain("缺少端到端证据");
    expect(buildPlanContractContext(__getGoalForTest()!)).toContain("缺少端到端证据");

    const followUp = await execute(workCreateTool, { target: "item", subject: "补端到端证据", description: "补齐终审要求的证据。" }, harness.ctx);
    expect(followUp.details.error).toBeUndefined();
    expect(__getGoalForTest()?.contract?.goalCheck).toBeUndefined();
    expect(__getGoalForTest()?.contract?.finalFeedback?.report).toContain("缺少端到端证据");
    expect(loadGoal(harness.ctx)?.workList?.items).toContainEqual(expect.objectContaining({ subject: "补端到端证据", status: "pending" }));
  });
});
