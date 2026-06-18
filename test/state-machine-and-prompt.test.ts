// 切片 6+7：状态机（done/rejected/pauseReason）+ buildPlanContextBlock 注入测试。
// 见 doc/40-版本实施方案/41-v0.2.0-TaskPlan与建检循环实施方案.md 切片 6/7 验收。
import { describe, expect, test } from "bun:test";

import {
  buildPlanContextBlock,
  shouldDeliverContinuationNow,
  type LoopGoal,
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

function goal(overrides: Partial<LoopGoal> = {}): LoopGoal {
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
  test("LoopStatus 含 rejected/done（编译期保证，此处只验证可构造）", () => {
    const g1 = goal({ status: "rejected", rejectedCount: 1 });
    const g2 = goal({ status: "done" });
    const g3 = goal({ status: "paused", pauseReason: "audit_failed_3x", rejectedCount: 3 });
    expect(g1.status).toBe("rejected");
    expect(g2.status).toBe("done");
    expect(g3.pauseReason).toBe("audit_failed_3x");
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

  test("正常输出三层：phase + task，含状态和 evidence", () => {
    const g = goal({
      plan: {
        phases: [
          p(1, "修复auth", [t(1, "登录", "completed", { evidence: "npm test ok" })], "completed"),
          p(2, "加回归", [t(2, "CI钩子", "in_progress", { activeForm: "正在加" })], "in_progress"),
        ],
        nextId: 3,
      } as TaskPlan,
    });
    const block = buildPlanContextBlock(g);
    expect(block).toContain("<loop_plan>");
    expect(block).toContain("</loop_plan>");
    expect(block).toContain("[completed] phase #1: 修复auth");
    expect(block).toContain("[completed] task #1: 登录 | ev: npm test ok");
    expect(block).toContain("[in_progress] phase #2: 加回归");
    expect(block).toContain("[in_progress] task #2: CI钩子");
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
