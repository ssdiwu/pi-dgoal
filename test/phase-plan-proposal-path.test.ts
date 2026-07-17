import { describe, expect, test } from "bun:test";
import { __executePlanProposalForTest as executeRawPlanProposalForTest, __getPendingProposalForTest, __resetGoalForTest, __setGoalForTest, __setProposalSemanticReviewForTest, type GoalState } from "../index.ts";

const criterion = { criterion: "测试退出码 0", evidence: "npm test" };

function pendingGoal(): GoalState {
  return { id: "g", objective: "o", description: "等待提案说明。", status: "pending", startedAt: 1, updatedAt: 1, iteration: 0 } as GoalState;
}

function executeProposal(params: Record<string, any>) {
  return executeRawPlanProposalForTest({
    ...params,
    description: params.description ?? "保持 Phase Plan 轻量，只冻结 goal 契约。",
    phases: params.phases.map((phase: Record<string, any>, phaseIndex: number) => ({
      ...phase,
      description: phase.description ?? `阶段 ${phaseIndex + 1} 组织进度。`,
      tasks: phase.tasks?.map((task: Record<string, any>, taskIndex: number) => ({
        ...task,
        description: task.description ?? `任务 ${taskIndex + 1} 推进当前阶段。`,
      })),
    })),
  });
}

describe("Phase Plan proposal semantic path", () => {
  test("Phase Plan may omit phase acceptance criteria", async () => {
    __resetGoalForTest();
    __setGoalForTest(pendingGoal());
    __setProposalSemanticReviewForTest(() => ({ decision: "approve", phaseAcceptanceCriteria: [] }));
    const result = await executeProposal({
      planType: "phase",
      objective: "轻量任务",
      verification: "npm test 退出码 0",
      acceptanceCriteria: [criterion],
      phases: [{ subject: "p", tasks: [{ subject: "t" }] }],
    });
    expect(result.details?.error).toBeUndefined();
    const pending = __getPendingProposalForTest();
    expect(pending?.proposal.planType).toBe("phase");
    expect(pending?.proposal.phases[0].acceptanceCriteria).toBeUndefined();
  });

  test("Phase Plan rewrite may keep phase criteria absent", async () => {
    __resetGoalForTest();
    __setGoalForTest(pendingGoal());
    __setProposalSemanticReviewForTest(() => ({
      decision: "rewrite",
      acceptanceCriteria: [{ criterion: "重写的目标条件", evidence: "bun test" }],
      phaseAcceptanceCriteria: [],
      migratedUserReviewItems: [{ sourceCriterion: criterion.criterion, userReviewItem: "人工复核 TUI" }],
    }));
    const result = await executeProposal({
      planType: "phase",
      objective: "o",
      verification: "bun test",
      acceptanceCriteria: [criterion],
      phases: [
        { subject: "p1", tasks: [{ subject: "t1" }] },
        { subject: "p2", tasks: [{ subject: "t2" }] },
      ],
    });
    expect(result.details?.error).toBeUndefined();
    const pending = __getPendingProposalForTest();
    expect(pending?.proposal.acceptanceCriteria?.[0].criterion).toBe("重写的目标条件");
    expect(pending?.proposal.phases.every((phase) => phase.acceptanceCriteria === undefined)).toBe(true);
    expect(pending?.proposal.userReviewItems).toContain("人工复核 TUI");
  });

  test("extra phase acceptance layers fail closed", async () => {
    __resetGoalForTest();
    __setGoalForTest(pendingGoal());
    __setProposalSemanticReviewForTest(() => ({
      decision: "rewrite",
      acceptanceCriteria: [{ criterion: "重写的目标条件", evidence: "bun test" }],
      phaseAcceptanceCriteria: [[], []],
      migratedUserReviewItems: [{ sourceCriterion: criterion.criterion, userReviewItem: "人工复核 TUI" }],
    }));
    const result = await executeProposal({
      planType: "phase",
      objective: "o",
      verification: "bun test",
      acceptanceCriteria: [criterion],
      phases: [{ subject: "p", tasks: [{ subject: "t" }] }],
    });
    expect(result.details?.error).toBe("semantic review rejected");
    expect(String(result.content?.[0]?.text ?? "")).toContain("extra Phase Plan acceptance criteria");
    expect(__getPendingProposalForTest()).toBeUndefined();
  });
});
