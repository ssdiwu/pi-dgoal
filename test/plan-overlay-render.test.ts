// 切片 3：计划浮层渲染纯函数测试。
// 见 doc/40-版本实施方案/41-v0.2.0-TaskPlan与建检循环实施方案.md 切片 3 验收。
import { describe, expect, test } from "bun:test";

import { renderPlanLines, type LoopGoal, type Phase, type Task, type TaskPlan } from "../index.ts";

function t(id: number, subject: string, status: Task["status"] = "pending", extra: Partial<Task> = {}): Task {
  return { id, subject, status, ...extra };
}
function p(id: number, subject: string, tasks: Task[], status: Phase["status"] = "pending", extra: Partial<Phase> = {}): Phase {
  return { id, subject, tasks, status, ...extra };
}

function goal(phases: Phase[], overrides: Partial<LoopGoal> = {}): LoopGoal {
  return {
    id: "g1",
    objective: "修好测试",
    status: "active",
    startedAt: 1,
    updatedAt: 1,
    iteration: 0,
    plan: { phases, nextId: 100 } as TaskPlan,
    ...overrides,
  };
}

const noHide = { hiddenPhaseIds: new Set<number>(), expandTasks: false };

describe("切片3 · renderPlanLines 基本渲染", () => {
  test("无 plan 返回空（隐藏浮层）", () => {
    expect(renderPlanLines({ ...goal([]), plan: undefined }, noHide)).toEqual([]);
  });

  test("goal pending 返回空（启动中不显示）", () => {
    const g = goal([p(1, "阶段1", [], "in_progress")], { status: "pending" });
    expect(renderPlanLines(g, noHide)).toEqual([]);
  });

  test("空 phases 返回空", () => {
    expect(renderPlanLines(goal([]), noHide)).toEqual([]);
  });

  test("正常渲染 heading + phase 行，heading 含完成计数", () => {
    const g = goal([
      p(1, "阶段A", [t(1, "a", "completed")], "in_progress"),
      p(2, "阶段B", [], "pending"),
    ]);
    const lines = renderPlanLines(g, noHide);
    expect(lines[0]).toBe("🎯 修好测试 (0/2)"); // 无 completed phase
    expect(lines[1]).toContain("◐ 阶段A"); // in_progress 符号
    expect(lines[1]).toContain("├─");
    expect(lines[2]).toContain("○ 阶段B"); // pending 符号
  });

  test("completed phase 计入 heading 计数", () => {
    const g = goal([
      p(1, "阶段A", [t(1, "a", "completed")], "completed"),
      p(2, "阶段B", [], "pending"),
    ]);
    const lines = renderPlanLines(g, noHide);
    expect(lines[0]).toBe("🎯 修好测试 (1/2)");
  });
});

describe("切片3 · 状态符号", () => {
  test("四态符号正确：○ pending / ◐ in_progress / ✓ completed / ⚠ blocked", () => {
    const g = goal([
      p(1, "p1", [], "pending"),
      p(2, "p2", [], "in_progress"),
      p(3, "p3", [], "completed"),
      p(4, "p4", [], "blocked", { blockedReason: "卡住" }),
    ]);
    const lines = renderPlanLines(g, noHide);
    expect(lines[1]).toContain("○ p1");
    expect(lines[2]).toContain("◐ p2");
    expect(lines[3]).toContain("✓ p3");
    expect(lines[4]).toContain("⚠ p4");
    expect(lines[4]).toContain("[卡住]");
  });
});

describe("切片3 · completed 闪现（hiddenPhaseIds）", () => {
  test("hiddenPhaseIds 中的 completed phase 被隐藏", () => {
    const g = goal([
      p(1, "已完成A", [], "completed"),
      p(2, "进行中B", [], "in_progress"),
    ]);
    const lines = renderPlanLines(g, { hiddenPhaseIds: new Set([1]), expandTasks: false });
    // 已完成A 被隐藏，只剩进行中B
    expect(lines.some((l) => l.includes("已完成A"))).toBe(false);
    expect(lines.some((l) => l.includes("进行中B"))).toBe(true);
  });

  test("全 completed 且全隐藏 → 返回空（自动隐藏浮层）", () => {
    const g = goal([p(1, "A", [], "completed"), p(2, "B", [], "completed")]);
    const lines = renderPlanLines(g, { hiddenPhaseIds: new Set([1, 2]), expandTasks: false });
    expect(lines).toEqual([]);
  });
});

describe("切片3 · expandTasks（Ctrl+O 展开 task）", () => {
  test("expandTasks=false 不显示 task", () => {
    const g = goal([p(1, "阶段", [t(1, "task1", "in_progress")], "in_progress")]);
    const lines = renderPlanLines(g, noHide);
    expect(lines.some((l) => l.includes("task1"))).toBe(false);
  });

  test("expandTasks=true 显示 task（缩进 + 符号）", () => {
    const g = goal([p(1, "阶段", [t(1, "task1", "in_progress", { activeForm: "正在做" })], "in_progress")]);
    const lines = renderPlanLines(g, { hiddenPhaseIds: new Set(), expandTasks: true });
    expect(lines.some((l) => l.includes("task1"))).toBe(true);
    const taskLine = lines.find((l) => l.includes("task1"))!;
    expect(taskLine).toContain("│");
    expect(taskLine).toContain("◐");
    expect(taskLine).toContain("(正在做)"); // activeForm
  });
});

describe("切片3 · 12 行折叠", () => {
  test("phase 超过上限截断（不超 12 行）", () => {
    const phases = Array.from({ length: 20 }, (_, i) => p(i + 1, `阶段${i}`, [], "pending"));
    const g = goal(phases);
    const lines = renderPlanLines(g, noHide);
    // heading(1) + 最多 11 个 phase 行 = 12 行上限
    expect(lines.length).toBeLessThanOrEqual(12);
  });

  test("objective 过长被截断", () => {
    const long = "甲".repeat(100);
    const g = goal([p(1, "阶段", [], "pending")], { objective: long });
    const lines = renderPlanLines(g, noHide);
    expect(lines[0].length).toBeLessThan(long.length);
    expect(lines[0]).toContain("…");
  });
});
