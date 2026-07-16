// 切片 3：计划浮层渲染纯函数测试。
// 见 doc/40-版本实施方案/41-v0.2.0-TaskPlan与建检循环实施方案.md 切片 3 验收。
import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";

import { __resetGoalForTest, __setCheckSnapshotForTest, __setGoalForTest, __setI18nForTest, PlanOverlay, renderPlanLines, type GoalState, type Phase, type Task, type TaskPlan } from "../index.ts";

function t(id: number, subject: string, status: Task["status"] = "pending", extra: Partial<Task> = {}): Task {
  return { id, subject, status, ...extra };
}
function p(id: number, subject: string, tasks: Task[], status: Phase["status"] = "pending", extra: Partial<Phase> = {}): Phase {
  return { id, subject, tasks, status, ...extra };
}

function goal(phases: Phase[], overrides: Partial<GoalState> = {}): GoalState {
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

const noHide = { expandTasks: false };

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

  test("Phase/Goal Plan 默认渲染 heading + phase，heading 含完成计数", () => {
    const g = goal([
      p(1, "阶段A", [t(1, "a", "done")], "in_progress"),
      p(2, "阶段B", [], "pending"),
    ]);
    const lines = renderPlanLines(g, noHide);
    expect(lines[0]).toContain("🎯 修好测试 · 0/2 phases"); // 无 done phase
    expect(lines[0]).toContain("1/1 tasks");
    expect(lines[0]).toContain("⏱");
    expect(lines[1]).toContain("◐ 阶段A");
    expect(lines[2]).toContain("○ 阶段B");
  });

  test("done phase 计入 heading 计数", () => {
    const g = goal([
      p(1, "阶段A", [t(1, "a", "done")], "done"),
      p(2, "阶段B", [], "pending"),
    ]);
    const lines = renderPlanLines(g, noHide);
    expect(lines[0]).toContain("🎯 修好测试 · 1/2 phases");
  });

  test("paused 状态耗时冻结在 updatedAt", () => {
    const realNow = Date.now;
    Date.now = () => 10_000;
    try {
      const g = goal([p(1, "阶段A", [], "in_progress")], { status: "paused", startedAt: 1_000, updatedAt: 4_000 });
      const lines = renderPlanLines(g, noHide);
      expect(lines[0]).toContain("⏱️ 3s");
    } finally {
      Date.now = realNow;
    }
  });

  test("goal_check rejected 不改变 active 状态投影", () => {
    const active = goal([p(1, "阶段", [], "done")], {
      status: "active",
      goalCheck: { status: "rejected", report: "需修复", revision: 1, checkedAt: 1 },
    });
    const heading = renderPlanLines(active, noHide)[0];
    expect(heading).toContain("修好测试");
    expect(heading).not.toContain("终审修复");
  });
});

describe("切片3 · 状态符号", () => {
  test("四态符号正确：○ pending / ◐ in_progress / ✓ done / ⚠ blocked", () => {
    const g = goal([
      p(1, "p1", [], "pending"),
      p(2, "p2", [], "in_progress"),
      p(3, "p3", [], "done"),
      p(4, "p4", [], "blocked", { blockedReason: "卡住" }),
    ]);
    const lines = renderPlanLines(g, { expandTasks: true });
    expect(lines[1]).toContain("○ p1");
    expect(lines[2]).toContain("◐ p2");
    expect(lines[3]).toContain("✓"); // done 状态字符（p3 被删除线包裹，不再与 ✓ 连续）
    expect(lines[3]).toContain("p3"); // 标题文本仍在（带 ANSI 包裹）
    expect(lines[4]).toContain("⚠ p4");
    expect(lines[4]).toContain("[卡住]");
  });

  test("done phase 标题文本带删除线，状态字符和树形符号不带（ADR 0009）", () => {
    const g = goal([p(1, "phaseDone", [], "done")]);
    const lines = renderPlanLines(g, { expandTasks: true });
    const phaseLine = lines[1];
    // 标题文本被删除线 ANSI 包裹
    expect(phaseLine).toContain("\u001b[9mphaseDone\u001b[29m");
    // 状态字符 ✓ 和树形符号 ├─ 不被包裹
    expect(phaseLine).not.toContain("\u001b[9m├─");
    expect(phaseLine).not.toContain("\u001b[9m✓");
    // blocked 的 blockedReason 后缀也不参与删除线
    const g2 = goal([p(1, "blk", [], "blocked", { blockedReason: "原因" })]);
    const blkLine = renderPlanLines(g2, { expandTasks: true })[1];
    expect(blkLine).toContain("[原因]");
    expect(blkLine).not.toContain("\u001b[9m");
  });
});

describe("切片3 · done phase 持久显示", () => {
  test("done phase 不再被 hiddenPhaseIds 隐藏", () => {
    const g = goal([
      p(1, "已完成A", [], "done"),
      p(2, "进行中B", [], "in_progress"),
    ]);
    const lines = renderPlanLines(g, { expandTasks: true });
    expect(lines.some((l) => l.includes("已完成A"))).toBe(true);
    expect(lines.some((l) => l.includes("进行中B"))).toBe(true);
  });

  test("全 done 也保持完整显示", () => {
    const g = goal([p(1, "A", [], "done"), p(2, "B", [], "done")]);
    const lines = renderPlanLines({ ...g, status: "done" }, noHide);
    // done 标题被删除线包裹，✓ 和 A/B 不再连续，分开断言
    expect(lines.some((l) => l.includes("✓") && l.includes("A"))).toBe(true);
    expect(lines.some((l) => l.includes("✓") && l.includes("B"))).toBe(true);
  });
});


describe("切片3 · PlanOverlay reload 恢复", () => {
  test("重载恢复后 done phase 仍持久显示", () => {
    const widgets: unknown[] = [];
    const overlay = new PlanOverlay();
    const restored = goal([
      p(1, "已完成A", [], "done"),
      p(2, "进行中B", [], "in_progress"),
    ]);

    __setGoalForTest(restored);
    overlay.setUI({
      setWidget: (_key, value) => widgets.push(value),
      getToolsExpanded: () => false,
    });

    try {
      overlay.update();
      overlay.update();
      const factory = widgets.at(-1) as (tui: unknown, theme: unknown) => { render(width: number): string[] };
      const lines = factory({}, {}).render(100);
      expect(lines.some((line) => line.includes("已完成A"))).toBe(true);
      expect(lines.some((line) => line.includes("进行中B"))).toBe(true);
    } finally {
      overlay.dispose();
      __resetGoalForTest();
    }
  });

  test("清除完成快照后新 goal 不会渲染旧 done 内容", () => {
    const widgets: unknown[] = [];
    const overlay = new PlanOverlay();
    const oldDone = goal([p(1, "旧目标", [], "done")], { status: "done" });
    const next = goal([p(1, "新目标", [], "in_progress")]);
    __setGoalForTest(next);
    overlay.setUI({ setWidget: (_key, value) => widgets.push(value), getToolsExpanded: () => false });
    try {
      overlay.showDoneThenHide(oldDone);
      overlay.clearDoneSnapshot();
      overlay.update();
      const factory = widgets.at(-1) as (tui: unknown, theme: unknown) => { render(width: number): string[] };
      const lines = factory({}, {}).render(100);
      expect(lines.some((line) => line.includes("旧目标"))).toBe(false);
      expect(lines.some((line) => line.includes("新目标"))).toBe(true);
    } finally {
      overlay.dispose();
      __resetGoalForTest();
    }
  });

  test("完成浮层延迟隐藏的 setWidget 抛错时不产生未捕获异常", () => {
    const originalSetTimeout = globalThis.setTimeout;
    let delayedHide: (() => void) | undefined;
    globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay?: number) => {
      if (delay === 10_000) {
        delayedHide = callback;
        return 4242 as unknown as ReturnType<typeof setTimeout>;
      }
      return originalSetTimeout(callback, delay) as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;

    const overlay = new PlanOverlay();
    const done = goal([p(1, "完成", [], "done")], { status: "done" });
    __setGoalForTest(done);
    overlay.setUI({
      setWidget: () => { throw new Error("delayed hide UI boom"); },
      getToolsExpanded: () => false,
    });
    try {
      expect(() => overlay.showDoneThenHide(done)).not.toThrow();
      expect(delayedHide).toBeDefined();
      expect(() => delayedHide!()).not.toThrow();
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      overlay.dispose();
      __resetGoalForTest();
    }
  });
});

describe("切片3 · 建检活性片段", () => {
  test("有运行时建检快照时，aboveEditor 浮层展示轻量活性片段但不展示报告正文", () => {
    __setCheckSnapshotForTest({
      liveness: "tool_running",
      currentTool: "read",
      idleSecondsLeft: 118,
      idleSecondsTotal: 120,
      attempt: 2,
      attemptTotal: 3,
    });
    try {
      const g = goal([p(1, "阶段A", [], "in_progress")]);
      const lines = renderPlanLines(g, { expandTasks: true });
      expect(lines.some((l) => l.includes("建检活性"))).toBe(true);
      expect(lines.some((l) => l.includes("read"))).toBe(true);
      expect(lines.some((l) => l.includes("第 2/3 次"))).toBe(true);
      expect(lines.some((l) => l.includes("报告正文"))).toBe(false);
    } finally {
      __setCheckSnapshotForTest(undefined);
    }
  });
});

describe("切片3 · expandTasks（Ctrl+O 展开 task）", () => {
  test("expandTasks=false 不显示 task", () => {
    __setI18nForTest(undefined);
    const g = goal([p(1, "阶段", [t(1, "task1", "in_progress")], "in_progress")]);
    const lines = renderPlanLines(g, noHide);
    expect(lines.some((l) => l.includes("task1"))).toBe(false);
    expect(lines.at(-1)).toContain("Ctrl+O 展开详情");
    expect(lines.at(-1)).toContain("/dgoal s查询 | p停止 | r继续 | c清理");
  });

  test("expandTasks=true 显示未完成 phase 的 task（缩进 + 符号）", () => {
    __setI18nForTest(undefined);
    const g = goal([p(1, "阶段", [t(1, "task1", "in_progress", { activeForm: "正在做" })], "in_progress")]);
    const lines = renderPlanLines(g, { expandTasks: true });
    expect(lines.some((l) => l.includes("task1"))).toBe(true);
    const taskLine = lines.find((l) => l.includes("task1"))!;
    expect(taskLine).toContain("│");
    expect(taskLine).toContain("◐");
    expect(taskLine).toContain("(正在做)");
    expect(lines.at(-1)).toContain("Ctrl+O 收起详情");
    expect(lines.at(-1)).toContain("/dgoal s查询 | p停止 | r继续 | c清理");
  });

  test("进行中 phase 内的 done task 在展开态仍显示删除线", () => {
    __setI18nForTest(undefined);
    const g = goal([p(1, "阶段", [t(1, "task1", "done")], "in_progress")]);
    const lines = renderPlanLines(g, { expandTasks: true });
    const taskLine = lines.find((l) => l.includes("task1"))!;
    expect(taskLine).toContain("\u001b[9m");
    expect(taskLine).toContain("task1");
    expect(taskLine).toContain("\u001b[29m");
  });

  test("done phase 持久显示标题，但展开态不再显示其 task", () => {
    __setI18nForTest(undefined);
    const g = goal([
      p(1, "已完成阶段", [t(1, "done-task", "done")], "done"),
      p(2, "当前阶段", [t(2, "active-task", "in_progress")], "in_progress"),
    ]);
    const lines = renderPlanLines(g, { expandTasks: true });
    expect(lines.some((l) => l.includes("已完成阶段"))).toBe(true);
    expect(lines.some((l) => l.includes("当前阶段"))).toBe(true);
    expect(lines.some((l) => l.includes("done-task"))).toBe(false);
    expect(lines.some((l) => l.includes("active-task"))).toBe(true);
  });

  test("pi-di18n 可覆盖浮层提示为英文", () => {
    __setI18nForTest({
      t(fullKey, params) {
        const messages: Record<string, string> = {
          "dgoal.overlay.commands": "/dgoal status | pause | resume | clear",
          "dgoal.overlay.showTasks": "⌨ Ctrl+O expand details · {commands}",
          "dgoal.overlay.hideTasks": "⌨ Ctrl+O collapse details · {commands}",
          "dgoal.overlay.more": "└─ +{count} more",
        };
        return (messages[fullKey] ?? fullKey).replace(/\{([a-zA-Z0-9_]+)\}/g, (_m, name) => String(params?.[name] ?? `{${name}}`));
      },
    });
    try {
      const g = goal([p(1, "阶段", [t(1, "task1", "in_progress")], "in_progress")]);
      const lines = renderPlanLines(g, { expandTasks: false });
      expect(lines.at(-1)).toContain("Ctrl+O expand details");
      expect(lines.at(-1)).toContain("/dgoal status | pause | resume | clear");
    } finally {
      __setI18nForTest(undefined);
    }
  });

  test("展开后内容过多时仍保留隐藏 task 的 i18n hint", () => {
    __setI18nForTest(undefined);
    const g = goal([
      p(1, "阶段A", [t(1, "task1"), t(2, "task2"), t(3, "task3")], "in_progress"),
      p(2, "阶段B", [t(4, "task4"), t(5, "task5"), t(6, "task6")], "pending"),
      p(3, "阶段C", [t(7, "task7"), t(8, "task8"), t(9, "task9")], "pending"),
    ]);
    const lines = renderPlanLines(g, { expandTasks: true });
    expect(lines.length).toBeLessThanOrEqual(10);
    expect(lines.at(-1)).toContain("Ctrl+O 收起详情");
    expect(lines.at(-2)).toContain("more");
  });
});

describe("切片3 · 10 行折叠", () => {
  test("phase 超过上限截断（不超 10 行）", () => {
    const phases = Array.from({ length: 20 }, (_, i) => p(i + 1, `阶段${i}`, [], "pending"));
    const g = goal(phases);
    const lines = renderPlanLines(g, { expandTasks: true });
    // heading + body + more + hint，不超过 10 行，避免触发 Pi core 的 widget truncated。
    expect(lines.length).toBeLessThanOrEqual(10);
  });

  test("heading 按当前终端宽度裁切 objective，并保留进度与耗时", () => {
    const width = 52;
    const long = "这是一个很长的中文 Task Plan 标题，需要根据当前终端宽度主动裁切";
    const g = goal([p(0, long, [t(1, "任务")], "pending")], { objective: long, planType: "task" });
    const lines = renderPlanLines(g, noHide, width);
    expect(visibleWidth(lines[0])).toBeLessThanOrEqual(width);
    expect(lines[0]).toContain("…");
    expect(lines[0]).toContain("0/1 tasks");
    expect(lines[0]).toContain("⏱️");
  });

  test("极窄宽度优先保留紧凑进度/耗时，非正宽度不输出越界行", () => {
    const g = goal([p(0, "内部", [t(1, "任务")])], { objective: "极窄终端标题", planType: "task" });
    const narrow = renderPlanLines(g, noHide, 10);
    expect(narrow.every((line) => visibleWidth(line) <= 10)).toBe(true);
    expect(narrow[0]).toContain("0/1");
    expect(narrow[0]).toContain("⏱");
    expect(renderPlanLines(g, noHide, 0)).toEqual([]);
  });

  test("PlanOverlay 通过 widget Component 的 render(width) 使用实时终端宽度", () => {
    let widget: unknown;
    const overlay = new PlanOverlay();
    __setGoalForTest(goal([p(0, "内部", [t(1, "任务")])], {
      objective: "很长很长很长很长很长很长很长很长的 Task Plan 标题",
      planType: "task",
    }));
    overlay.setUI({
      setWidget: (_key, value) => { widget = value; },
      getToolsExpanded: () => false,
    });
    try {
      overlay.update();
      expect(typeof widget).toBe("function");
      const component = (widget as (tui: unknown, theme: unknown) => { render(width: number): string[] })({}, {});
      const lines = component.render(44);
      expect(lines.every((line) => visibleWidth(line) <= 44)).toBe(true);
      expect(lines[0]).toContain("0/1 tasks");
    } finally {
      overlay.dispose();
      __resetGoalForTest();
    }
  });
});
