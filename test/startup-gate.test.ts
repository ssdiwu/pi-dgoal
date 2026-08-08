// Goal Check / Staged Check 启动闸门、结构校验、语义预审与确认 UI 回归。
import { describe, expect, test } from "bun:test";

import {
  __executePlanProposalForTest as executeRawPlanProposalForTest,
  __getPendingProposalForTest,
  __handleProposalConfirmationForTest,
  __resetGoalForTest,
  __setGoalForTest,
  __setI18nForTest,
  __setProposalSemanticCompletionForTest,
  __setProposalSemanticReviewForTest,
  __setProposalSemanticReviewTimeoutForTest,
  __setProposalSemanticStreamForTest,
  assessProposalReadiness as assessProposalReadinessRaw,
  buildProposalConfirmationOptions,
  buildProposePrompt,
  formatProposalConfirmTitle,
  formatProposalForConfirm,
  validateProposalInput as validateProposalInputRaw,
  type AcceptanceCriterion,
  type AssistantMessageEventLike,
  type GoalState,
  type PlanProposal,
  type WorkItem,
  type WorkList,
} from "../index.ts";

const criteria: AcceptanceCriterion[] = [{ criterion: "测试通过", evidence: "npm test" }];
const approvedReview = { decision: "approve" as const, acceptanceCriteria: criteria, phaseAcceptanceCriteria: [criteria] };

function goal(): GoalState {
  return { id: "g1", objective: "修测试", description: "修复测试并保持既有行为。", status: "pending", startedAt: 1, updatedAt: 1, iteration: 0 };
}

function profileOf(input: Record<string, any>): "goal_check" | "staged_check" {
  return input.assuranceProfile === "goal_check" ? "goal_check" : "staged_check";
}

function validateProposalInput(input: Record<string, any>) {
  return validateProposalInputRaw({ ...input, assuranceProfile: profileOf(input) });
}

function assessProposalReadiness(input: Record<string, any>) {
  return assessProposalReadinessRaw({ ...input, assuranceProfile: profileOf(input) });
}

function describeProposal(params: Record<string, any>): Record<string, any> {
  const objective = String(params.objective ?? "目标");
  const assuranceProfile = profileOf(params);
  let nextItemId = 1;
  const rawPhases = Array.isArray(params.phases) ? params.phases : [];
  const workPhases = rawPhases.map((rawPhase: Record<string, any>, phaseIndex: number) => {
    const rawItems = Array.isArray(rawPhase.items) ? rawPhase.items : Array.isArray(rawPhase.tasks) ? rawPhase.tasks : [];
    const items: WorkItem[] = rawItems.map((rawItem: Record<string, any>, itemIndex: number) => ({
      id: nextItemId++,
      subject: String(rawItem.subject ?? ""),
      description: rawItem.description ?? `第 ${itemIndex + 1} 个 Work Item 推进当前阶段。`,
      status: rawItem.status ?? "pending",
      ...(rawItem.blockedBy ? { blockedBy: rawItem.blockedBy } : {}),
      ...(rawItem.evidence ? { evidence: rawItem.evidence } : {}),
    }));
    return {
      id: phaseIndex + 1,
      subject: String(rawPhase.subject ?? ""),
      description: rawPhase.description ?? `第 ${phaseIndex + 1} 阶段服务于 ${objective}。`,
      status: rawPhase.status ?? "pending",
      revision: 0,
      items,
      ...(assuranceProfile === "staged_check" && rawPhase.acceptanceCriteria ? { acceptanceCriteria: rawPhase.acceptanceCriteria } : {}),
    };
  });
  const rootItems: WorkItem[] = (Array.isArray(params.items) ? params.items : []).map((rawItem: Record<string, any>, index: number) => ({
    id: nextItemId++, subject: String(rawItem.subject ?? ""),
    description: rawItem.description ?? `第 ${index + 1} 个 Work Item 服务于 ${objective}。`, status: rawItem.status ?? "pending",
  }));
  const workList: WorkList = { items: rootItems, phases: workPhases, nextItemId, nextPhaseId: workPhases.length + 1, revision: 0 };
  return {
    ...params,
    objective,
    description: params.description ?? `推进 ${objective} 并保持方法边界。`,
    assuranceProfile,
    workList,
    phases: workPhases.map((phase) => ({
      subject: phase.subject,
      description: phase.description,
      ...(assuranceProfile === "staged_check" ? { acceptanceCriteria: phase.acceptanceCriteria } : {}),
    })),
  };
}

function __executePlanProposalForTest(params: Record<string, any>, ctx?: Record<string, any>, onUpdate?: (update: any) => void) {
  return executeRawPlanProposalForTest(describeProposal(params), ctx, onUpdate);
}

describe("切片4 · validateProposalInput（verification 必填，ADR 0007）", () => {
  test("缺 verification 被拒（no verification）", () => {
    const r = validateProposalInput({ objective: "o", phaseCount: 1 });
    expect(r).not.toBeNull();
    expect(r!.error).toBe("no verification");
    expect(r!.message).toContain("verification");
  });

  test("verification 为空字符串 / 纯空白被拒", () => {
    expect(validateProposalInput({ objective: "o", verification: "   ", acceptanceCriteria: criteria, phaseCount: 1, phaseAcceptanceCriteria: [criteria] })).not.toBeNull();
    expect(validateProposalInput({ objective: "o", verification: "", acceptanceCriteria: criteria, phaseCount: 1, phaseAcceptanceCriteria: [criteria] })).not.toBeNull();
  });

  test("有明确 verification 与 description 通过", () => {
    expect(validateProposalInput({ objective: "o", description: "保持既有行为并补齐验证。", verification: "npm test 全过且 RPC 测试确认命令注册", acceptanceCriteria: criteria, phaseCount: 2, phaseAcceptanceCriteria: [criteria, criteria] })).toBeNull();
  });

  test("缺 description 被拒（no description）", () => {
    expect(validateProposalInput({ objective: "o", verification: "v", acceptanceCriteria: criteria, phaseCount: 1, phaseAcceptanceCriteria: [criteria] })?.error).toBe("no description");
  });

  test("缺 objective 被拒（no objective）", () => {
    const r = validateProposalInput({ objective: "", verification: "v", acceptanceCriteria: criteria, phaseCount: 1, phaseAcceptanceCriteria: [criteria] });
    expect(r!.error).toBe("no objective");
  });

  test("validateProposalInput 的固定错误文案可被英文 i18n 覆盖", () => {
    __setI18nForTest({
      t: (key: string) => key.endsWith(".proposal.validate.noObjective") ? "proposal must include an objective (goal summary)." : undefined,
    });
    try {
      const r = validateProposalInput({ objective: "", verification: "v", acceptanceCriteria: criteria, phaseCount: 1, phaseAcceptanceCriteria: [criteria] });
      expect(r?.message).toBe("proposal must include an objective (goal summary).");
    } finally {
      __setI18nForTest(undefined);
    }
  });

  test("phases 为空被拒（no phases，向后兼容）", () => {
    const r = validateProposalInput({ objective: "o", verification: "v", acceptanceCriteria: criteria, phaseCount: 0, phaseAcceptanceCriteria: [] });
    expect(r!.error).toBe("no phases");
  });
});

describe("提案就绪度评估", () => {
  test("缺少独立验收条件时为 L1，并显式暴露验收与 non-goals 缺口", () => {
    const readiness = assessProposalReadiness({
      objective: "修好 auth 测试",
      verification: "npm test auth 全过",
      phaseCount: 2,
    });
    expect(readiness.level).toBe("L1");
    expect(readiness.gaps).toContain("acceptanceCriteria");
    expect(readiness.gaps).toContain("nonGoals");
    expect(readiness.gaps).toContain("guardrails");
  });

  test("仅补齐边界字段但缺独立验收条件时仍为 L1", () => {
    const readiness = assessProposalReadiness({
      objective: "修好 auth 测试",
      verification: "npm test auth 全过",
      phaseCount: 2,
      nonGoals: ["不重构 i18n 框架"],
      guardrails: ["不改跨会话状态"],
    });
    expect(readiness.level).toBe("L1");
    expect(readiness.gaps).toContain("acceptanceCriteria");
  });
});

describe("验收契约校验", () => {
  test("真实 proposal execute 拒绝计划态 Work List 中缺失的 Phase/Work Item description", async () => {
    __setGoalForTest(goal());
    __setProposalSemanticReviewForTest(() => ({ decision: "approve" }));
    const base = describeProposal({ objective: "o", description: "goal desc", verification: "v", acceptanceCriteria: criteria, phases: [{ subject: "p", description: "phase desc", acceptanceCriteria: criteria, tasks: [{ subject: "t", description: "item desc" }] }] });
    const missingPhase = structuredClone(base);
    missingPhase.workList.phases[0].description = "";
    expect((await executeRawPlanProposalForTest(missingPhase)).details.error).toBe("invalid proposed work list");
    const missingItem = structuredClone(base);
    missingItem.workList.phases[0].items[0].description = "";
    expect((await executeRawPlanProposalForTest(missingItem)).details.error).toBe("invalid proposed work list");
  });

  test("真实 proposal execute 拒绝混合空 criterion/evidence", async () => {
    __resetGoalForTest();
    __setGoalForTest({ id: "pending", objective: "o", status: "pending", startedAt: 1, updatedAt: 1, iteration: 0 });
    const result = await __executePlanProposalForTest({
      objective: "o",
      verification: "v",
      acceptanceCriteria: criteria,
      phases: [{ subject: "p", acceptanceCriteria: [...criteria, { criterion: " ", evidence: "npm test" }] }],
    });
    expect(result.details?.error).toBe("no acceptance criteria");
    __resetGoalForTest();
  });

  test("goal 或任一 phase 缺少独立验收条件时拒绝提案", () => {
    expect(validateProposalInput({ objective: "o", verification: "v", phaseCount: 1, phaseAcceptanceCriteria: [criteria] })?.error).toBe("no acceptance criteria");
    expect(validateProposalInput({ objective: "o", verification: "v", acceptanceCriteria: criteria, phaseCount: 1, phaseAcceptanceCriteria: [undefined] })?.error).toBe("no acceptance criteria");
  });

  test("人工复核项不替代独立验收条件", () => {
    expect(validateProposalInput({ objective: "o", verification: "v", phaseCount: 1, phaseAcceptanceCriteria: [undefined] })?.message).toContain("userReviewItems");
  });

  test("criterion 或 evidence 为空时拒绝混合脏条件", () => {
    expect(validateProposalInput({ objective: "o", verification: "v", acceptanceCriteria: [...criteria, { criterion: " ", evidence: "npm test" }], phaseCount: 1, phaseAcceptanceCriteria: [criteria] })?.error).toBe("no acceptance criteria");
    expect(validateProposalInput({ objective: "o", verification: "v", acceptanceCriteria: criteria, phaseCount: 1, phaseAcceptanceCriteria: [[{ criterion: "完成", evidence: " " }]] })?.error).toBe("no acceptance criteria");
  });

  test("非空 evidence 不靠魔法词过结构门并进入 LLM 语义预审", async () => {
    const evidenceWithoutMagicWords = [{ criterion: "Work Item 状态可读取", evidence: "work_read 的工具返回" }];
    expect(validateProposalInput({
      objective: "o", description: "验证工具返回，不扩张范围。", verification: "v", acceptanceCriteria: evidenceWithoutMagicWords,
      phaseCount: 1, phaseAcceptanceCriteria: [undefined], assuranceProfile: "goal_check",
    })).toBeNull();

    __resetGoalForTest();
    __setGoalForTest({ id: "pending-evidence-semantics", objective: "o", status: "pending", startedAt: 1, updatedAt: 1, iteration: 0 });
    let reviewCalls = 0;
    __setProposalSemanticReviewForTest(() => {
      reviewCalls += 1;
      return { decision: "approve" };
    });
    const result = await __executePlanProposalForTest({
      objective: "o", assuranceProfile: "goal_check", verification: "v",
      acceptanceCriteria: evidenceWithoutMagicWords,
      phases: [{ subject: "p", tasks: [{ subject: "t" }] }],
    });
    expect(result.details?.error).toBeUndefined();
    expect(reviewCalls).toBe(1);
    __resetGoalForTest();
  });

  test("语义预审 rewrite 可返回不含魔法词但非空的 evidence", async () => {
    __resetGoalForTest();
    __setGoalForTest({ id: "pending-rewrite-evidence-semantics", objective: "o", status: "pending", startedAt: 1, updatedAt: 1, iteration: 0 });
    __setProposalSemanticReviewForTest(() => ({
      decision: "rewrite",
      acceptanceCriteria: [{ criterion: "Work Item 状态可读取", evidence: "work_read 的工具返回" }],
      migratedUserReviewItems: [{ sourceCriterion: "由甲方验收并签字认可", userReviewItem: "甲方签字属于完成后的人工复核" }],
    }));
    const result = await __executePlanProposalForTest({
      objective: "o", assuranceProfile: "goal_check", verification: "v",
      acceptanceCriteria: [{ criterion: "由甲方验收并签字认可", evidence: "npm test" }],
      phases: [{ subject: "p", tasks: [{ subject: "t" }] }],
    });
    expect(result.details?.error).toBeUndefined();
    expect(__getPendingProposalForTest()?.proposal.acceptanceCriteria?.[0].evidence).toBe("work_read 的工具返回");
    __resetGoalForTest();
  });

  test("语义预审拒绝人工 criterion + 合法 evidence，且不写入 pendingProposal", async () => {
    __resetGoalForTest();
    __setGoalForTest({ id: "pending-semantic-reject", objective: "o", status: "pending", startedAt: 1, updatedAt: 1, iteration: 0 });
    __setProposalSemanticReviewForTest(() => ({ decision: "reject", reason: "criterion requires stakeholder sign-off" }));
    const result = await __executePlanProposalForTest({
      objective: "o",
      verification: "npm test",
      acceptanceCriteria: [{ criterion: "由甲方验收并签字认可", evidence: "npm test 通过" }],
      phases: [{ subject: "p", acceptanceCriteria: [criteria[0]] }],
    });
    expect(result.details?.error).toBe("semantic review rejected");
    expect(__getPendingProposalForTest()).toBeUndefined();
    __resetGoalForTest();
  });

  test("语义预审拒绝依赖不可获取历史证据的条件，且不写入 pendingProposal", async () => {
    __resetGoalForTest();
    __setGoalForTest({ id: "pending-unavailable-history-evidence", objective: "o", status: "pending", startedAt: 1, updatedAt: 1, iteration: 0 });
    __setProposalSemanticReviewForTest((_proposal, prompt) => {
      expect(prompt).toContain("independently obtainable by the future auditor");
      expect(prompt).toContain("unverifiable historical negative claim");
      expect(prompt).toContain("unexported access log");
      expect(prompt).toContain("agent, worker, or user memory");
      return { decision: "reject", reason: "The claimed historical non-access cannot be independently verified from admissible evidence." };
    });
    const result = await __executePlanProposalForTest({
      objective: "o",
      verification: "检查来源记录",
      acceptanceCriteria: [{ criterion: "没有任何实现者曾打开受限上游文件", evidence: "worker 的自述与未导出的访问日志" }],
      phases: [{ subject: "p", acceptanceCriteria: [criteria[0]] }],
    });
    expect(result.details?.error).toBe("semantic review rejected");
    expect(result.details?.reason).toContain("historical non-access");
    expect(__getPendingProposalForTest()).toBeUndefined();
    __resetGoalForTest();
  });

  test("语义预审一次投影全部不可准入条件，并保持旧 reject 状态边界", async () => {
    __resetGoalForTest();
    __setGoalForTest({ id: "pending-semantic-issues", objective: "o", status: "pending", startedAt: 1, updatedAt: 1, iteration: 0 });
    const historical = "没有任何实现者曾打开受限上游文件";
    const subjective = "双载体视觉气质一致且令人满意";
    const authorPrompt = buildProposePrompt(goal());
    expect(authorPrompt).toContain("项目工件、命令或可观察外部状态");
    expect(authorPrompt).toContain("nonGoals 与 guardrails 约束执行");
    __setProposalSemanticReviewForTest((_proposal, prompt) => {
      expect(prompt).toContain("report every inadmissible criterion");
      return {
        decision: "reject",
        reason: "Two frozen conditions are inadmissible.",
        issues: [
          { sourceCriterion: historical, classification: "unverifiable_evidence", reason: "Past non-access is unavailable to the future auditor.", remedy: "Replace it with current source records and scans." },
          { sourceCriterion: subjective, classification: "human_only", reason: "Visual satisfaction requires human judgment.", remedy: "Move it to userReviewItems." },
        ],
      } as any;
    });
    const result = await __executePlanProposalForTest({
      objective: "o",
      verification: "检查来源记录与样例",
      acceptanceCriteria: [{ criterion: historical, evidence: "未导出的访问日志" }, { criterion: subjective, evidence: "联系表" }],
      phases: [{ subject: "p", acceptanceCriteria: [criteria[0]] }],
    });
    expect(result.details?.error).toBe("semantic review rejected");
    expect(String(result.details?.reason)).toContain(historical);
    expect(String(result.details?.reason)).toContain(subjective);
    expect(result.details?.issues).toEqual([
      { sourceCriterion: historical, classification: "unverifiable_evidence", reason: "Past non-access is unavailable to the future auditor.", remedy: "Replace it with current source records and scans." },
      { sourceCriterion: subjective, classification: "human_only", reason: "Visual satisfaction requires human judgment.", remedy: "Move it to userReviewItems." },
    ]);
    expect(__getPendingProposalForTest()).toBeUndefined();
    __resetGoalForTest();
  });

  test("语义预审从模型 JSON 解析全部 issues 并投影", async () => {
    __resetGoalForTest();
    __setGoalForTest({ id: "pending-semantic-json-issues", objective: "o", status: "pending", startedAt: 1, updatedAt: 1, iteration: 0 });
    const criterion = "没有任何实现者曾打开受限上游文件";
    const issue = { sourceCriterion: criterion, classification: "unverifiable_evidence", reason: "Past non-access is unavailable to the future auditor.", remedy: "Replace it with current source records and scans." };
    __setProposalSemanticCompletionForTest(() => ({
      stopReason: "stop",
      content: [{ type: "text", text: JSON.stringify({ decision: "reject", reason: "Historical evidence is unavailable.", issues: [issue] }) }],
    }));
    const ctx = { model: {}, modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true as const, apiKey: "test" }) } };
    const result = await __executePlanProposalForTest({
      objective: "o",
      verification: "检查来源记录",
      acceptanceCriteria: [{ criterion, evidence: "未导出的访问日志" }],
      phases: [{ subject: "p", acceptanceCriteria: [criteria[0]] }],
    }, ctx);
    expect(result.details?.error).toBe("semantic review rejected");
    expect(result.details?.issues).toEqual([issue]);
    expect(String(result.details?.reason)).toContain(criterion);
    __resetGoalForTest();
  });

  test("语义预审把 goal/phase 混合条件同步改写到冻结 Work List 并合并 userReviewItems", async () => {
    __resetGoalForTest();
    __setGoalForTest({ id: "pending-semantic-rewrite", objective: "o", status: "pending", startedAt: 1, updatedAt: 1, iteration: 0 });
    const rewrittenGoal = { criterion: "Goal 测试命令退出码为 0", evidence: "bun test test/startup-gate.test.ts" };
    const rewrittenPhase = { criterion: "Phase 测试命令退出码为 0", evidence: "bun test test/startup-gate.test.ts" };
    __setProposalSemanticReviewForTest(() => ({
      decision: "rewrite",
      acceptanceCriteria: [rewrittenGoal],
      phaseAcceptanceCriteria: [[rewrittenPhase]],
      userReviewItems: ["甲方签字属于完成后的人工复核", "验收员确认属于完成后的人工复核"],
      migratedUserReviewItems: [
        { sourceCriterion: "由甲方验收并签字认可", userReviewItem: "甲方签字属于完成后的人工复核" },
        { sourceCriterion: "由验收员确认阶段完成", userReviewItem: "验收员确认属于完成后的人工复核" },
      ],
    }));
    const result = await __executePlanProposalForTest({
      objective: "o",
      verification: "bun test test/startup-gate.test.ts",
      acceptanceCriteria: [{ criterion: "由甲方验收并签字认可", evidence: "bun test 通过" }],
      userReviewItems: ["保留原有人工复核项"],
      phases: [{ subject: "p", acceptanceCriteria: [{ criterion: "由验收员确认阶段完成", evidence: "bun test 通过" }] }],
    });
    expect(result.details?.semanticReview).toBe("rewrite");
    const pending = __getPendingProposalForTest();
    expect(pending?.proposal.acceptanceCriteria).toEqual([rewrittenGoal]);
    expect(pending?.proposal.phases[0].acceptanceCriteria).toEqual([rewrittenPhase]);
    expect(pending?.proposal.workList.phases[0].acceptanceCriteria).toEqual([rewrittenPhase]);
    expect(pending?.proposal.userReviewItems).toEqual(["保留原有人工复核项", "甲方签字属于完成后的人工复核", "验收员确认属于完成后的人工复核"]);
    __resetGoalForTest();
  });

  test("语义预审 rewrite 只新增无关复核项时拒绝且不写入 pendingProposal", async () => {
    __resetGoalForTest();
    __setGoalForTest({ id: "pending-semantic-rewrite-unrelated", objective: "o", status: "pending", startedAt: 1, updatedAt: 1, iteration: 0 });
    __setProposalSemanticReviewForTest(() => ({
      decision: "rewrite",
      acceptanceCriteria: [{ criterion: "测试命令退出码为 0", evidence: "bun test test/startup-gate.test.ts" }],
      phaseAcceptanceCriteria: [[{ criterion: "测试命令退出码为 0", evidence: "bun test test/startup-gate.test.ts" }]],
      userReviewItems: ["检查文档排版"],
    }));
    const result = await __executePlanProposalForTest({
      objective: "o",
      verification: "bun test test/startup-gate.test.ts",
      acceptanceCriteria: [{ criterion: "stakeholder signs off", evidence: "bun test 通过" }],
      phases: [{ subject: "p", acceptanceCriteria: [{ criterion: "stakeholder signs off", evidence: "bun test 通过" }] }],
    });
    expect(result.details?.error).toBe("semantic review rejected");
    expect(__getPendingProposalForTest()).toBeUndefined();
    __resetGoalForTest();
  });

  test("语义预审 rewrite 丢失人工条件时拒绝且不写入 pendingProposal", async () => {
    __resetGoalForTest();
    __setGoalForTest({ id: "pending-semantic-rewrite-loss", objective: "o", status: "pending", startedAt: 1, updatedAt: 1, iteration: 0 });
    __setProposalSemanticReviewForTest(() => ({
      decision: "rewrite",
      acceptanceCriteria: [{ criterion: "测试命令退出码为 0", evidence: "bun test test/startup-gate.test.ts" }],
      phaseAcceptanceCriteria: [[{ criterion: "测试命令退出码为 0", evidence: "bun test test/startup-gate.test.ts" }]],
    }));
    const result = await __executePlanProposalForTest({
      objective: "o",
      verification: "bun test test/startup-gate.test.ts",
      acceptanceCriteria: [{ criterion: "stakeholder signs off", evidence: "bun test 通过" }],
      phases: [{ subject: "p", acceptanceCriteria: [{ criterion: "stakeholder signs off", evidence: "bun test 通过" }] }],
    });
    expect(result.details?.error).toBe("semantic review rejected");
    expect(__getPendingProposalForTest()).toBeUndefined();
    __resetGoalForTest();
  });

  test("语义预审 rewrite 跨层搬移人工条件时拒绝且不写入 pendingProposal", async () => {
    __resetGoalForTest();
    __setGoalForTest({ id: "pending-semantic-rewrite-crosslayer", objective: "o", status: "pending", startedAt: 1, updatedAt: 1, iteration: 0 });
    // 将 goal 层人工条件搬到 phase 层，不提供迁移项 → 展平比较会漏，按层比较应拒绝。
    __setProposalSemanticReviewForTest(() => ({
      decision: "rewrite",
      acceptanceCriteria: [criteria[0]],
      phaseAcceptanceCriteria: [[{ criterion: "stakeholder signs off", evidence: "bun test 通过" }]],
    }));
    const result = await __executePlanProposalForTest({
      objective: "o",
      verification: "bun test test/startup-gate.test.ts",
      acceptanceCriteria: [{ criterion: "stakeholder signs off", evidence: "bun test 通过" }],
      phases: [{ subject: "p", acceptanceCriteria: [criteria[0]] }],
    });
    expect(result.details?.error).toBe("semantic review rejected");
    expect(__getPendingProposalForTest()).toBeUndefined();
    __resetGoalForTest();
  });

  test("语义预审 rewrite 提供迁移但仍保留人工条件时拒绝", async () => {
    __resetGoalForTest();
    __setGoalForTest({ id: "pending-semantic-rewrite-fakemigration", objective: "o", status: "pending", startedAt: 1, updatedAt: 1, iteration: 0 });
    // 模型把 stakeholder signs off 从 goal 搬到 phase，同时提供合法迁移映射 → 核心断言“迁移后 criterion 必须从改写契约彻底消失”应拒绝。
    __setProposalSemanticReviewForTest(() => ({
      decision: "rewrite",
      acceptanceCriteria: [criteria[0]],
      phaseAcceptanceCriteria: [[{ criterion: "stakeholder signs off", evidence: "bun test 通过" }]],
      userReviewItems: ["甲方签字属于完成后的人工复核"],
      migratedUserReviewItems: [{ sourceCriterion: "stakeholder signs off", userReviewItem: "甲方签字属于完成后的人工复核" }],
    }));
    const result = await __executePlanProposalForTest({
      objective: "o",
      verification: "bun test test/startup-gate.test.ts",
      acceptanceCriteria: [{ criterion: "stakeholder signs off", evidence: "bun test 通过" }],
      phases: [{ subject: "p", acceptanceCriteria: [criteria[0]] }],
    });
    expect(result.details?.error).toBe("semantic review rejected");
    expect(__getPendingProposalForTest()).toBeUndefined();
    __resetGoalForTest();
  });

  test("语义预审 rewrite 同层改 evidence 伪装删除时拒绝", async () => {
    __resetGoalForTest();
    __setGoalForTest({ id: "pending-semantic-rewrite-evidence", objective: "o", status: "pending", startedAt: 1, updatedAt: 1, iteration: 0 });
    // 原条件 criterion 不变只改 evidence，同时提供迁移 → 按 criterion 文本比较该 criterion 未消失，但迁移 source 仍存在改写契约 → 应拒绝。
    __setProposalSemanticReviewForTest(() => ({
      decision: "rewrite",
      acceptanceCriteria: [{ criterion: "stakeholder signs off", evidence: "bun test test/startup-gate.test.ts 退出码 0" }],
      phaseAcceptanceCriteria: [[criteria[0]]],
      userReviewItems: ["甲方签字属于完成后的人工复核"],
      migratedUserReviewItems: [{ sourceCriterion: "stakeholder signs off", userReviewItem: "甲方签字属于完成后的人工复核" }],
    }));
    const result = await __executePlanProposalForTest({
      objective: "o",
      verification: "bun test test/startup-gate.test.ts",
      acceptanceCriteria: [{ criterion: "stakeholder signs off", evidence: "bun test 通过" }],
      phases: [{ subject: "p", acceptanceCriteria: [criteria[0]] }],
    });
    expect(result.details?.error).toBe("semantic review rejected");
    expect(__getPendingProposalForTest()).toBeUndefined();
    __resetGoalForTest();
  });

  test("语义预审 rewrite 原样保留人工 criterion 仅新增 userReviewItems 时拒绝", async () => {
    __resetGoalForTest();
    __setGoalForTest({ id: "pending-semantic-rewrite-unchanged", objective: "o", status: "pending", startedAt: 1, updatedAt: 1, iteration: 0 });
    // acceptanceCriteria 完全不变，只新增 userReviewItems 且无 migration → rewrite 不得静默放行。
    __setProposalSemanticReviewForTest(() => ({
      decision: "rewrite",
      acceptanceCriteria: [{ criterion: "stakeholder signs off", evidence: "bun test 通过" }],
      phaseAcceptanceCriteria: [[criteria[0]]],
      userReviewItems: ["甲方签字属于完成后的人工复核"],
    }));
    const result = await __executePlanProposalForTest({
      objective: "o",
      verification: "bun test test/startup-gate.test.ts",
      acceptanceCriteria: [{ criterion: "stakeholder signs off", evidence: "bun test 通过" }],
      phases: [{ subject: "p", acceptanceCriteria: [criteria[0]] }],
    });
    expect(result.details?.error).toBe("semantic review rejected");
    expect(__getPendingProposalForTest()).toBeUndefined();
    __resetGoalForTest();
  });

  test("语义预审 rewrite 只改 evidence 且不提供迁移时拒绝", async () => {
    __resetGoalForTest();
    __setGoalForTest({ id: "pending-semantic-rewrite-evidence-nomigration", objective: "o", status: "pending", startedAt: 1, updatedAt: 1, iteration: 0 });
    // criterion 文本不变只改 evidence，不提供迁移 → 按整个对象比较该原对象被修改，需 migration；无 migration 应拒绝。
    __setProposalSemanticReviewForTest(() => ({
      decision: "rewrite",
      acceptanceCriteria: [{ criterion: "stakeholder signs off", evidence: "bun test test/startup-gate.test.ts" }],
      phaseAcceptanceCriteria: [[criteria[0]]],
    }));
    const result = await __executePlanProposalForTest({
      objective: "o",
      verification: "bun test test/startup-gate.test.ts",
      acceptanceCriteria: [{ criterion: "stakeholder signs off", evidence: "bun test 通过" }],
      phases: [{ subject: "p", acceptanceCriteria: [criteria[0]] }],
    });
    expect(result.details?.error).toBe("semantic review rejected");
    expect(__getPendingProposalForTest()).toBeUndefined();
    __resetGoalForTest();
  });

  test("语义预审 rewrite 用合法条件替换人工条件并完整迁移时放行", async () => {
    __resetGoalForTest();
    __setGoalForTest({ id: "pending-semantic-rewrite-valid", objective: "o", status: "pending", startedAt: 1, updatedAt: 1, iteration: 0 });
    // 人工条件被替换成合法可复验条件（criterion 文本变了），原条件移到 userReviewItems → 应放行。
    __setProposalSemanticReviewForTest(() => ({
      decision: "rewrite",
      acceptanceCriteria: [{ criterion: "测试命令退出码为 0", evidence: "bun test test/startup-gate.test.ts" }],
      phaseAcceptanceCriteria: [[criteria[0]]],
      userReviewItems: ["甲方签字属于完成后的人工复核"],
      migratedUserReviewItems: [{ sourceCriterion: "stakeholder signs off", userReviewItem: "甲方签字属于完成后的人工复核" }],
    }));
    const result = await __executePlanProposalForTest({
      objective: "o",
      verification: "bun test test/startup-gate.test.ts",
      acceptanceCriteria: [{ criterion: "stakeholder signs off", evidence: "bun test 通过" }],
      phases: [{ subject: "p", acceptanceCriteria: [criteria[0]] }],
    });
    expect(result.details?.semanticReview).toBe("rewrite");
    const pending = __getPendingProposalForTest();
    expect(pending?.proposal.acceptanceCriteria?.[0].criterion).toBe("测试命令退出码为 0");
    expect(pending?.proposal.userReviewItems).toEqual(["甲方签字属于完成后的人工复核"]);
    __resetGoalForTest();
  });

  test("语义预审 rewrite 只新增条件时拒绝", async () => {
    __resetGoalForTest();
    __setGoalForTest({ id: "pending-semantic-rewrite-additive", objective: "o", status: "pending", startedAt: 1, updatedAt: 1, iteration: 0 });
    const extra: AcceptanceCriterion = { criterion: "新增无来源条件", evidence: "bun test test/startup-gate.test.ts" };
    __setProposalSemanticReviewForTest(() => ({
      decision: "rewrite",
      acceptanceCriteria: [{ criterion: "stakeholder signs off", evidence: "bun test 通过" }],
      phaseAcceptanceCriteria: [[criteria[0], extra]],
      userReviewItems: ["甲方签字属于完成后的人工复核"],
    }));
    const result = await __executePlanProposalForTest({
      objective: "o",
      verification: "bun test test/startup-gate.test.ts",
      acceptanceCriteria: [{ criterion: "stakeholder signs off", evidence: "bun test 通过" }],
      phases: [{ subject: "p", acceptanceCriteria: [criteria[0]] }],
    });
    expect(result.details?.error).toBe("semantic review rejected");
    expect(__getPendingProposalForTest()).toBeUndefined();
    __resetGoalForTest();
  });

  test("语义预审 rewrite 跨层删除与新增不能互相抵账", async () => {
    __resetGoalForTest();
    __setGoalForTest({ id: "pending-semantic-rewrite-crosslayer-accounting", objective: "o", status: "pending", startedAt: 1, updatedAt: 1, iteration: 0 });
    const other: AcceptanceCriterion = { criterion: "第二个原始条件", evidence: "bun test" };
    const extra: AcceptanceCriterion = { criterion: "phase 凭空新增条件", evidence: "bun test" };
    __setProposalSemanticReviewForTest(() => ({
      decision: "rewrite",
      // goal 删除 other 但保留人工条件；phase 新增 extra，不能跨层抵账。
      acceptanceCriteria: [{ criterion: "stakeholder signs off", evidence: "bun test 通过" }],
      phaseAcceptanceCriteria: [[criteria[0], extra]],
      userReviewItems: ["第二个原始条件的复核"],
      migratedUserReviewItems: [{ sourceCriterion: "第二个原始条件", userReviewItem: "第二个原始条件的复核" }],
    }));
    const result = await __executePlanProposalForTest({
      objective: "o",
      verification: "bun test",
      acceptanceCriteria: [
        { criterion: "stakeholder signs off", evidence: "bun test 通过" },
        other,
      ],
      phases: [{ subject: "p", acceptanceCriteria: [criteria[0]] }],
    });
    expect(result.details?.error).toBe("semantic review rejected");
    expect(__getPendingProposalForTest()).toBeUndefined();
    __resetGoalForTest();
  });

  test("语义预审 rewrite 只重排条件时拒绝", async () => {
    __resetGoalForTest();
    __setGoalForTest({ id: "pending-semantic-rewrite-reorder", objective: "o", status: "pending", startedAt: 1, updatedAt: 1, iteration: 0 });
    const first: AcceptanceCriterion = { criterion: "第一项", evidence: "bun test" };
    const second: AcceptanceCriterion = { criterion: "第二项", evidence: "bun test" };
    __setProposalSemanticReviewForTest(() => ({
      decision: "rewrite",
      acceptanceCriteria: [second, first],
      phaseAcceptanceCriteria: [[criteria[0]]],
    }));
    const result = await __executePlanProposalForTest({
      objective: "o",
      verification: "bun test",
      acceptanceCriteria: [first, second],
      phases: [{ subject: "p", acceptanceCriteria: [criteria[0]] }],
    });
    expect(result.details?.error).toBe("semantic review rejected");
    expect(__getPendingProposalForTest()).toBeUndefined();
    __resetGoalForTest();
  });

  test("新的预审拒绝会清理同一 goal 的旧 pendingProposal", async () => {
    __resetGoalForTest();
    __setGoalForTest({ id: "pending-semantic-stale", objective: "o", status: "pending", startedAt: 1, updatedAt: 1, iteration: 0 });
    __setProposalSemanticReviewForTest(() => approvedReview);
    await __executePlanProposalForTest({ objective: "o", verification: "bun test", acceptanceCriteria: criteria, phases: [{ subject: "p", acceptanceCriteria: criteria }] });
    expect(__getPendingProposalForTest()?.goalId).toBe("pending-semantic-stale");

    __setProposalSemanticReviewForTest(() => ({ decision: "reject", reason: "human-only completion condition" }));
    const rejected = await __executePlanProposalForTest({ objective: "o", verification: "bun test", acceptanceCriteria: [{ criterion: "由甲方签字", evidence: "bun test" }], phases: [{ subject: "p", acceptanceCriteria: criteria }] });
    expect(rejected.details?.error).toBe("semantic review rejected");
    expect(__getPendingProposalForTest()).toBeUndefined();
    __resetGoalForTest();
  });

  test("用户中断语义预审时保持 pending 且不写入 proposal", async () => {
    __resetGoalForTest();
    __setGoalForTest({ id: "pending-semantic-abort", objective: "o", status: "pending", startedAt: 1, updatedAt: 1, iteration: 0 });
    const result = await __executePlanProposalForTest({ objective: "o", verification: "bun test", acceptanceCriteria: criteria, phases: [{ subject: "p", acceptanceCriteria: criteria }] }, { signal: AbortSignal.abort() });
    // 技术失败（用户中断）与语义打回分离：isError:true，error 标为 technical error。
    expect(result.details?.error).toBe("semantic review technical error");
    expect(String(result.content?.[0]?.text ?? "")).toContain("semantic review aborted");
    expect(result.isError).toBe(true);
    expect(__getPendingProposalForTest()).toBeUndefined();
    __resetGoalForTest();
  });

  test("没有当前模型时语义预审 fail-closed", async () => {
    __resetGoalForTest();
    __setGoalForTest({ id: "pending-semantic-unavailable", objective: "o", status: "pending", startedAt: 1, updatedAt: 1, iteration: 0 });
    const result = await __executePlanProposalForTest({
      objective: "o",
      verification: "bun test",
      acceptanceCriteria: criteria,
      phases: [{ subject: "p", acceptanceCriteria: criteria }],
    });
    expect(result.details?.error).toBe("semantic review technical error");
    expect(result.isError).toBe(true);
    expect(__getPendingProposalForTest()).toBeUndefined();
    __resetGoalForTest();
  });

  test("语义预审 approve 可省略 criteria，并保留原冻结契约", async () => {
    __resetGoalForTest();
    __setGoalForTest({ id: "pending-semantic-minimal-approve", objective: "o", status: "pending", startedAt: 1, updatedAt: 1, iteration: 0 });
    __setProposalSemanticCompletionForTest(() => ({
      stopReason: "stop",
      content: [{ type: "text", text: JSON.stringify({ decision: "approve" }) }],
    }));
    const ctx = {
      model: {},
      modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true as const, apiKey: "test" }) },
    };
    const result = await __executePlanProposalForTest({ objective: "o", verification: "bun test", acceptanceCriteria: criteria, phases: [{ subject: "p", acceptanceCriteria: criteria }] }, ctx);
    expect(result.details?.semanticReview).toBe("approve");
    expect(__getPendingProposalForTest()?.proposal.acceptanceCriteria).toEqual(criteria);
    expect(__getPendingProposalForTest()?.proposal.phases[0].acceptanceCriteria).toEqual(criteria);
    __resetGoalForTest();
  });

  test("显式 proposal 忽略旧 requiresExplicitConfirmation 标记并保留原契约", async () => {
    __resetGoalForTest();
    __setGoalForTest({ id: "pending-semantic-confirm", objective: "o", status: "pending", startedAt: 1, updatedAt: 1, iteration: 0 });
    __setProposalSemanticCompletionForTest(() => ({
      stopReason: "stop",
      content: [{ type: "text", text: JSON.stringify({ decision: "approve", requiresExplicitConfirmation: true }) }],
    }));
    const ctx = {
      model: {},
      modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true as const, apiKey: "test" }) },
    };
    const result = await __executePlanProposalForTest({ objective: "o", verification: "bun test", acceptanceCriteria: criteria, phases: [{ subject: "p", acceptanceCriteria: criteria }] }, ctx);
    expect(result.details?.semanticReview).toBe("approve");
    expect(result.details?.startMode).toBe("explicit_confirmation");
    expect(__getPendingProposalForTest()?.proposal.acceptanceCriteria).toEqual(criteria);
    __resetGoalForTest();
  });

  test("语义预审 approve 显式携带非法 criteria 时 fail-closed", async () => {
    __resetGoalForTest();
    __setGoalForTest({ id: "pending-semantic-invalid-approve", objective: "o", status: "pending", startedAt: 1, updatedAt: 1, iteration: 0 });
    const ctx = {
      model: {},
      modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true as const, apiKey: "test" }) },
    };
    for (const payload of [
      { decision: "approve", acceptanceCriteria: "invalid" },
      { decision: "approve", phaseAcceptanceCriteria: "invalid" },
    ]) {
      __setProposalSemanticCompletionForTest(() => ({
        stopReason: "stop",
        content: [{ type: "text", text: JSON.stringify(payload) }],
      }));
      const result = await __executePlanProposalForTest({ objective: "o", verification: "bun test", acceptanceCriteria: criteria, phases: [{ subject: "p", acceptanceCriteria: criteria }] }, ctx);
      expect(result.details?.error).toBe("semantic review technical error");
      expect(String(result.details?.reason)).toContain("invalid JSON");
      expect(__getPendingProposalForTest()).toBeUndefined();
    }
    __resetGoalForTest();
  });

  test("语义预审 approve 仍拒绝偷偷修改 criteria", async () => {
    __resetGoalForTest();
    __setGoalForTest({ id: "pending-semantic-changed-approve", objective: "o", status: "pending", startedAt: 1, updatedAt: 1, iteration: 0 });
    __setProposalSemanticReviewForTest(() => ({
      decision: "approve",
      acceptanceCriteria: [{ criterion: "被审核器改写的条件", evidence: "bun test" }],
      phaseAcceptanceCriteria: [criteria],
    }));
    const result = await __executePlanProposalForTest({ objective: "o", verification: "bun test", acceptanceCriteria: criteria, phases: [{ subject: "p", acceptanceCriteria: criteria }] });
    expect(result.details?.error).toBe("semantic review rejected");
    expect(String(result.details?.reason)).toContain("changed criteria");
    expect(__getPendingProposalForTest()).toBeUndefined();
    __resetGoalForTest();
  });

  test("语义预审接受 approve JSON 中空的迁移数组", async () => {
    __resetGoalForTest();
    __setGoalForTest({ id: "pending-semantic-empty-migrations", objective: "o", status: "pending", startedAt: 1, updatedAt: 1, iteration: 0 });
    __setProposalSemanticCompletionForTest(() => ({
      stopReason: "stop",
      content: [{
        type: "text",
        text: JSON.stringify({
          decision: "approve",
          acceptanceCriteria: criteria,
          phaseAcceptanceCriteria: [criteria],
          userReviewItems: [],
          migratedUserReviewItems: [],
        }),
      }],
    }));
    const ctx = {
      model: {},
      modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true as const, apiKey: "test" }) },
    };
    const result = await __executePlanProposalForTest({ objective: "o", verification: "bun test", acceptanceCriteria: criteria, phases: [{ subject: "p", acceptanceCriteria: criteria }] }, ctx);
    expect(result.details?.semanticReview).toBe("approve");
    expect(__getPendingProposalForTest()?.goalId).toBe("pending-semantic-empty-migrations");
    __resetGoalForTest();
  });

  test("人工 criterion 搭配命令、路径、JSON evidence 都经真实工具入口拒绝", async () => {
    __resetGoalForTest();
    __setGoalForTest({ id: "pending-semantic-evidence-shapes", objective: "o", status: "pending", startedAt: 1, updatedAt: 1, iteration: 0 });
    __setProposalSemanticReviewForTest((proposal) => {
      const criterion = proposal.acceptanceCriteria?.[0]?.criterion ?? "";
      return criterion.includes("甲方") ? { decision: "reject", reason: "human-only criterion" } : approvedReview;
    });
    for (const evidence of ["npm test 通过", "artifacts/review.json", "README.md:42 已更新"]) {
      const result = await __executePlanProposalForTest({
        objective: "o",
        verification: evidence,
        acceptanceCriteria: [{ criterion: "由甲方验收并签字认可", evidence }],
        phases: [{ subject: "p", acceptanceCriteria: criteria }],
      });
      expect(result.details?.error).toBe("semantic review rejected");
      expect(__getPendingProposalForTest()).toBeUndefined();
    }
    __resetGoalForTest();
  });

  test("语义预审进行中用户中断后迟到 approve 仍 fail-closed", async () => {
    __resetGoalForTest();
    __setGoalForTest({ id: "pending-semantic-midflight-abort", objective: "o", status: "pending", startedAt: 1, updatedAt: 1, iteration: 0 });
    const abortController = new AbortController();
    let releaseCompletion!: (value: { stopReason: "stop"; content: unknown[] }) => void;
    let completionStarted!: () => void;
    const started = new Promise<void>((resolve) => { completionStarted = resolve; });
    __setProposalSemanticCompletionForTest(() => {
      completionStarted();
      return new Promise((resolve) => { releaseCompletion = resolve; });
    });
    const ctx = {
      signal: abortController.signal,
      model: {},
      modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true as const, apiKey: "test" }) },
    };
    const pending = __executePlanProposalForTest({ objective: "o", verification: "bun test", acceptanceCriteria: criteria, phases: [{ subject: "p", acceptanceCriteria: criteria }] }, ctx);
    await started;
    abortController.abort();
    releaseCompletion({
      stopReason: "stop",
      content: [{ type: "text", text: JSON.stringify({ decision: "approve", acceptanceCriteria: criteria, phaseAcceptanceCriteria: [criteria] }) }],
    });
    const result = await pending;
    expect(result.details?.error).toBe("semantic review technical error");
    expect(String(result.content?.[0]?.text ?? "")).toContain("semantic review aborted");
    expect(result.isError).toBe(true);
    expect(__getPendingProposalForTest()).toBeUndefined();
    __resetGoalForTest();
  });

  test("模型 stopReason 为 error/aborted/length/toolUse 时即使带 approve JSON 也 fail-closed", async () => {
    __resetGoalForTest();
    __setGoalForTest({ id: "pending-semantic-stop", objective: "o", status: "pending", startedAt: 1, updatedAt: 1, iteration: 0 });
    const ctx = {
      model: {},
      modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true as const, apiKey: "test" }) },
    };
    for (const stopReason of ["error", "aborted", "length", "toolUse"] as const) {
      __setProposalSemanticCompletionForTest(() => ({
        stopReason,
        content: [{ type: "text", text: '{"decision":"approve"}' }],
      }));
      const result = await __executePlanProposalForTest({ objective: "o", verification: "bun test", acceptanceCriteria: criteria, phases: [{ subject: "p", acceptanceCriteria: criteria }] }, ctx);
      expect(result.details?.error).toBe("semantic review technical error");
      expect(result.isError).toBe(true);
      expect(__getPendingProposalForTest()).toBeUndefined();
    }
    __resetGoalForTest();
  });

  test("预审超时 fail-closed 且可重提", async () => {
    __resetGoalForTest();
    __setGoalForTest({ id: "pending-semantic-timeout", objective: "o", status: "pending", startedAt: 1, updatedAt: 1, iteration: 0 });
    __setProposalSemanticReviewTimeoutForTest(5);
    __setProposalSemanticCompletionForTest(() => new Promise(() => {}));
    const ctx = { model: {}, modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true as const, apiKey: "test" }) } };
    const result = await __executePlanProposalForTest({ objective: "o", verification: "bun test", acceptanceCriteria: criteria, phases: [{ subject: "p", acceptanceCriteria: criteria }] }, ctx);
    expect(result.details?.error).toBe("semantic review technical error");
    expect(result.isError).toBe(true);
    expect(String(result.content?.[0]?.text ?? "")).toContain("timeout");
    expect(__getPendingProposalForTest()).toBeUndefined();
    __resetGoalForTest();
  });

  test("预审异常不落半激活状态，修正后可重新提交合法 proposal", async () => {
    __resetGoalForTest();
    __setGoalForTest({ id: "pending-semantic-retry", objective: "o", status: "pending", startedAt: 1, updatedAt: 1, iteration: 0 });
    __setProposalSemanticReviewForTest(() => { throw new Error("provider unavailable"); });
    const failed = await __executePlanProposalForTest({ objective: "o", verification: "bun test", acceptanceCriteria: criteria, phases: [{ subject: "p", acceptanceCriteria: criteria }] });
    expect(failed.details?.error).toBe("semantic review technical error");
    expect(failed.isError).toBe(true);
    expect(__getPendingProposalForTest()).toBeUndefined();

    __setProposalSemanticReviewForTest(() => approvedReview);
    const retried = await __executePlanProposalForTest({ objective: "o", verification: "bun test", acceptanceCriteria: criteria, phases: [{ subject: "p", acceptanceCriteria: criteria }] });
    expect(retried.details?.semanticReview).toBe("approve");
    expect(__getPendingProposalForTest()?.goalId).toBe("pending-semantic-retry");
    __resetGoalForTest();
  });

  test("流式预审：持续有事件时不因总耗时超时，idle timeout 仅在无事件时触发", async () => {
    __resetGoalForTest();
    __setGoalForTest({ id: "pending-semantic-stream-idle", objective: "o", status: "pending", startedAt: 1, updatedAt: 1, iteration: 0 });
    __setProposalSemanticReviewTimeoutForTest(20);
    async function* streamingEvents(): AsyncIterable<AssistantMessageEventLike> {
      yield { type: "start", partial: { content: [] } };
      for (let i = 0; i < 8; i += 1) {
        await new Promise((r) => setTimeout(r, 5));
        yield { type: "text_delta", contentIndex: 0, delta: "{\"decision\":", partial: { content: [] } };
      }
      await new Promise((r) => setTimeout(r, 5));
      const fullText = JSON.stringify({ decision: "approve", acceptanceCriteria: criteria, phaseAcceptanceCriteria: [criteria] });
      yield { type: "done", reason: "stop", message: { content: [{ type: "text", text: fullText }], stopReason: "stop" } };
    }
    __setProposalSemanticStreamForTest(() => streamingEvents());
    const updates: Array<{ liveness?: string }> = [];
    const ctx = { model: {}, modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true as const, apiKey: "test" }) } };
    const result = await __executePlanProposalForTest(
      { objective: "o", verification: "bun test", acceptanceCriteria: criteria, phases: [{ subject: "p", acceptanceCriteria: criteria }] },
      ctx,
      (u) => { updates.push(u.details as { liveness?: string }); },
    );
    expect(result.details?.semanticReview).toBe("approve");
    expect(__getPendingProposalForTest()?.goalId).toBe("pending-semantic-stream-idle");
    // 过程更新应至少出现一次（authenticating/streaming/parsing 任意）。
    expect(updates.length).toBeGreaterThan(0);
    expect(updates.some((u) => u.liveness !== undefined)).toBe(true);
    __setProposalSemanticStreamForTest(undefined);
    __resetGoalForTest();
  });

  test("流式预审：无事件时 idle timeout 触发技术错误而非语义打回", async () => {
    __resetGoalForTest();
    __setGoalForTest({ id: "pending-semantic-stream-timeout", objective: "o", status: "pending", startedAt: 1, updatedAt: 1, iteration: 0 });
    __setProposalSemanticReviewTimeoutForTest(15);
    async function* silentStream(): AsyncIterable<AssistantMessageEventLike> {
      yield { type: "start", partial: { content: [] } };
      await new Promise(() => {});
    }
    __setProposalSemanticStreamForTest(() => silentStream());
    const ctx = { model: {}, modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true as const, apiKey: "test" }) } };
    const result = await __executePlanProposalForTest({ objective: "o", verification: "bun test", acceptanceCriteria: criteria, phases: [{ subject: "p", acceptanceCriteria: criteria }] }, ctx);
    expect(result.details?.error).toBe("semantic review technical error");
    expect(result.isError).toBe(true);
    expect(String(result.content?.[0]?.text ?? "")).toContain("idle timeout");
    expect(__getPendingProposalForTest()).toBeUndefined();
    __setProposalSemanticStreamForTest(undefined);
    __resetGoalForTest();
  });

  test("流式预审：reject 决策返回语义打回（isError:false），不是技术错误", async () => {
    __resetGoalForTest();
    __setGoalForTest({ id: "pending-semantic-stream-reject", objective: "o", status: "pending", startedAt: 1, updatedAt: 1, iteration: 0 });
    async function* rejectStream(): AsyncIterable<AssistantMessageEventLike> {
      yield { type: "start", partial: { content: [] } };
      const fullText = JSON.stringify({ decision: "reject", reason: "criterion requires human sign-off" });
      yield { type: "text_delta", contentIndex: 0, delta: fullText, partial: { content: [] } };
      yield { type: "done", reason: "stop", message: { content: [{ type: "text", text: fullText }], stopReason: "stop" } };
    }
    __setProposalSemanticStreamForTest(() => rejectStream());
    const ctx = { model: {}, modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true as const, apiKey: "test" }) } };
    const result = await __executePlanProposalForTest({ objective: "o", verification: "bun test", acceptanceCriteria: criteria, phases: [{ subject: "p", acceptanceCriteria: criteria }] }, ctx);
    expect(result.details?.error).toBe("semantic review rejected");
    expect(result.isError).toBe(false);
    expect(String(result.content?.[0]?.text ?? "")).toContain("human sign-off");
    expect(__getPendingProposalForTest()).toBeUndefined();
    __setProposalSemanticStreamForTest(undefined);
    __resetGoalForTest();
  });


  test("确认摘要展示冻结验收条件、Profile 与完成后用户复核", () => {
    const proposal = describeProposal({
      assuranceProfile: "staged_check",
      objective: "修复 UI",
      description: "修复 UI 逻辑但不扩张视觉验收门。",
      verification: "测试与代码证据满足要求",
      acceptanceCriteria: criteria,
      userReviewItems: ["在真实 TUI 确认浮层观感"],
      phases: [{ subject: "实现修复", description: "完成可复验修复。", acceptanceCriteria: criteria, tasks: [{ subject: "实现", description: "修改实现。" }] }],
    }) as PlanProposal;
    const text = formatProposalForConfirm(goal(), proposal);
    expect(text).toContain("说明：修复 UI 逻辑但不扩张视觉验收门。");
    expect(text).toContain("独立验收条件：");
    expect(text).toContain("测试通过");
    expect(text).toContain("完成后用户复核：在真实 TUI 确认浮层观感");
    expect(text).toContain("保障档：Staged Check Plan");
    expect(text).toContain("就绪度：L2");
  });

  test("buildProposePrompt 引导选择 Goal Check / Staged Check 并保持独立验收边界", () => {
    const prompt = buildProposePrompt(goal());
    expect(prompt).toContain("Goal Check Plan（goal_plan）");
    expect(prompt).toContain("Staged Check Plan（staged_plan）");
    expect(prompt).toContain("项目工件、命令或可观察外部状态");
    expect(prompt).toContain("userReviewItems");
    expect(prompt).toContain("Goal、可见 Phase 与 Work Item 的 Description");
    expect(prompt).toContain("端到端结果");
    expect(prompt).toContain("真实调用链");
    expect(prompt).toContain("失败路径");
    expect(prompt).not.toContain("contextSummary");
  });
});

describe("proposal confirmation options and interaction", () => {
  const proposal = () => describeProposal({
    assuranceProfile: "staged_check",
    objective: "修好 auth 测试",
    description: "修复认证回归，不改无关会话机制。",
    verification: "npm test auth 全过",
    acceptanceCriteria: criteria,
    phases: [{ subject: "修复登录", description: "覆盖认证路径。", acceptanceCriteria: criteria, tasks: [{ subject: "修登录用例", description: "覆盖 token 过期。" }] }],
  }) as PlanProposal;

  test("摘要/明细选项短且可按 Profile 提供单向切换", () => {
    expect(buildProposalConfirmationOptions(false)).toEqual(["确认，开始执行", "拒绝，放弃目标", "输入反馈意见", "展开 task"]);
    expect(buildProposalConfirmationOptions(true)).toEqual(["确认，开始执行", "拒绝，放弃目标", "输入反馈意见", "收起 task"]);
    expect(buildProposalConfirmationOptions(false, proposal()).at(-1)).toBe("切换为 Goal Check Plan");
  });

  test("可在摘要/明细间往返，再拒绝", async () => {
    const titles: string[] = [];
    const choices = ["展开 task", "收起 task", "拒绝，放弃目标"];
    const result = await __handleProposalConfirmationForTest({
      cwd: process.cwd(),
      ui: {
        notify: () => {}, setStatus: () => {},
        select: async (title: string) => { titles.push(title); return choices.shift(); },
      },
    } as never, goal(), proposal());
    expect(result).toBe("rejected");
    expect(titles).toHaveLength(3);
    expect(titles[0]).not.toContain("- #1 修登录用例");
    expect(titles[1]).toContain("- #1 修登录用例");
    expect(titles[2]).not.toContain("- #1 修登录用例");
  });

  test("Profile 切换、文字反馈与旧 host confirm 都有确定结果", async () => {
    const switched = await __handleProposalConfirmationForTest({
      cwd: process.cwd(), ui: { notify: () => {}, setStatus: () => {}, select: async () => "切换为 Goal Check Plan" },
    } as never, goal(), proposal());
    expect(switched).toEqual({ feedback: expect.stringContaining("goal_plan") });

    const feedback = await __handleProposalConfirmationForTest({
      cwd: process.cwd(), ui: { notify: () => {}, setStatus: () => {}, select: async () => "输入反馈意见", editor: async () => "  请先补回归测试  " },
    } as never, goal(), proposal());
    expect(feedback).toEqual({ feedback: "请先补回归测试" });

    const confirmed = await __handleProposalConfirmationForTest({ cwd: process.cwd(), ui: { confirm: async () => true } } as never, goal(), proposal());
    const rejected = await __handleProposalConfirmationForTest({ cwd: process.cwd(), ui: { confirm: async () => false } } as never, goal(), proposal());
    expect(confirmed).toBe("confirmed");
    expect(rejected).toBe("rejected");
  });
});

describe("formatProposalForConfirm", () => {
  test("summary shows Profile, boundaries, Phase counts, and hides Work Item details", () => {
    const proposal = describeProposal({
      assuranceProfile: "staged_check",
      objective: "修好 auth 测试",
      description: "修复认证回归，不改无关会话机制。",
      verification: "npm test auth 全过",
      acceptanceCriteria: criteria,
      nonGoals: ["不拆 PR"],
      guardrails: ["不改跨会话状态"],
      phases: [
        { subject: "修复登录", description: "覆盖认证路径。", acceptanceCriteria: criteria, tasks: [{ subject: "修登录用例", description: "覆盖 token 过期。" }, { subject: "修权限用例", description: "覆盖权限。" }] },
        { subject: "加回归测试", description: "补齐回归。", acceptanceCriteria: criteria },
      ],
    }) as PlanProposal;
    const text = formatProposalForConfirm(goal(), proposal);
    expect(text).toContain("目标：修好 auth 测试");
    expect(text).toContain("说明：修复认证回归，不改无关会话机制。");
    expect(text).toContain("验证：npm test auth 全过");
    expect(text).toContain("不做什么：不拆 PR");
    expect(text).toContain("护栏：不改跨会话状态");
    expect(text).toContain("保障档：Staged Check Plan");
    expect(text).toContain("Work List（2 个 Work Item，2 个 Phase）");
    expect(text).toContain("Phase #1：修复登录（2 个 Work Item）");
    expect(text).not.toContain("- #1 修登录用例");
    expect(text).not.toContain("覆盖 token 过期。");
  });

  test("expanded view exposes Work Item identity and descriptions", () => {
    const proposal = describeProposal({
      assuranceProfile: "goal_check",
      objective: "修好 auth 测试",
      description: "完成最小修复。",
      verification: "npm test",
      acceptanceCriteria: criteria,
      items: [{ subject: "修登录用例", description: "覆盖 token 过期。" }],
      phases: [],
    }) as PlanProposal;
    const text = formatProposalForConfirm(goal(), proposal, { showTasks: true });
    expect(text).toContain("保障档：Goal Check Plan");
    expect(text).toContain("Work List（1 个 Work Item，0 个 Phase）");
    expect(text).toContain("- #1 修登录用例");
    expect(text).toContain("覆盖 token 过期。");
    expect(text).not.toContain("缺少真实 phase");
    const title = formatProposalConfirmTitle(goal(), proposal, { showTasks: true });
    expect(title).toContain("确认 /dgoal 计划？");
    expect(title).toContain("- #1 修登录用例");
  });

  test("pi-di18n can override confirmation option labels", () => {
    __setI18nForTest({
      t(fullKey) {
        const messages: Record<string, string> = {
          "dgoal.proposal.confirmStart": "Confirm and start",
          "dgoal.proposal.reject": "Reject goal",
          "dgoal.proposal.feedback": "Enter feedback",
          "dgoal.proposal.viewTasks": "Show items",
          "dgoal.proposal.backToSummary": "Hide items",
        };
        return messages[fullKey] ?? fullKey;
      },
    });
    try {
      expect(buildProposalConfirmationOptions(false)).toEqual(["Confirm and start", "Reject goal", "Enter feedback", "Show items"]);
      expect(buildProposalConfirmationOptions(true)).toEqual(["Confirm and start", "Reject goal", "Enter feedback", "Hide items"]);
    } finally {
      __setI18nForTest(undefined);
    }
  });
});
