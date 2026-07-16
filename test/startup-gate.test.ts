// 切片 4：启动闸门——proposal 格式化 + proposalToPlan 转换测试（纯函数）。
// 见 doc/40-版本实施方案/41-v0.2.0-TaskPlan与建检循环实施方案.md 切片 4 验收。
import { describe, expect, test } from "bun:test";

import { __executePlanProposalForTest, __getPendingProposalForTest, __handleProposalConfirmationForTest, __resetGoalForTest, __setGoalForTest, __setI18nForTest, __setProposalSemanticCompletionForTest, __setProposalSemanticReviewForTest, __setProposalSemanticReviewTimeoutForTest, __setProposalSemanticStreamForTest, assessProposalReadiness, buildProposalConfirmationOptions, buildProposePrompt, formatProposalConfirmTitle, formatProposalForConfirm, proposalToPlan, validateProposalInput, type AcceptanceCriterion, type AssistantMessageEventLike, type GoalState, type PlanProposal } from "../index.ts";

// proposalToPlan 已 export；这里同时覆盖确认展示与提案转 plan 的纯函数行为。

const criteria: AcceptanceCriterion[] = [{ criterion: "测试通过", evidence: "npm test" }];
const approvedReview = { decision: "approve" as const, acceptanceCriteria: criteria, phaseAcceptanceCriteria: [criteria] };

function goal(): GoalState {
  return { id: "g1", objective: "修测试", status: "pending", startedAt: 1, updatedAt: 1, iteration: 0 };
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

  test("有明确 verification 通过", () => {
    expect(validateProposalInput({ objective: "o", verification: "npm test 全过且 RPC 测试确认命令注册", acceptanceCriteria: criteria, phaseCount: 2, phaseAcceptanceCriteria: [criteria, criteria] })).toBeNull();
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
    const evidenceWithoutMagicWords = [{ criterion: "task 状态可读取", evidence: "plan_read 的工具返回" }];
    expect(validateProposalInput({
      objective: "o", verification: "v", acceptanceCriteria: evidenceWithoutMagicWords,
      phaseCount: 1, phaseAcceptanceCriteria: [undefined], planType: "phase",
    })).toBeNull();

    __resetGoalForTest();
    __setGoalForTest({ id: "pending-evidence-semantics", objective: "o", status: "pending", startedAt: 1, updatedAt: 1, iteration: 0 });
    let reviewCalls = 0;
    __setProposalSemanticReviewForTest(() => {
      reviewCalls += 1;
      return { decision: "approve" };
    });
    const result = await __executePlanProposalForTest({
      objective: "o", planType: "phase", verification: "v",
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
      acceptanceCriteria: [{ criterion: "task 状态可读取", evidence: "plan_read 的工具返回" }],
      migratedUserReviewItems: [{ sourceCriterion: "由甲方验收并签字认可", userReviewItem: "甲方签字属于完成后的人工复核" }],
    }));
    const result = await __executePlanProposalForTest({
      objective: "o", planType: "phase", verification: "v",
      acceptanceCriteria: [{ criterion: "由甲方验收并签字认可", evidence: "npm test" }],
      phases: [{ subject: "p", tasks: [{ subject: "t" }] }],
    });
    expect(result.details?.error).toBeUndefined();
    expect(__getPendingProposalForTest()?.proposal.acceptanceCriteria?.[0].evidence).toBe("plan_read 的工具返回");
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

  test("语义预审可将混合条件改写为独立条件并合并 userReviewItems", async () => {
    __resetGoalForTest();
    __setGoalForTest({ id: "pending-semantic-rewrite", objective: "o", status: "pending", startedAt: 1, updatedAt: 1, iteration: 0 });
    __setProposalSemanticReviewForTest(() => ({
      decision: "rewrite",
      acceptanceCriteria: [{ criterion: "测试命令退出码为 0", evidence: "bun test test/startup-gate.test.ts" }],
      phaseAcceptanceCriteria: [[criteria[0]]],
      userReviewItems: ["甲方签字属于完成后的人工复核"],
      migratedUserReviewItems: [{ sourceCriterion: "由甲方验收并签字认可", userReviewItem: "甲方签字属于完成后的人工复核" }],
    }));
    const result = await __executePlanProposalForTest({
      objective: "o",
      verification: "bun test test/startup-gate.test.ts",
      acceptanceCriteria: [{ criterion: "由甲方验收并签字认可", evidence: "bun test 通过" }],
      userReviewItems: ["保留原有人工复核项"],
      phases: [{ subject: "p", acceptanceCriteria: [criteria[0]] }],
    });
    expect(result.details?.semanticReview).toBe("rewrite");
    const pending = __getPendingProposalForTest();
    expect(pending?.proposal.acceptanceCriteria?.[0].criterion).toBe("测试命令退出码为 0");
    expect(pending?.proposal.userReviewItems).toEqual(["保留原有人工复核项", "甲方签字属于完成后的人工复核"]);
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

  test("确认摘要展示冻结验收条件与完成后用户复核", () => {
    const proposal: PlanProposal = {
      objective: "修复 UI",
      verification: "测试与代码证据满足要求",
      acceptanceCriteria: criteria,
      userReviewItems: ["在真实 TUI 确认浮层观感"],
      phases: [{ subject: "实现修复", acceptanceCriteria: criteria }],
    };
    const text = formatProposalForConfirm(goal(), proposal);
    expect(text).toContain("独立验收条件：");
    expect(text).toContain("测试通过");
    expect(text).toContain("完成后用户复核：在真实 TUI 确认浮层观感");
    expect(text).toContain("就绪度：L2");
  });

  test("buildProposePrompt 引导选择 Phase/Goal Plan 并保持独立验收边界", () => {
    const prompt = buildProposePrompt(goal());
    expect(prompt).toContain("Phase Plan");
    expect(prompt).toContain("Goal Plan");
    expect(prompt).toContain("read/grep/find/ls/bash");
    expect(prompt).toContain("userReviewItems");
    expect(prompt).toContain("phase_plan 或 goal_plan");
  });
});

describe("切片4 · buildProposalConfirmationOptions", () => {
  test("默认摘要态与 task 明细态使用短切换文案", () => {
    expect(buildProposalConfirmationOptions(false)).toEqual(["确认，开始执行", "拒绝，放弃目标", "输入反馈意见", "展开 task"]);
    expect(buildProposalConfirmationOptions(true)).toEqual(["确认，开始执行", "拒绝，放弃目标", "输入反馈意见", "收起 task"]);
  });

  test("pi-di18n 可覆盖切换文案为英文短标签", () => {
    __setI18nForTest({
      t(fullKey, params) {
        const messages: Record<string, string> = {
          "dgoal.proposal.confirmStart": "Confirm and start",
          "dgoal.proposal.reject": "Reject and abandon goal",
          "dgoal.proposal.feedback": "Enter feedback",
          "dgoal.proposal.viewTasks": "Show tasks",
          "dgoal.proposal.backToSummary": "Hide tasks",
        };
        return (messages[fullKey] ?? fullKey).replace(/\{([a-zA-Z0-9_]+)\}/g, (_m, name) => String(params?.[name] ?? `{${name}}`));
      },
    });
    try {
      expect(buildProposalConfirmationOptions(false)).toEqual(["Confirm and start", "Reject and abandon goal", "Enter feedback", "Show tasks"]);
      expect(buildProposalConfirmationOptions(true)).toEqual(["Confirm and start", "Reject and abandon goal", "Enter feedback", "Hide tasks"]);
    } finally {
      __setI18nForTest(undefined);
    }
  });
});

describe("切片4 · handleProposalConfirmation", () => {
  test("可在摘要/明细间往返切换，再执行拒绝", async () => {
    const proposal: PlanProposal = {
      objective: "修好 auth 测试",
      verification: "npm test auth 全过",
      phases: [{ subject: "修复登录", tasks: [{ subject: "修登录用例" }] }],
    };
    const titles: string[] = [];
    const optionsSeen: string[][] = [];
    const choices = ["展开 task", "收起 task", "拒绝，放弃目标"];
    const result = await __handleProposalConfirmationForTest(
      {
        cwd: process.cwd(),
        ui: {
          confirm: async () => true,
          notify: () => {},
          setStatus: () => {},
          select: async (title: string, options: string[]) => {
            titles.push(title);
            optionsSeen.push(options);
            return choices.shift();
          },
          editor: async () => undefined,
        },
      } as never,
      goal(),
      proposal,
    );
    expect(result).toBe("rejected");
    expect(titles).toHaveLength(3);
    expect(titles[0]).not.toContain("- task 1: 修登录用例");
    expect(titles[1]).toContain("- task 1: 修登录用例");
    expect(titles[2]).not.toContain("- task 1: 修登录用例");
    expect(optionsSeen[0][3]).toBe("展开 task");
    expect(optionsSeen[1][3]).toBe("收起 task");
    expect(optionsSeen[2][3]).toBe("展开 task");
  });

  test("Phase Plan 切换为 Goal Plan 时返回重新提案反馈", async () => {
    const proposal: PlanProposal = {
      objective: "修好 auth 测试",
      planType: "phase",
      verification: "npm test auth 全过",
      phases: [{ subject: "修复登录", tasks: [{ subject: "修登录用例" }] }],
    };
    const result = await __handleProposalConfirmationForTest({
      cwd: process.cwd(),
      ui: {
        notify: () => {},
        setStatus: () => {},
        select: async () => "切换为 Goal Plan",
        editor: async () => undefined,
      },
    } as never, goal(), proposal);
    expect(result).toEqual({ feedback: expect.stringContaining("goal_plan") });
  });

  test("选择反馈意见时调用 editor 并返回去首尾空白后的反馈", async () => {
    const proposal: PlanProposal = {
      objective: "修好 auth 测试",
      verification: "npm test auth 全过",
      phases: [{ subject: "修复登录", tasks: [{ subject: "修登录用例" }] }],
    };
    const editorCalls: Array<{ title: string; prefill: string }> = [];
    const result = await __handleProposalConfirmationForTest(
      {
        cwd: process.cwd(),
        ui: {
          confirm: async () => true,
          notify: () => {},
          setStatus: () => {},
          select: async () => "输入反馈意见",
          editor: async (title: string, prefill: string) => {
            editorCalls.push({ title, prefill });
            return "  请先补一个回归测试  ";
          },
        },
      } as never,
      goal(),
      proposal,
    );
    expect(result).toEqual({ feedback: "请先补一个回归测试" });
    expect(editorCalls).toEqual([{ title: "反馈意见（agent 会据此调整计划）：", prefill: "" }]);
  });

  test("兼容旧主机：无 select 时 fallback 到 confirm 为 true，直接确认启动", async () => {
    const result = await __handleProposalConfirmationForTest(
      {
        cwd: process.cwd(),
        ui: {
          confirm: async () => true,
          notify: () => {},
          setStatus: () => {},
          editor: async () => "不应命中",
        },
      } as never,
      goal(),
      {
        objective: "修好 auth 测试",
        verification: "npm test auth 全过",
        phases: [{ subject: "修复登录", tasks: [{ subject: "修登录用例" }] }],
      },
    );
    expect(result).toBe("confirmed");
  });

  test("兼容旧主机：无 select 且 confirm false 时拒绝目标", async () => {
    const result = await __handleProposalConfirmationForTest(
      {
        cwd: process.cwd(),
        ui: {
          confirm: async () => false,
          notify: () => {},
          setStatus: () => {},
        },
      } as never,
      goal(),
      {
        objective: "修好 auth 测试",
        verification: "npm test auth 全过",
        phases: [{ subject: "修复登录", tasks: [{ subject: "修登录用例" }] }],
      },
    );
    expect(result).toBe("rejected");
  });
});

describe("切片4 · formatProposalForConfirm", () => {
  test("默认只显示目标 + phase 列表 + task 计数，不展开 task 明细", () => {
    const proposal: PlanProposal = {
      objective: "修好 auth 测试",
      verification: "npm test auth 全过",
      phases: [
        {
          subject: "修复登录",
          tasks: [
            { subject: "修登录用例", description: "覆盖 token 过期", activeForm: "正在修登录", blockedBy: [1] },
            { subject: "修权限用例" },
          ],
        },
        { subject: "加回归测试" },
      ],
    };
    const text = formatProposalForConfirm(goal(), proposal);
    expect(text).toContain("目标：修好 auth 测试");
    expect(text).toContain("验证：npm test auth 全过");
    expect(text).toContain("就绪度：L1");
    expect(text).toContain("缺口提示：");
    expect(text).toContain("non-goals：未显式声明这个 goal 不做什么");
    expect(text).toContain("阶段计划（2 个 phase）");
    expect(text).toContain("1. 修复登录（2 个 task）");
    expect(text).not.toContain("- task 1: 修登录用例");
    expect(text).not.toContain("说明：覆盖 token 过期");
    expect(text).not.toContain("进行时：正在修登录");
    expect(text).not.toContain("依赖：#1");
    expect(text).not.toContain("- task 2: 修权限用例");
    expect(text).toContain("2. 加回归测试"); // 无 task 不显示计数
  });

  test("showTasks=true 时显示 task 明细与已提供的边界字段", () => {
    const proposal: PlanProposal = {
      objective: "修好 auth 测试",
      planType: "phase",
      verification: "npm test auth 全过",
      nonGoals: ["不拆 PR"],
      guardrails: ["不改跨会话状态"],
      phases: [
        {
          subject: "修复登录",
          tasks: [
            { subject: "修登录用例", description: "覆盖 token 过期", activeForm: "正在修登录", blockedBy: [1] },
            { subject: "修权限用例" },
          ],
        },
      ],
    };
    const text = formatProposalForConfirm(goal(), proposal, { showTasks: true });
    expect(text).toContain("就绪度：L1");
    expect(text).toContain("不做什么：不拆 PR");
    expect(text).toContain("护栏：不改跨会话状态");
    expect(text).toContain("Plan 类型：Phase Plan");
    expect(text).toContain("1. 修复登录（2 个 task）");
    expect(text).toContain("- task 1: 修登录用例");
    expect(text).toContain("说明：覆盖 token 过期");
    expect(text).toContain("进行时：正在修登录");
    expect(text).toContain("依赖：#1");
    expect(text).toContain("- task 2: 修权限用例");
  });

  test("无 verification 时不显示验证行", () => {
    const proposal: PlanProposal = {
      objective: "目标",
      phases: [{ subject: "p1" }],
    };
    const text = formatProposalForConfirm(goal(), proposal);
    expect(text).not.toContain("验证：");
  });

  test("phase 带 description 显示", () => {
    const proposal: PlanProposal = {
      objective: "o",
      phases: [{ subject: "p1", description: "阶段说明" }],
    };
    const text = formatProposalForConfirm(goal(), proposal);
    expect(text).toContain("阶段说明");
  });

  test("空 phases 也能格式化（虽工具层会拒）", () => {
    const proposal: PlanProposal = { objective: "o", phases: [] };
    const text = formatProposalForConfirm(goal(), proposal);
    expect(text).toContain("阶段计划（0 个 phase）");
  });

  test("确认标题默认只包含阶段概览，查看 task 明细时才展开", () => {
    const proposal: PlanProposal = {
      objective: "修好 auth 测试",
      verification: "npm test auth 全过",
      phases: [{ subject: "修复登录", description: "覆盖 token 过期", tasks: [{ subject: "修登录用例" }] }],
    };
    const summaryTitle = formatProposalConfirmTitle(goal(), proposal);
    expect(summaryTitle).toContain("确认 /dgoal 计划？");
    expect(summaryTitle).toContain("目标：修好 auth 测试");
    expect(summaryTitle).toContain("验证：npm test auth 全过");
    expect(summaryTitle).toContain("就绪度：L1");
    expect(summaryTitle).toContain("1. 修复登录（1 个 task）");
    expect(summaryTitle).not.toContain("- task 1: 修登录用例");
    expect(summaryTitle).toContain("覆盖 token 过期");

    const detailTitle = formatProposalConfirmTitle(goal(), proposal, { showTasks: true });
    expect(detailTitle).toContain("- task 1: 修登录用例");
  });

  test("pi-di18n 可覆盖确认 UI 文案为英文", () => {
    __setI18nForTest({
      t(fullKey, params) {
        const messages: Record<string, string> = {
          "dgoal.proposal.objective": "Goal: {objective}",
          "dgoal.proposal.verification": "Verification: {verification}",
          "dgoal.proposal.readiness": "Readiness: {level} ({meaning})",
          "dgoal.proposal.readiness.meaning.L2": "goal, acceptance, and phase plan exist; boundary declarations still have gaps",
          "dgoal.proposal.gapsHeading": "Gaps:",
          "dgoal.proposal.gap.nonGoals": "  - non-goals: the plan never states what this goal will not do",
          "dgoal.proposal.gap.guardrails": "  - guardrails: high-risk boundaries / explicit do-not-touch areas are missing",
          "dgoal.proposal.planHeading": "Phase plan ({count} phases):",
          "dgoal.proposal.taskCount": " ({count} tasks)",
          "dgoal.proposal.taskLine": "     - task {index}: {subject}",
          "dgoal.proposal.confirmTitleWithPlan": "Confirm /dgoal plan?\n\n{plan}",
          "dgoal.replaceConfirm.title": "Replace current dgoal?",
          "dgoal.replaceConfirm.message": "Current goal: {current}\n\nNew goal: {next}",
        };
        return (messages[fullKey] ?? fullKey).replace(/\{([a-zA-Z0-9_]+)\}/g, (_m, name) => String(params?.[name] ?? `{${name}}`));
      },
    });
    try {
      const proposal: PlanProposal = {
        objective: "fix tests",
        verification: "npm test",
        phases: [{ subject: "repair", tasks: [{ subject: "update assertions" }] }],
      };
      const text = formatProposalForConfirm(goal(), proposal);
      const detailText = formatProposalForConfirm(goal(), proposal, { showTasks: true });
      const title = formatProposalConfirmTitle(goal(), proposal);
      expect(text).toContain("Goal: fix tests");
      expect(text).toContain("Verification: npm test");
      expect(text).toContain("Readiness: L1");
      expect(text).toContain("Gaps:");
      expect(text).toContain("Phase plan (1 phases):");
      expect(text).toContain("1. repair (1 tasks)");
      expect(text).not.toContain("- task 1: update assertions");
      expect(detailText).toContain("- task 1: update assertions");
      expect(text).not.toContain("Confirm /dgoal plan?");
      expect(title).toContain("Confirm /dgoal plan?");
      expect(title).toContain("Goal: fix tests");
    } finally {
      __setI18nForTest(undefined);
    }
  });
});

describe("切片4 · proposalToPlan 转换（id 分配）", () => {
  test("phase/task 独立从 1 分配，nextId 只推进 task", () => {
    const proposal: PlanProposal = {
      objective: "o",
      acceptanceCriteria: criteria,
      phases: [
        { subject: "p1", acceptanceCriteria: criteria, tasks: [{ subject: "t1" }, { subject: "t2" }] },
        { subject: "p2", acceptanceCriteria: criteria, tasks: [{ subject: "t3" }] },
      ],
    };
    const plan = proposalToPlan(proposal);
    expect(plan.phases.map((phase) => phase.id)).toEqual([1, 2]);
    expect(plan.phases.map((phase) => phase.acceptanceCriteria)).toEqual([criteria, criteria]);
    expect(plan.phases.flatMap((phase) => phase.tasks.map((task) => task.id))).toEqual([1, 2, 3]);
    expect(plan.nextId).toBe(4);
  });

  test("初始 task 状态为 pending", () => {
    const proposal: PlanProposal = {
      objective: "o",
      phases: [{ subject: "p", tasks: [{ subject: "t", activeForm: "正在做" }] }],
    };
    const plan = proposalToPlan(proposal);
    expect(plan.phases[0].tasks[0].status).toBe("pending");
    expect(plan.phases[0].tasks[0].activeForm).toBe("正在做");
  });

  test("phase 无 task 时 tasks 为空数组", () => {
    const proposal: PlanProposal = { objective: "o", phases: [{ subject: "p" }] };
    const plan = proposalToPlan(proposal);
    expect(plan.phases[0].tasks).toEqual([]);
    expect(plan.phases[0].status).toBe("pending");
  });

  test("task blockedBy 为字符串 '[1]' → 解析成局部索引 1", () => {
    // 模型可能把 tasks[].blockedBy stringify 成 "[1]"，proposalToPlan 要 coerce 回数组。
    const proposal: PlanProposal = {
      objective: "o",
      phases: [{ subject: "p", tasks: [{ subject: "t1" }, { subject: "t2", blockedBy: "[1]" }] }],
    };
    const plan = proposalToPlan(proposal);
    // phase 与 task 使用独立 namespace；t2 局部索引 1 → plan-global task id 1。
    expect(plan.phases[0].tasks[1].blockedBy).toEqual([1]);
  });
});
