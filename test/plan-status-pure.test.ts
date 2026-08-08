// ADR 0051：唯一 Work List 的纯 TUI 投影与导航测试。
import { describe, expect, test } from "bun:test";

import {
  buildBodyLines,
  buildBodyLinesNoHeading,
  buildHeadingLine,
  buildPlanStatusDetailLines,
  buildPlanStatusListLines,
  colorize,
  computePlanStatusSelection,
  computeScrollOffset,
  getPlanStatusTargets,
  type GoalState,
  type RenderLine,
  type WorkItem,
  type WorkItemStatus,
  type WorkPhase,
  type WorkPhaseStatus,
} from "../index.ts";

function mockTheme(): any {
  return {
    fg: (color: string, value: string) => `<${color}>${value}</${color}>`,
    bold: (value: string) => `<bold>${value}</bold>`,
  };
}

function item(id: number, subject: string, status: WorkItemStatus = "pending", extra: Partial<WorkItem> = {}): WorkItem {
  return { id, subject, description: `${subject} 的执行说明`, status, ...extra };
}

function phase(id: number, subject: string, items: WorkItem[], status: WorkPhaseStatus = "pending", extra: Partial<WorkPhase> = {}): WorkPhase {
  return { id, subject, description: `${subject} 的阶段说明`, items, status, revision: 0, ...extra };
}

function goal(phases: WorkPhase[], rootItems: WorkItem[] = [], overrides: Partial<GoalState> = {}): GoalState {
  const now = Date.now();
  return {
    id: "g1",
    objective: "实施 v0.8.1",
    description: "完成唯一 Work List 的状态查询。",
    status: "active",
    startedAt: now - 5 * 60_000,
    updatedAt: now,
    iteration: 0,
    workList: { items: rootItems, phases, nextItemId: 100, nextPhaseId: 100, revision: 3 },
    contract: {
      id: "run-1",
      profile: "staged_check",
      startedAt: now - 5 * 60_000,
      revision: 3,
      transitions: [{ to: "staged_check", at: now - 5 * 60_000, revision: 3 }],
    },
    ...overrides,
  };
}

describe("Work List body projection", () => {
  test("无 Goal、无 Work List 或 pending 时返回空", () => {
    expect(buildBodyLines(undefined)).toEqual([]);
    expect(buildBodyLines({ ...goal([]), workList: undefined })).toEqual([]);
    expect(buildBodyLines(goal([], [], { status: "pending" }))).toEqual([]);
  });

  test("按 root Work Item、Phase、Phase Work Item 顺序投影稳定 target", () => {
    const g = goal(
      [phase(1, "实现", [item(2, "写代码", "in_progress")], "in_progress")],
      [item(1, "确认边界")],
    );
    const lines = buildBodyLines(g);
    expect(lines.map((line) => line.type)).toEqual(["heading", "spacer", "item", "phase", "item"]);
    expect(lines[2].target).toEqual({ kind: "item", id: 1 });
    expect(lines[3].target).toEqual({ kind: "phase", id: 1 });
    expect(lines[4].target).toEqual({ kind: "item", id: 2 });
    expect(lines[3].text).toContain("Phase #1 实现");
    expect(lines[4].text).toContain("#2 写代码");
    expect(buildBodyLinesNoHeading(g)).toEqual(lines.slice(2));
  });

  test("blocked/abandoned 原因与 terminal 删除线可见", () => {
    const g = goal([
      phase(1, "阶段", [
        item(1, "完成项", "done", { evidence: "bun test" }),
        item(2, "放弃项", "abandoned", { abandonedReason: "范围外" }),
      ], "blocked", { blockedReason: "等待授权" }),
    ]);
    const lines = buildBodyLines(g);
    expect(lines.find((line) => line.type === "phase")?.text).toContain("[等待授权]");
    expect(lines.find((line) => line.text.includes("完成项"))?.text).toContain("\u001b[9m");
    expect(lines.find((line) => line.text.includes("放弃项"))?.text).toContain("[范围外]");
  });
});

describe("heading 与 Current 状态投影", () => {
  test("heading 显示 Profile、Work Item/Phase 进度与耗时", () => {
    const g = goal([phase(1, "实现", [item(1, "编码", "done", { evidence: "bun test" })], "done")]);
    const line = buildHeadingLine(g);
    expect(line).toContain("🎯 实施 v0.8.1");
    expect(line).toContain("Staged Check · 1/1 items · 1/1 phases");
    expect(line).toContain("⏱️");
  });

  test("paused 耗时冻结在 pauseStartedAt 并排除累计暂停", () => {
    const realNow = Date.now;
    Date.now = () => 99_000;
    try {
      const g = goal([], [], { status: "paused", startedAt: 1_000, updatedAt: 9_000, pauseStartedAt: 9_000, pausedTotalMs: 2_000 });
      expect(buildHeadingLine(g)).toContain("⏱️ 6s");
    } finally {
      Date.now = realNow;
    }
  });

  test("列表显示 Goal 说明、Profile/revision、frontier 与审核结论", () => {
    const checked = phase(1, "实现", [item(1, "编码", "done", { evidence: "bun test" })], "in_progress", {
      check: { status: "rejected", report: "需要补测试", revision: 0, checkedAt: 1 },
      feedback: { report: "需要补测试", createdAt: 1 },
    });
    const g = goal([checked]);
    const text = buildPlanStatusListLines(g).map((line) => line.text).join("\n");
    expect(text).toContain("完成唯一 Work List 的状态查询");
    expect(text).toContain("Staged Check · Work List revision 3");
    expect(text).toContain("当前 frontier");
    expect(buildPlanStatusDetailLines(g, { kind: "phase", id: 1 }).join("\n")).toContain("最新反馈：需要补测试");
  });
});

describe("Current targets 与详情", () => {
  test("Phase 与 Work Item 使用各自 namespace target", () => {
    const g = goal([phase(1, "实现", [item(1, "写测试")], "in_progress")]);
    expect(getPlanStatusTargets(g)).toEqual([
      { kind: "phase", id: 1 },
      { kind: "item", id: 1 },
    ]);
  });

  test("Work Item 详情显示位置、依赖、证据、原因与交付物", () => {
    const work = item(2, "修复", "blocked", {
      blockedBy: [1],
      blockedReason: "等待 Work Item #1",
      evidence: "定向测试输出",
      deliverables: [{ target: "src/x.ts", description: "实现完成" }],
      deliverableEvidence: [{ target: "src/x.ts", evidence: "文件存在" }],
    });
    const text = buildPlanStatusDetailLines(goal([phase(1, "实现", [work], "blocked")]), { kind: "item", id: 2 }).join("\n");
    expect(text).toContain("Work Item #2 · 修复");
    expect(text).toContain("所在 Phase：#1 实现");
    expect(text).toContain("依赖：#1");
    expect(text).toContain("证据：定向测试输出");
    expect(text).toContain("阻塞原因：等待 Work Item #1");
    expect(text).toContain("src/x.ts：实现完成");
    expect(text).toContain("src/x.ts：文件存在");
  });
});

describe("colorize hierarchy", () => {
  const theme = mockTheme();
  const line = (type: RenderLine["type"], status?: WorkItemStatus | WorkPhaseStatus, text = "X"): RenderLine => ({ type, status, text });

  test("heading 为 accent+bold，Phase 为 text，Work Item 为 dim", () => {
    expect(colorize(line("heading", undefined, "🎯 Goal"), theme)).toContain("<accent><bold>");
    expect(colorize(line("phase", "in_progress", "Phase"), theme)).toContain("<text>");
    expect(colorize(line("item", "in_progress", "Work Item"), theme)).toContain("<dim>");
  });

  test("状态不额外改变层级粗细", () => {
    expect(colorize(line("phase", "in_progress", "Phase"), theme)).not.toContain("<bold>");
    expect(colorize(line("item", "done", "Work Item"), theme)).not.toContain("<bold>");
  });
});

describe("selection 与 scroll 纯函数", () => {
  test("选择支持上下与 vim 首尾；翻页键留给物理滚动", () => {
    expect(computePlanStatusSelection("j", 0, 25)).toBe(1);
    expect(computePlanStatusSelection("k", 0, 25)).toBe(0);
    expect(computePlanStatusSelection("\u001b[6~", 1, 25)).toBeNull();
    expect(computePlanStatusSelection("G", 1, 25)).toBe(24);
    expect(computePlanStatusSelection("g", 24, 25)).toBe(0);
  });

  test("scroll 支持退出、逐行、翻页、首尾与 clamp", () => {
    expect(computeScrollOffset("\u001b", 0, 100, 20)).toBe("exit");
    expect(computeScrollOffset("\u0003", 0, 100, 20)).toBe("exit");
    expect(computeScrollOffset("j", 5, 100, 20)).toBe(6);
    expect(computeScrollOffset("k", 5, 100, 20)).toBe(4);
    expect(computeScrollOffset("\u001b[6~", 0, 100, 20)).toBe(10);
    expect(computeScrollOffset("\u001b[5~", 15, 100, 20)).toBe(5);
    expect(computeScrollOffset("G", 0, 100, 20)).toBe(80);
    expect(computeScrollOffset("g", 50, 100, 20)).toBe(0);
    expect(computeScrollOffset("j", 80, 100, 20)).toBe(80);
    expect(computeScrollOffset("j", 0, 0, 20)).toBe(0);
  });
});
