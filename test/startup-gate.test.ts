// 切片 4：启动闸门——proposal 格式化 + proposalToPlan 转换测试（纯函数）。
// 见 doc/40-版本实施方案/41-v0.2.0-TaskPlan与建检循环实施方案.md 切片 4 验收。
import { describe, expect, test } from "bun:test";

import { formatProposalForConfirm, type LoopGoal, type PlanProposal } from "../index.ts";

// proposalToPlan 未 export，通过 formatProposalForConfirm 间接覆盖；
// 这里单独 export 测需要，先确认是否 export。
// 实际 proposalToPlan 是内部函数，通过 formatProposalForConfirm + 后续 dgoal_propose 工具集成测。
// 这里测 formatProposalForConfirm（已 export）。

function goal(): LoopGoal {
  return { id: "g1", objective: "修测试", status: "pending", startedAt: 1, updatedAt: 1, iteration: 0 };
}

describe("切片4 · formatProposalForConfirm", () => {
  test("基本格式：目标 + phase 列表 + task 计数", () => {
    const proposal: PlanProposal = {
      objective: "修好 auth 测试",
      verification: "npm test auth 全过",
      phases: [
        { subject: "修复登录", tasks: [{ subject: "修登录用例" }, { subject: "修权限用例" }] },
        { subject: "加回归测试" },
      ],
    };
    const text = formatProposalForConfirm(goal(), proposal);
    expect(text).toContain("目标：修好 auth 测试");
    expect(text).toContain("验证：npm test auth 全过");
    expect(text).toContain("阶段计划（2 个 phase）");
    expect(text).toContain("1. 修复登录（2 个 task）");
    expect(text).toContain("2. 加回归测试"); // 无 task 不显示计数
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
});

import { proposalToPlan } from "../index.ts";

describe("切片4 · proposalToPlan 转换", () => {
  test("phase 和 task 分配递增 id，nextId 正确", () => {
    const proposal: PlanProposal = {
      objective: "o",
      phases: [
        { subject: "p1", tasks: [{ subject: "t1" }, { subject: "t2" }] },
        { subject: "p2", tasks: [{ subject: "t3" }] },
      ],
    };
    const plan = proposalToPlan(proposal);
    expect(plan.phases).toHaveLength(2);
    expect(plan.phases[0].id).toBe(1);
    expect(plan.phases[0].tasks[0].id).toBe(2);
    expect(plan.phases[0].tasks[1].id).toBe(3);
    expect(plan.phases[1].id).toBe(4);
    expect(plan.phases[1].tasks[0].id).toBe(5);
    expect(plan.nextId).toBe(6);
  });

  test("task 初始 pending，带可选字段", () => {
    const proposal: PlanProposal = {
      objective: "o",
      phases: [{ subject: "p1", tasks: [{ subject: "t1", description: "d", activeForm: "正在做" }] }],
    };
    const plan = proposalToPlan(proposal);
    expect(plan.phases[0].tasks[0].status).toBe("pending");
    expect(plan.phases[0].tasks[0].description).toBe("d");
    expect(plan.phases[0].tasks[0].activeForm).toBe("正在做");
  });

  test("无 tasks 的 phase 也能建", () => {
    const proposal: PlanProposal = { objective: "o", phases: [{ subject: "p1" }] };
    const plan = proposalToPlan(proposal);
    expect(plan.phases[0].tasks).toEqual([]);
    expect(plan.phases[0].status).toBe("pending");
  });
});

import { proposalToPlan } from "../index.ts";

describe("切片4 · proposalToPlan 转换（id 分配）", () => {
  test("phase 和 task 顺序分配 id，nextId 递增", () => {
    const proposal: PlanProposal = {
      objective: "o",
      phases: [
        { subject: "p1", tasks: [{ subject: "t1" }, { subject: "t2" }] },
        { subject: "p2", tasks: [{ subject: "t3" }] },
      ],
    };
    const plan = proposalToPlan(proposal);
    expect(plan.phases[0].id).toBe(1);
    expect(plan.phases[0].tasks[0].id).toBe(2);
    expect(plan.phases[0].tasks[1].id).toBe(3);
    expect(plan.phases[1].id).toBe(4);
    expect(plan.phases[1].tasks[0].id).toBe(5);
    expect(plan.nextId).toBe(6);
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
});
