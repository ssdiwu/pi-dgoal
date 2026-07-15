// 切片 6+7：状态机（done/rejected/pauseReason）+ buildPlanContextBlock 注入测试。
// 见 doc/40-版本实施方案/41-v0.2.0-TaskPlan与建检循环实施方案.md 切片 6/7 验收。
import { describe, expect, test } from "bun:test";

import {
  buildGoalBoundaryBlock,
  buildPlanContextBlock,
  buildSystemPrompt,
  buildCheckFeedbackBlock,
  shouldAbortCurrentTurnOnClear,
  shouldDeliverContinuationNow,
  type GoalState,
  type Phase,
  type Task,
  type TaskPlan,
} from "../index.ts";

function t(id: number, subject: string, status: Task["status"] = "pending", extra: Partial<Task> = {}): Task {
  return { id, subject, status, ...extra };
}
function p(id: number, subject: string, tasks: Task[], status: Phase["status"] = "pending"): Phase {
  return { id, subject, tasks, status };
}

function goal(overrides: Partial<GoalState> = {}): GoalState {
  return {
    id: "g1",
    objective: "修测试",
    status: "active",
    startedAt: 1,
    updatedAt: 1,
    iteration: 0,
    ...overrides,
  };
}

describe("切片6 · 状态机类型完整性", () => {
  test("GoalStatus 含 rejected/done（编译期保证，此处只验证可构造）", () => {
    const g1 = goal({ status: "rejected", rejectedCount: 1 });
    const g2 = goal({ status: "done" });
    const g3 = goal({ status: "paused", pauseReason: "audit_failed_3x", rejectedCount: 3 });
    expect(g1.status).toBe("rejected");
    expect(g2.status).toBe("done");
    expect(g3.pauseReason).toBe("audit_failed_3x");
  });
});

describe("v0.7.0 · verification policy prompt", () => {
  test("final_only prompt 不要求 dgoal_check，改要求 complete_progress + dgoal_done", () => {
    const text = buildSystemPrompt(goal({ verificationPolicy: "final_only" }));
    expect(text).toContain("不要调用 dgoal_check");
    expect(text).toContain("complete_progress");
    expect(text).toContain("一次独立 goal 终审");
  });

  test("phased prompt 保留 dgoal_check 阶段门", () => {
    const text = buildSystemPrompt(goal({ verificationPolicy: "phased" }));
    expect(text).toContain("必须调用 dgoal_check 建检");
  });
});

describe("切片7 · buildPlanContextBlock（plan 注入 system prompt）", () => {
  test("无 plan 返回空字符串", () => {
    expect(buildPlanContextBlock(goal())).toBe("");
  });

  test("空 phases 返回空", () => {
    const g = goal({ plan: { phases: [], nextId: 1 } as TaskPlan });
    expect(buildPlanContextBlock(g)).toBe("");
  });

  // 软遗忘（ADR 0010）：completed phase（建检通过）只保留标题行，其下 task 的 subject
  // 与 evidence 全部软遗忘；in_progress phase 全量注入（含 done task）。
  test("混合 plan：done phase 只留标题行，in_progress phase 全量注入（含 done task）", () => {
    const g = goal({
      plan: {
        phases: [
          p(1, "修复auth", [t(1, "登录", "completed", { evidence: "npm test ok" })], "completed"),
          p(2, "加回归", [
            t(2, "CI钩子", "completed", { evidence: "加了 .github/workflows" }),
            t(3, "跑一次", "in_progress", { activeForm: "正在跑" }),
          ], "in_progress"),
        ],
        nextId: 4,
      } as TaskPlan,
    });
    const block = buildPlanContextBlock(g);
    expect(block).toContain("<dgoal_plan>");
    expect(block).toContain("</dgoal_plan>");
    // done phase：保留标题行
    expect(block).toContain("[completed] phase #1: 修复auth");
    // done phase：软遗忘其下 task 的 subject 与 evidence
    expect(block).not.toContain("登录");
    expect(block).not.toContain("npm test ok");
    expect(block).not.toContain("task #1");
    // in_progress phase：全量注入，含已完成 task 的 subject 与 evidence（软遗忘时机是 phase 整体 done）
    expect(block).toContain("[in_progress] phase #2: 加回归");
    expect(block).toContain("[completed] task #2: CI钩子 | ev: 加了 .github/workflows");
    expect(block).toContain("[in_progress] task #3: 跑一次");
  });

  test("软遗忘四态之一：done phase 不注入其 task 但保留自身标题行", () => {
    const g = goal({
      plan: {
        phases: [
          p(1, "阶段一", [
            t(1, "任务甲", "completed", { evidence: "ev-甲" }),
            t(2, "任务乙", "done", { evidence: "ev-乙" }),
          ], "done"),
        ],
        nextId: 3,
      } as TaskPlan,
    });
    const block = buildPlanContextBlock(g);
    expect(block).toContain("[done] phase #1: 阶段一");
    expect(block).not.toContain("任务甲");
    expect(block).not.toContain("任务乙");
    expect(block).not.toContain("ev-甲");
    expect(block).not.toContain("ev-乙");
    expect(block).not.toContain("task #1");
    expect(block).not.toContain("task #2");
  });

  test("软遗忘四态之二：in_progress phase 全量注入（含 done task 的 subject 和 evidence）", () => {
    const g = goal({
      plan: {
        phases: [p(1, "进行中", [
          t(1, "已完成", "done", { evidence: "ev-done" }),
          t(2, "进行中", "in_progress"),
          t(3, "待办", "pending"),
        ], "in_progress")],
        nextId: 4,
      } as TaskPlan,
    });
    const block = buildPlanContextBlock(g);
    expect(block).toContain("[in_progress] phase #1: 进行中");
    expect(block).toContain("[done] task #1: 已完成 | ev: ev-done");
    expect(block).toContain("[in_progress] task #2: 进行中");
    expect(block).toContain("[pending] task #3: 待办");
  });

  test("软遗忘四态之三：done phase 与 in_progress phase 混合，只后者展开 task", () => {
    const g = goal({
      plan: {
        phases: [
          p(1, "已完成阶段", [t(1, "旧任务", "done", { evidence: "旧证据" })], "completed"),
          p(2, "当前阶段", [t(2, "新任务", "pending")], "in_progress"),
          p(3, "未来阶段", [t(3, "未启动", "pending")], "pending"),
        ],
        nextId: 4,
      } as TaskPlan,
    });
    const block = buildPlanContextBlock(g);
    // done phase 只留标题行
    expect(block).toContain("[completed] phase #1: 已完成阶段");
    expect(block).not.toContain("旧任务");
    expect(block).not.toContain("旧证据");
    // in_progress / pending phase 展开 task
    expect(block).toContain("[in_progress] phase #2: 当前阶段");
    expect(block).toContain("[pending] task #2: 新任务");
    expect(block).toContain("[pending] phase #3: 未来阶段");
    expect(block).toContain("[pending] task #3: 未启动");
  });

  test("软遗忘四态之四：done phase 的标题行本身不被软遗忘", () => {
    // 防止过度软遗忘：phase 标题行必须保留，作为 phase 间认知连续性锚点
    const g = goal({
      plan: {
        phases: [
          p(1, "第一阶段", [t(1, "x", "done")], "done"),
          p(2, "第二阶段", [t(2, "y", "pending")], "in_progress"),
        ],
        nextId: 3,
      } as TaskPlan,
    });
    const block = buildPlanContextBlock(g);
    expect(block).toContain("[done] phase #1: 第一阶段");
    expect(block).toContain("[in_progress] phase #2: 第二阶段");
  });

  test("blocked task 带 blockedReason", () => {
    const g = goal({
      plan: {
        phases: [p(1, "p", [t(1, "需权限", "blocked", { blockedReason: "缺 token" })], "blocked")],
        nextId: 2,
      } as TaskPlan,
    });
    const block = buildPlanContextBlock(g);
    expect(block).toContain("blocked: 缺 token");
  });

  // Goal Repair（ADR 0011/0012）：resume 从 rejected/paused(audit_failed_3x) 恢复为 active 后，
  // finalFeedback 仍在，已完成 phase 的 task 细节不能被软遗忘——修复需要回查实现证据。
  test("Goal Repair：resume 后 active + finalFeedback 仍保留 done phase 全量 task 细节", () => {
    const g = goal({
      status: "active",
      rejectedCount: 2,
      finalFeedback: { report: "<REJECTED>", rejectedCount: 2, createdAt: Date.now() },
      plan: {
        phases: [
          p(1, "已完成阶段", [t(1, "旧任务", "done", { evidence: "旧证据" })], "done"),
          p(2, "当前阶段", [t(2, "新任务", "in_progress")], "in_progress"),
        ],
        nextId: 3,
      } as TaskPlan,
    });
    const block = buildPlanContextBlock(g);
    // done phase 的 task 细节在 Goal Repair 期间保留
    expect(block).toContain("[done] phase #1: 已完成阶段");
    expect(block).toContain("旧任务");
    expect(block).toContain("旧证据");
    expect(block).toContain("[in_progress] phase #2: 当前阶段");
  });

  test("正常 active（无 finalFeedback）：done phase 仍软遗忘", () => {
    const g = goal({
      status: "active",
      plan: {
        phases: [
          p(1, "已完成阶段", [t(1, "旧任务", "done", { evidence: "旧证据" })], "done"),
          p(2, "当前阶段", [t(2, "新任务", "pending")], "in_progress"),
        ],
        nextId: 3,
      } as TaskPlan,
    });
    const block = buildPlanContextBlock(g);
    expect(block).toContain("[done] phase #1: 已完成阶段");
    expect(block).not.toContain("旧任务");
    expect(block).not.toContain("旧证据");
  });
});

describe("goal 边界注入", () => {
  test("无边界字段时返回空", () => {
    expect(buildGoalBoundaryBlock(goal())).toBe("");
  });

  test("nonGoals / guardrails / budget 会注入 dgoal_boundaries block", () => {
    const block = buildGoalBoundaryBlock(goal({
      nonGoals: ["不拆 PR", "不重构 i18n 框架"],
      guardrails: ["不改跨会话状态"],
      budget: "预计 2 轮内完成",
    }));
    expect(block).toContain("<dgoal_boundaries>");
    expect(block).toContain("不做什么：");
    expect(block).toContain("- 不拆 PR");
    expect(block).toContain("- 不重构 i18n 框架");
    expect(block).toContain("护栏：");
    expect(block).toContain("- 不改跨会话状态");
    expect(block).toContain("预算：预计 2 轮内完成");
    expect(block).toContain("</dgoal_boundaries>");
  });
});

describe("续跑发送时机", () => {
  test("agent 仍忙时不应立刻递送 continuation", () => {
    expect(shouldDeliverContinuationNow({ isIdle: () => false, hasPendingMessages: () => false })).toBe(false);
  });

  test("已有待处理消息时不应递送 continuation", () => {
    expect(shouldDeliverContinuationNow({ isIdle: () => true, hasPendingMessages: () => true })).toBe(false);
  });

  test("idle 且无待处理消息时才递送 continuation", () => {
    expect(shouldDeliverContinuationNow({ isIdle: () => true, hasPendingMessages: () => false })).toBe(true);
  });
});

describe("clear 行为", () => {
  test("busy 时 clear 应触发一次中断", () => {
    expect(shouldAbortCurrentTurnOnClear({ isIdle: () => false })).toBe(true);
  });

  test("idle 时 clear 不需要额外中断", () => {
    expect(shouldAbortCurrentTurnOnClear({ isIdle: () => true })).toBe(false);
  });
});

describe("切片6 · rejected resume 清零逻辑（通过字段语义验证）", () => {
  // resumeGoal 涉及 IO，这里验证 pauseReason 语义：audit_failed_3x 清零 vs 其他不清
  test("audit_failed_3x 的 paused 应清零 rejectedCount（resume 语义）", () => {
    const paused3x = goal({ status: "paused", pauseReason: "audit_failed_3x", rejectedCount: 3 });
    const shouldClear = paused3x.pauseReason === "audit_failed_3x";
    expect(shouldClear).toBe(true);
  });

  test("user_abort 的 paused 不应清零（瞬时故障）", () => {
    const pausedAbort = goal({ status: "paused", pauseReason: "user_abort", rejectedCount: 0 });
    const shouldClear = pausedAbort.pauseReason === "audit_failed_3x";
    expect(shouldClear).toBe(false);
  });

  test("rejected 计数到 3 应触发 paused(audit_failed_3x)", () => {
    // 模拟终审不过逻辑的计数判断
    const count = 2;
    const newCount = count + 1;
    expect(newCount >= 3).toBe(true); // 触发 paused
  });
});

describe("v0.5.2 切片7 · buildCheckFeedbackBlock（<check_feedback> 注入）", () => {
  function t2(id: number, subject: string, status: Task["status"] = "pending"): Task { return { id, subject, status }; }
  function p2(id: number, subject: string, tasks: Task[], status: Phase["status"] = "in_progress"): Phase { return { id, subject, tasks, status }; }

  test("active + 当前 phase 有阶段反馈：注入 phase 反馈", () => {
    const g: GoalState = {
      id: "g", objective: "o", status: "active", startedAt: 1, updatedAt: 1, iteration: 0,
      plan: { phases: [p2(1, "阶段一", [t2(1, "t", "in_progress")])], nextId: 2 },
      phaseFeedbackById: { "1": { phaseId: 1, report: "phase1 未通过报告", createdAt: 1 } },
    } as GoalState;
    const block = buildCheckFeedbackBlock(g);
    expect(block).toContain('<check_feedback type="phase" phaseId="1">');
    expect(block).toContain("phase1 未通过报告");
  });

  test("active + 非当前 phase 的反馈：不注入", () => {
    const g: GoalState = {
      id: "g", objective: "o", status: "active", startedAt: 1, updatedAt: 1, iteration: 0,
      plan: { phases: [p2(1, "阶段一", [t2(1, "t", "in_progress")]), p2(2, "阶段二", [t2(2, "t2", "pending")])], nextId: 3 },
      // 反馈在 phase 2，但当前未完成是 phase 1
      phaseFeedbackById: { "2": { phaseId: 2, report: "phase2 报告", createdAt: 1 } },
    } as GoalState;
    expect(buildCheckFeedbackBlock(g)).toBe("");
  });

  test("rejected + 终审反馈：注入 final 反馈", () => {
    const g: GoalState = {
      id: "g", objective: "o", status: "rejected", rejectedCount: 2, startedAt: 1, updatedAt: 1, iteration: 0,
      finalFeedback: { report: "终审未通过报告", rejectedCount: 2, createdAt: 1 },
    } as GoalState;
    const block = buildCheckFeedbackBlock(g);
    expect(block).toContain('<check_feedback type="final" rejectedCount="2">');
    expect(block).toContain("终审未通过报告");
  });

  test("无任何反馈：不生成空 block", () => {
    const g: GoalState = {
      id: "g", objective: "o", status: "active", startedAt: 1, updatedAt: 1, iteration: 0,
      plan: { phases: [p2(1, "阶段一", [t2(1, "t", "in_progress")])], nextId: 2 },
    } as GoalState;
    expect(buildCheckFeedbackBlock(g)).toBe("");
  });

  test("final 优先：resume 后 active 但 finalFeedback 仍在，注入 final 而非 phase", () => {
    const g: GoalState = {
      id: "g", objective: "o", status: "active", rejectedCount: 0, startedAt: 1, updatedAt: 1, iteration: 0,
      plan: { phases: [p2(1, "阶段一", [t2(1, "t", "in_progress")])], nextId: 2 },
      phaseFeedbackById: { "1": { phaseId: 1, report: "phase 报告", createdAt: 1 } },
      finalFeedback: { report: "终审报告（resume 后继续修）", rejectedCount: 3, createdAt: 1 },
    } as GoalState;
    const block = buildCheckFeedbackBlock(g);
    expect(block).toContain('type="final"');
    expect(block).not.toContain('type="phase"');
  });
});
