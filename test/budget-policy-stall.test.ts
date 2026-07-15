// v0.7.0 运行预算纯判定（ADR 0032）：unbounded 不因预算暂停；bounded 的缺省维度不限制；宽限耗尽才暂停。
import { describe, expect, test } from "bun:test";
import { decideBudgetPause, formatStatus, type GoalState } from "../index.ts";

function goal(overrides: Partial<GoalState>): GoalState {
  return { id: "g", objective: "o", status: "active", startedAt: 1, updatedAt: 1, iteration: 0, ...overrides } as GoalState;
}

describe("v0.7.0 · decideBudgetPause 纯判定", () => {
  test("unbounded 永远不暂停", () => {
    const g = goal({ budgetPolicy: "unbounded", runtimeBudget: { maxTurns: 1 }, budgetUsage: { turns: 99, repairAttempts: 99 }, budgetInGrace: true });
    expect(decideBudgetPause(g, "turns").pause).toBe(false);
    expect(decideBudgetPause(g, "repairAttempts").pause).toBe(false);
  });

  test("bounded 用量未达上限不暂停", () => {
    const g = goal({ budgetPolicy: "bounded", runtimeBudget: { maxTurns: 3 }, budgetUsage: { turns: 1, repairAttempts: 0 } });
    expect(decideBudgetPause(g, "turns").pause).toBe(false);
  });

  test("bounded 达上限但未进宽限不暂停（宽限触发在外部）", () => {
    const g = goal({ budgetPolicy: "bounded", runtimeBudget: { maxTurns: 3 }, budgetUsage: { turns: 3, repairAttempts: 0 }, budgetInGrace: false });
    expect(decideBudgetPause(g, "turns").pause).toBe(false);
  });

  test("bounded 宽限中且用量超过 base+grace 才暂停", () => {
    const g = goal({ budgetPolicy: "bounded", runtimeBudget: { maxTurns: 3, grace: { maxTurns: 3 } }, budgetUsage: { turns: 6, repairAttempts: 0 }, budgetInGrace: true });
    const r = decideBudgetPause(g, "turns");
    expect(r.pause).toBe(true);
    if (r.pause) expect(r.reason).toBe("budget_exhausted");
  });

  test("bounded 缺省维度不限制", () => {
    const g = goal({ budgetPolicy: "bounded", runtimeBudget: { maxTurns: 3 }, budgetUsage: { turns: 1, repairAttempts: 99 }, budgetInGrace: true });
    expect(decideBudgetPause(g, "repairAttempts").pause).toBe(false);
  });

  test("无 runtimeBudget 不暂停", () => {
    const g = goal({ budgetPolicy: "bounded", budgetUsage: { turns: 99, repairAttempts: 99 }, budgetInGrace: true });
    expect(decideBudgetPause(g, "turns").pause).toBe(false);
  });

  test("宽限状态在状态栏可见", () => {
    const text = formatStatus(goal({ iteration: 2, budgetInGrace: true }));
    expect(text).toContain("宽限中");
  });
});
