// v0.7.0 final_only 真实 proposal 路径：省略 phase 验收条件也能进入启动闸门。
import { describe, expect, test } from "bun:test";
import { __executeDgoalProposeForTest, __getPendingProposalForTest, __resetGoalForTest, __setGoalForTest, __setProposalSemanticReviewForTest, type GoalState } from "../index.ts";

const criterion = { criterion: "测试退出码 0", evidence: "npm test" };

function pendingGoal(): GoalState {
  return { id: "g", objective: "o", status: "pending", startedAt: 1, updatedAt: 1, iteration: 0 } as GoalState;
}

describe("v0.7.0 · final_only 真实预审路径", () => {
  test("final_only 省略 phase 验收条件：预审 approve 不崩溃并写入 pendingProposal", async () => {
    __resetGoalForTest();
    __setGoalForTest(pendingGoal());
    __setProposalSemanticReviewForTest(() => ({ decision: "approve", acceptanceCriteria: [criterion] }));
    const r = await __executeDgoalProposeForTest({
      objective: "轻量任务", verification: "npm test 退出码 0",
      verificationPolicyRecommendation: "final_only", budgetPolicyRecommendation: "bounded",
      runtimeBudget: { maxTurns: 4, maxRepairAttempts: 1 },
      acceptanceCriteria: [criterion],
      phases: [{ subject: "p", tasks: [{ subject: "t" }] }],
    }, { model: {}, modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true as const, apiKey: "test" }) } });
    expect(r.details?.error).toBeUndefined();
    const pending = __getPendingProposalForTest();
    expect(pending?.proposal.verificationPolicyRecommendation).toBe("final_only");
    expect(pending?.proposal.phases[0].acceptanceCriteria).toBeUndefined();
  });

  test("final_only 预审 rewrite 不带 phase 条件也能应用", async () => {
    __resetGoalForTest();
    __setGoalForTest(pendingGoal());
    __setProposalSemanticReviewForTest(() => ({
      decision: "rewrite",
      acceptanceCriteria: [{ criterion: "重写的目标条件", evidence: "bun test" }],
      migratedUserReviewItems: [{ sourceCriterion: criterion.criterion, userReviewItem: "人工复核 TUI" }],
    }));
    const r = await __executeDgoalProposeForTest({
      objective: "o", verification: "bun test",
      verificationPolicyRecommendation: "final_only", budgetPolicyRecommendation: "bounded",
      runtimeBudget: { maxTurns: 4, maxRepairAttempts: 1 },
      acceptanceCriteria: [criterion],
      phases: [{ subject: "p", tasks: [{ subject: "t" }] }],
    }, { model: {}, modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true as const, apiKey: "test" }) } });
    expect(r.details?.error).toBeUndefined();
    const pending = __getPendingProposalForTest();
    expect(pending?.proposal.acceptanceCriteria?.[0].criterion).toBe("重写的目标条件");
    expect(pending?.proposal.userReviewItems).toContain("人工复核 TUI");
  });
});
