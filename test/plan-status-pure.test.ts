// 切片 1 验收：RenderLine / buildBodyLines* / colorize / computeScrollOffset 纯函数测试。
// 见 doc/40-版本实施方案/42-v0.4.2-dgoal-s-modal-实施方案.md 切片 1 + 4。
import { describe, expect, test } from "bun:test";

import {
  buildBodyLines,
  buildBodyLinesNoHeading,
  buildHeadingLine,
  colorize,
  computeScrollOffset,
  type LoopGoal,
  type Phase,
  type PlanStatus,
  type RenderLine,
  type Task,
  type TaskPlan,
} from "../index.ts";

// ---- mock theme：最小可识别 fg/bold 输出（不依赖真实 pi-theme） ----
const RESET = "\u001b[0m";
function mockTheme(): any {
  const fg = (color: string, s: string) => `<${color}>${s}</${color}>`;
  return {
    fg,
    bold: (s: string) => `<bold>${s}</bold>`,
  };
}

// ---- goal/phase/task 工厂（与 plan-overlay-render.test.ts 保持一致） ----
function t(id: number, subject: string, status: Task["status"] = "pending", extra: Partial<Task> = {}): Task {
  return { id, subject, status, ...extra };
}
function p(id: number, subject: string, tasks: Task[], status: Phase["status"] = "pending", extra: Partial<Phase> = {}): Phase {
  return { id, subject, tasks, status, ...extra };
}
function goal(phases: Phase[], overrides: Partial<LoopGoal> = {}): LoopGoal {
  const now = Date.now();
  return {
    id: "g1",
    objective: "实施 v0.4.2",
    status: "active",
    startedAt: now - 5 * 60 * 1000, // 5m ago — elapsed 走 < 1h 分支
    updatedAt: now - 5 * 60 * 1000,
    iteration: 0,
    plan: { phases, nextId: 100 } as TaskPlan,
    ...overrides,
  };
}

// =============================================================================
// buildBodyLines / buildBodyLinesNoHeading / buildHeadingLine
// =============================================================================

describe("切片 1 · buildBodyLines 返回 RenderLine[]", () => {
  test("无 goal 返回空", () => {
    expect(buildBodyLines(undefined)).toEqual([]);
  });

  test("无 plan 返回空", () => {
    expect(buildBodyLines({ ...goal([]), plan: undefined })).toEqual([]);
  });

  test("空 phases 返回空", () => {
    expect(buildBodyLines(goal([]))).toEqual([]);
  });

  test("goal pending 返回空（启动中不显示）", () => {
    expect(buildBodyLines(goal([p(1, "p", [], "in_progress")], { status: "pending" }))).toEqual([]);
  });

  test("正常 goal：返回 heading + spacer + phase + task", () => {
    const g = goal([
      p(1, "phaseA", [t(1, "taskA1", "in_progress")], "in_progress"),
      p(2, "phaseB", [], "pending"),
    ]);
    const lines = buildBodyLines(g);
    expect(lines.length).toBe(5); // heading + spacer + phase + task + phase
    expect(lines[0].type).toBe("heading");
    expect(lines[0].status).toBeUndefined();
    expect(lines[0].text).toContain("🎯 实施 v0.4.2");
    expect(lines[1].type).toBe("spacer");
    expect(lines[1].text).toBe("");
    expect(lines[2].type).toBe("phase");
    expect(lines[2].status).toBe("in_progress");
    expect(lines[2].text).toContain("🔄 phaseA");
    expect(lines[3].type).toBe("task");
    expect(lines[3].status).toBe("in_progress");
    expect(lines[3].text).toContain("◐ taskA1");
    expect(lines[4].type).toBe("phase");
    expect(lines[4].status).toBe("pending");
    expect(lines[4].text).toContain("⬜ phaseB");
  });

  test("blocked phase 带 blockedReason 后缀", () => {
    const g = goal([p(1, "phaseA", [], "blocked", { blockedReason: "等 X 完成" })]);
    const lines = buildBodyLines(g);
    const phaseLine = lines.find((l) => l.type === "phase");
    expect(phaseLine?.text).toContain("[等 X 完成]");
    expect(phaseLine?.text).toContain("🚧");
  });

  test("completed/done phase 用 ✅", () => {
    const g = goal([p(1, "p", [], "done")]);
    expect(buildBodyLines(g)[2].text).toContain("✅");
    const g2 = goal([p(1, "p", [], "completed")]);
    expect(buildBodyLines(g2)[2].text).toContain("✅");
  });

  test("done 状态的 goal 不被过滤（用户确认后消失由 dgoal 流程处理）", () => {
    expect(buildBodyLines(goal([p(1, "p", [], "done")], { status: "done" })).length).toBeGreaterThan(0);
  });
});

describe("切片 1 · buildBodyLinesNoHeading 去掉 heading + spacer", () => {
  test("返回 body 不含 heading", () => {
    const g = goal([
      p(1, "p1", [t(1, "t1")], "in_progress"),
      p(2, "p2", [], "pending"),
    ]);
    const all = buildBodyLines(g);
    const noHead = buildBodyLinesNoHeading(g);
    expect(noHead.length).toBe(all.length - 2);
    expect(noHead.every((l) => l.type !== "heading")).toBe(true);
  });
});

describe("切片 1 · buildHeadingLine 量化 elapsed", () => {
  test("active goal 返回 🎯 + objective + (X/Y) + ⏱️ elapsed", () => {
    const g = goal([p(1, "p1", [], "done")], {
      status: "active",
      startedAt: 100_000,
      updatedAt: 100_000 + 7 * 60 * 1000 + 3 * 1000, // 7m 3s ago
    });
    const line = buildHeadingLine(g);
    expect(line).toContain("🎯");
    expect(line).toContain("实施 v0.4.2");
    expect(line).toContain("(1/1)");
    expect(line).toContain("⏱️");
  });

  test("active elapsed 排除已累计 pausedTotalMs", () => {
    const realNow = Date.now;
    Date.now = () => 10_000;
    try {
      const g = goal([p(1, "p1", [], "done")], {
        status: "active",
        startedAt: 1_000,
        updatedAt: 1_000,
        pausedTotalMs: 4_000,
      });
      // 10s - 1s - 4s = 5s
      expect(buildHeadingLine(g)).toContain("⏱️ 5s");
    } finally {
      Date.now = realNow;
    }
  });

  test("objective 多行时 heading 只显示首行", () => {
    const g = goal([p(1, "p1", [], "done")], {
      objective: "第一行目标\n第二行说明",
    });
    const line = buildHeadingLine(g);
    expect(line).toContain("第一行目标");
    expect(line).not.toContain("第二行说明");
  });

  test("paused elapsed 冻结在 pauseStartedAt，且不把当前 pause 窗口算进去", () => {
    const realNow = Date.now;
    Date.now = () => 99_000;
    try {
      const g = goal([p(1, "p1", [], "done")], {
        status: "paused",
        startedAt: 1_000,
        updatedAt: 9_000,
        pauseStartedAt: 9_000,
        pausedTotalMs: 2_000,
      });
      // 冻结在 9s - 1s - 2s = 6s，而不是把 99s 也算进去
      expect(buildHeadingLine(g)).toContain("⏱️ 6s");
    } finally {
      Date.now = realNow;
    }
  });
});

// =============================================================================
// colorize：9 种 status × type 映射
// =============================================================================

describe("切片 1 · colorize 按 status × type 染色", () => {
  const th = mockTheme();

  function lineOf(type: RenderLine["type"], status?: PlanStatus, text = "X"): RenderLine {
    return { type, status, text };
  }

  test("heading → accent + bold", () => {
    const out = colorize(lineOf("heading", undefined, "🎯 hello"), th);
    expect(out).toContain("<bold>");
    expect(out).toContain("<accent>");
    expect(out).toContain("🎯 hello");
  });

  test("spacer → 原样 text", () => {
    expect(colorize(lineOf("spacer", undefined, ""), th)).toBe("");
  });

  test("phase in_progress → accent + bold（最显眼）", () => {
    const out = colorize(lineOf("phase", "in_progress", "├─ 🔄 p"), th);
    expect(out).toContain("<accent>");
    expect(out).toContain("<bold>");
  });

  test("phase done → success（绿）", () => {
    const out = colorize(lineOf("phase", "done", "├─ ✅ p"), th);
    expect(out).toContain("<success>");
    expect(out).not.toContain("<bold>");
  });

  test("phase completed → success（兼容老命名）", () => {
    expect(colorize(lineOf("phase", "completed", "p"), th)).toContain("<success>");
  });

  test("phase blocked → warning（黄）", () => {
    const out = colorize(lineOf("phase", "blocked", "├─ 🚧 p"), th);
    expect(out).toContain("<warning>");
  });

  test("phase pending → muted（灰）", () => {
    const out = colorize(lineOf("phase", "pending", "├─ ⬜ p"), th);
    expect(out).toContain("<muted>");
  });

  test("task done → dim（淡灰，不抢 phase）", () => {
    const out = colorize(lineOf("task", "done", "✓"), th);
    expect(out).toContain("<dim>");
    expect(out).not.toContain("<success>");
  });

  test("task in_progress → accent + bold", () => {
    const out = colorize(lineOf("task", "in_progress", "◐"), th);
    expect(out).toContain("<accent>");
    expect(out).toContain("<bold>");
  });

  test("task blocked → warning", () => {
    expect(colorize(lineOf("task", "blocked", "⚠"), th)).toContain("<warning>");
  });

  test("task pending → muted（默认）", () => {
    expect(colorize(lineOf("task", "pending", "○"), th)).toContain("<muted>");
  });
});

// =============================================================================
// computeScrollOffset：9 种键 + clamp 边界
// =============================================================================

describe("切片 1 · computeScrollOffset 9 种键", () => {
  test("escape → 'exit'", () => {
    expect(computeScrollOffset("\u001b", 0, 100, 20)).toBe("exit");
  });
  test("ctrl+c → 'exit'", () => {
    expect(computeScrollOffset("\u0003", 5, 100, 20)).toBe("exit");
  });
  test("down → +1", () => {
    expect(computeScrollOffset("\u001b[B", 0, 100, 20)).toBe(1);
  });
  test("j → +1（vim）", () => {
    expect(computeScrollOffset("j", 5, 100, 20)).toBe(6);
  });
  test("up → -1", () => {
    expect(computeScrollOffset("\u001b[A", 5, 100, 20)).toBe(4);
  });
  test("k → -1（vim）", () => {
    expect(computeScrollOffset("k", 5, 100, 20)).toBe(4);
  });
  test("pagedown → +10", () => {
    expect(computeScrollOffset("\u001b[6~", 0, 100, 20)).toBe(10);
  });
  test("ctrl+d → +10", () => {
    expect(computeScrollOffset("\u0004", 0, 100, 20)).toBe(10);
  });
  test("pageup → -10", () => {
    expect(computeScrollOffset("\u001b[5~", 15, 100, 20)).toBe(5);
  });
  test("ctrl+u → -10", () => {
    expect(computeScrollOffset("\u0015", 15, 100, 20)).toBe(5);
  });
  test("end → maxOffset", () => {
    expect(computeScrollOffset("\u001b[F", 0, 100, 20)).toBe(80);
  });
  test("G → maxOffset", () => {
    expect(computeScrollOffset("G", 0, 100, 20)).toBe(80);
  });
  test("home → 0", () => {
    expect(computeScrollOffset("\u001b[H", 50, 100, 20)).toBe(0);
  });
  test("g → 0", () => {
    expect(computeScrollOffset("g", 50, 100, 20)).toBe(0);
  });
  test("未识别键 → null", () => {
    expect(computeScrollOffset("x", 5, 100, 20)).toBeNull();
    expect(computeScrollOffset("zzz", 5, 100, 20)).toBeNull();
  });

  test("clamp：下到顶不变", () => {
    expect(computeScrollOffset("\u001b[B", 0, 100, 20)).toBe(1); // 0+1=1 OK
    expect(computeScrollOffset("\u001b[A", 0, 100, 20)).toBe(0); // 0-1 clamp 到 0
    expect(computeScrollOffset("k", 0, 100, 20)).toBe(0);
  });

  test("clamp：下到底不变", () => {
    const max = 100 - 20; // 80
    expect(computeScrollOffset("\u001b[B", max, 100, 20)).toBe(max); // 不超
    expect(computeScrollOffset("j", max, 100, 20)).toBe(max);
    expect(computeScrollOffset("\u001b[6~", max, 100, 20)).toBe(max); // pageDown 不超
  });

  test("空 plan (totalLines=0) → maxOffset=0", () => {
    expect(computeScrollOffset("\u001b[B", 0, 0, 20)).toBe(0);
    expect(computeScrollOffset("G", 0, 0, 20)).toBe(0);
  });

  test("maxVisible > totalLines 时 maxOffset=0", () => {
    expect(computeScrollOffset("\u001b[B", 0, 10, 20)).toBe(0);
  });
});
