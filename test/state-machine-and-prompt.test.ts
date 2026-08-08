// ADR 0051：Goal 状态、Work List context 与 Plan Contract prompt 测试。
import { describe, expect, test } from "bun:test";

import {
  buildCheckFeedbackBlock,
  buildGoalBoundaryBlock,
  buildPlanContractContext,
  buildSoftWorkListContext,
  buildStartPrompt,
  shouldAbortCurrentTurnOnClear,
  shouldDeliverContinuationNow,
  type GoalState,
  type PlanContract,
  type WorkItem,
  type WorkPhase,
} from "../index.ts";

function item(id: number, subject: string, status: WorkItem["status"] = "pending", extra: Partial<WorkItem> = {}): WorkItem {
  return { id, subject, description: `${subject} 服务当前 Goal。`, status, ...extra };
}

function phase(id: number, subject: string, items: WorkItem[], status: WorkPhase["status"] = "pending", extra: Partial<WorkPhase> = {}): WorkPhase {
  return { id, subject, description: `${subject} 服务整体 Goal。`, items, status, revision: 0, ...extra };
}

function contract(profile: PlanContract["profile"], extra: Partial<PlanContract> = {}): PlanContract {
  return { id: `run-${profile}`, profile, startedAt: 1, revision: 2, transitions: [{ to: profile, at: 1, revision: 2 }], ...extra };
}

function goal(overrides: Partial<GoalState> = {}): GoalState {
  return {
    id: "g1",
    objective: "修测试",
    description: "恢复测试并保持既有行为边界。",
    status: "active",
    startedAt: 1,
    updatedAt: 1,
    iteration: 0,
    workList: {
      items: [],
      phases: [phase(1, "实现", [item(1, "编码", "in_progress")], "in_progress")],
      nextItemId: 2,
      nextPhaseId: 2,
      revision: 2,
    },
    ...overrides,
  };
}

describe("Goal state", () => {
  test("GoalStatus covers pending / active / paused / done", () => {
    expect(goal({ status: "pending" }).status).toBe("pending");
    expect(goal({ status: "active" }).status).toBe("active");
    expect(goal({ status: "paused", pauseReason: "audit_error" }).status).toBe("paused");
    expect(goal({ status: "done" }).status).toBe("done");
  });
});

describe("single Work List context", () => {
  test("soft Work List injects one non-continuing authority block with retained Work Item detail", () => {
    const described = item(1, "编码", "in_progress", {
      deliverables: [{ target: "src/<output>.ts", description: "输出可读取" }],
    });
    const block = buildSoftWorkListContext(goal({
      workList: { items: [described], phases: [], nextItemId: 2, nextPhaseId: 1, revision: 2 },
    }));
    expect(block).toContain('<dgoal_work_list mode="soft" revision="2">');
    expect(block).toContain("编码 服务当前 Goal。");
    expect(block).toContain("src/&lt;output&gt;.ts");
    expect(block).toContain("输出可读取");
    expect(block).toContain("不启动自动续跑、no-progress 计数或独立审核");
    expect(block).toContain("execution_plan 原子升级");
    expect(block).not.toContain("contextSummary");
  });

  test("Execution Plan makes the Work List authoritative and requires explicit Goal close", () => {
    const g = goal({ contract: contract("execution") });
    const block = buildPlanContractContext(g);
    expect(block).toContain("当前 Plan Contract：execution");
    expect(block).toContain('<dgoal_work_list profile="execution" revision="2">');
    expect(block).toContain("当前 Work List 是执行与收口的唯一结构化权威");
    expect(block).toContain("work_update(target=goal,status=done,summary,verification)");
    expect(block).toContain("成员耗尽不会自动完成 Phase");
  });

  test("Goal Check and Staged Check expose distinct check/update chains", () => {
    const goalCheck = buildPlanContractContext(goal({ contract: contract("goal_check") }));
    expect(goalCheck).toContain("不要调用 phase_check");
    expect(goalCheck).toContain("goal_check");

    const staged = buildPlanContractContext(goal({ contract: contract("staged_check") }));
    expect(staged).toContain("按严格 Phase 顺序运行 phase_check");
    expect(staged).toContain("work_update 显式完成 Phase");
    expect(staged).toContain("goal_check");
  });

  test("Goal description, Work Item evidence and deliverables are XML escaped", () => {
    const g = goal({
      description: "采用 <最小> 修复",
      contract: contract("execution"),
      workList: {
        items: [item(1, "核对 <API>", "done", {
          evidence: "a & b",
          deliverables: [{ target: "out<1>.txt", description: "内容 & 格式正确" }],
          deliverableEvidence: [{ target: "out<1>.txt", evidence: "read & compare" }],
        })],
        phases: [], nextItemId: 2, nextPhaseId: 1, revision: 2,
      },
    });
    const block = buildPlanContractContext(g);
    expect(block).toContain("采用 &lt;最小&gt; 修复");
    expect(block).toContain("核对 &lt;API&gt;");
    expect(block).toContain("a &amp; b");
    expect(block).toContain("out&lt;1&gt;.txt");
    expect(block).toContain("内容 &amp; 格式正确");
    expect(block).toContain("read &amp; compare");
  });
});

describe("frozen boundary and feedback blocks", () => {
  test("nonGoals / guardrails come only from Plan Contract", () => {
    const g = goal({ contract: contract("goal_check", { nonGoals: ["不拆 PR"], guardrails: ["不改跨会话状态"] }) });
    const block = buildGoalBoundaryBlock(g);
    expect(block).toContain("<dgoal_boundaries>");
    expect(block).toContain("- 不拆 PR");
    expect(block).toContain("- 不改跨会话状态");
  });

  test("current Phase feedback is injected, unrelated Phase feedback is not", () => {
    const current = phase(1, "当前", [item(1, "修复")], "in_progress", { feedback: { report: "当前反馈", createdAt: 1 } });
    const future = phase(2, "未来", [item(2, "稍后")], "pending", { feedback: { report: "未来反馈", createdAt: 1 } });
    const g = goal({ contract: contract("staged_check"), workList: { items: [], phases: [current, future], nextItemId: 3, nextPhaseId: 3, revision: 2 } });
    const block = buildCheckFeedbackBlock(g);
    expect(block).toContain('type="phase" phaseId="1"');
    expect(block).toContain("当前反馈");
    expect(block).not.toContain("未来反馈");
  });

  test("final feedback takes precedence and no feedback produces no block", () => {
    const withFinal = goal({ contract: contract("goal_check", { finalFeedback: { report: "终审反馈", rejectedCount: 2, createdAt: 1 } }) });
    expect(buildCheckFeedbackBlock(withFinal)).toContain('type="final" rejectedCount="2"');
    expect(buildCheckFeedbackBlock(withFinal)).toContain("终审反馈");
    expect(buildCheckFeedbackBlock(goal({ contract: contract("execution") }))).toBe("");
  });
});

describe("start prompt and lifecycle helpers", () => {
  test("start prompt reflects the active Profile without contextSummary", () => {
    const text = buildStartPrompt(goal({ contract: contract("staged_check") }));
    expect(text).toContain("Staged Check Plan");
    expect(text).toContain("phase_check");
    expect(text).toContain("work_update");
    expect(text).not.toContain("contextSummary");
  });

  test("continuation is delivered only when idle with no pending messages", () => {
    expect(shouldDeliverContinuationNow({ isIdle: () => false, hasPendingMessages: () => false })).toBe(false);
    expect(shouldDeliverContinuationNow({ isIdle: () => true, hasPendingMessages: () => true })).toBe(false);
    expect(shouldDeliverContinuationNow({ isIdle: () => true, hasPendingMessages: () => false })).toBe(true);
  });

  test("clear aborts only a busy turn", () => {
    expect(shouldAbortCurrentTurnOnClear({ isIdle: () => false })).toBe(true);
    expect(shouldAbortCurrentTurnOnClear({ isIdle: () => true })).toBe(false);
  });
});
