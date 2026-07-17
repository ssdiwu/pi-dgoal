// 切片 1 验收：RenderLine / buildBodyLines* / colorize / computeScrollOffset 纯函数测试。
// 见 doc/40-版本实施方案/42-v0.4.2-dgoal-s-modal-实施方案.md 切片 1 + 4。
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
  deriveLatestAuditObservation,
  derivePlanFrontierDiagnostic,
  getPlanStatusTargets,
  type GoalState,
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
  return { id, subject, description: `${subject} 任务说明`, status, ...extra };
}
function p(id: number, subject: string, tasks: Task[], status: Phase["status"] = "pending", extra: Partial<Phase> = {}): Phase {
  return { id, subject, description: `${subject} 阶段说明`, tasks, status, ...extra };
}
function goal(phases: Phase[], overrides: Partial<GoalState> = {}): GoalState {
  const now = Date.now();
  return {
    id: "g1",
    objective: "实施 v0.4.2",
    description: "完成两层状态查询。",
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

  test("正常 goal：/dgoal s 详细查询 Modal 仍返回 heading + spacer + phase + task", () => {
    const g = goal([
      p(1, "phaseA", [t(1, "taskA1", "in_progress")], "in_progress"),
      p(2, "phaseB", [], "pending"),
    ]);
    const lines = buildBodyLines(g);
    expect(lines.length).toBe(5);
    expect(lines[0].type).toBe("heading");
    expect(lines[0].status).toBeUndefined();
    expect(lines[0].text).toContain("🎯 实施 v0.4.2");
    expect(lines[1].type).toBe("spacer");
    expect(lines[1].text).toBe("");
    expect(lines[2].type).toBe("phase");
    expect(lines[2].status).toBe("in_progress");
    expect(lines[2].text).toContain("◐ phaseA");
    expect(lines[3].type).toBe("task");
    expect(lines[3].status).toBe("in_progress");
    expect(lines[3].text).toContain("◐ taskA1");
    expect(lines[4].type).toBe("phase");
    expect(lines[4].status).toBe("pending");
    expect(lines[4].text).toContain("○ phaseB");
  });

  test("/dgoal s 详细查询 Modal 会保留 done phase 的 task 细节", () => {
    const g = goal([p(1, "phaseA", [t(1, "taskA1", "done")], "done")]);
    const lines = buildBodyLines(g);
    const phaseLine = lines.find((l) => l.type === "phase" && l.text.includes("phaseA"));
    const taskLine = lines.find((l) => l.type === "task" && l.text.includes("taskA1"));
    expect(phaseLine).toBeDefined();
    expect(taskLine).toBeDefined();
  });

  test("blocked phase 带 blockedReason 后缀", () => {
    const g = goal([p(1, "phaseA", [], "blocked", { blockedReason: "等 X 完成" })]);
    const lines = buildBodyLines(g);
    const phaseLine = lines.find((l) => l.type === "phase");
    expect(phaseLine?.text).toContain("[等 X 完成]");
    expect(phaseLine?.text).toContain("⚠");
  });

  test("blocked task 在 Goal Plan 与 Task Plan Modal 都展示 blockedReason", () => {
    const blockedTask = t(1, "taskA", "blocked", { blockedReason: "缺权限" });
    const goalPlanLine = buildBodyLines(goal([p(1, "phaseA", [blockedTask], "blocked")]))
      .find((line) => line.type === "task");
    const taskPlanLine = buildBodyLines(goal([p(1, "hidden", [blockedTask], "blocked")], { planType: "task" }))
      .find((line) => line.type === "task");
    expect(goalPlanLine?.text).toContain("[缺权限]");
    expect(taskPlanLine?.text).toContain("[缺权限]");
  });

  test("done phase 用 ✓", () => {
    const g = goal([p(1, "p", [], "done")]);
    expect(buildBodyLines(g)[2].text).toContain("✓");
    const g2 = goal([p(1, "p", [], "done")]);
    expect(buildBodyLines(g2)[2].text).toContain("✓");
  });

  test("done 状态的 goal 不被过滤（用户确认后消失由 dgoal 流程处理）", () => {
    expect(buildBodyLines(goal([p(1, "p", [], "done")], { status: "done" })).length).toBeGreaterThan(0);
  });

  test("done phase/task 标题文本带删除线，状态字符和树形符号不带（ADR 0009）", () => {
    const g = goal([p(1, "phaseA", [t(1, "taskA1", "done")], "done")]);
    const lines = buildBodyLines(g);
    const phaseLine = lines.find((l) => l.type === "phase" && l.status === "done")!;
    const taskLine = lines.find((l) => l.type === "task" && l.status === "done")!;
    // 标题文本被删除线 ANSI 包裹
    expect(phaseLine.text).toContain("\u001b[9mphaseA\u001b[29m");
    expect(taskLine.text).toContain("\u001b[9mtaskA1\u001b[29m");
    // 状态字符 ✓ 和树形符号 ├─ / │ 不被删除线包裹
    expect(phaseLine.text).not.toContain("\u001b[9m├─");
    expect(phaseLine.text).not.toContain("\u001b[9m✓");
    expect(taskLine.text).not.toContain("\u001b[9m│");
    expect(taskLine.text).not.toContain("\u001b[9m✓");
  });

  test("长 subject / blockedReason 不再被 buildBodyLines 截断，交给 render 换行", () => {
    const longPhase = "p".repeat(200);
    const longReason = "r".repeat(50);
    const longSubject = "a".repeat(50);
    const g = goal([
      p(1, longPhase, [], "blocked", { blockedReason: longReason }),
      p(2, "p2", [t(1, longSubject, "in_progress")], "in_progress"),
    ]);
    const lines = buildBodyLines(g);
    const phaseLine = lines.find((l) => l.type === "phase" && l.status === "blocked")!;
    const taskLine = lines.find((l) => l.type === "task" && l.status === "in_progress")!;
    expect(phaseLine.text).toContain(longPhase);
    expect(phaseLine.text).toContain(longReason);
    expect(taskLine.text).toContain(longSubject);
    expect(phaseLine.text).not.toContain("…");
    expect(taskLine.text).not.toContain("…");
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
  test("active goal 返回 🎯 + phase/task 进度 + ⏱️ elapsed", () => {
    const g = goal([p(1, "p1", [t(1, "t1", "done")], "done")], {
      status: "active",
      startedAt: 100_000,
      updatedAt: 100_000 + 7 * 60 * 1000 + 3 * 1000, // 7m 3s ago
    });
    const line = buildHeadingLine(g);
    expect(line).toContain("🎯");
    expect(line).toContain("实施 v0.4.2");
    expect(line).toContain("1/1 phases");
    expect(line).toContain("1/1 tasks");
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
// colorize：层级基色映射（ADR 0009，状态不再靠颜色或粗体表达）
// =============================================================================

describe("共享 frontier 诊断", () => {
  test("Task Plan 指向当前可执行 task，并要求带 evidence 完成", () => {
    const g = goal([p(1, "隐藏 phase", [t(1, "执行", "in_progress")], "in_progress")], { planType: "task" });
    const diagnostic = derivePlanFrontierDiagnostic(g);
    expect(diagnostic?.reason).toContain("task #1 尚未带可复验证据完成");
    expect(diagnostic?.nextAction).toContain("evidence");
    expect(buildPlanStatusListLines(g).map((line) => line.text).join("\n")).toContain("当前 frontier");
  });

  test("由 blocked task 聚合出的 blocked phase 仍解释 task blocker", () => {
    const blockedTask = t(1, "等待权限", "blocked", { blockedReason: "缺少授权" });
    const g = goal([p(1, "实现", [blockedTask], "blocked")], { planType: "phase" });
    const diagnostic = derivePlanFrontierDiagnostic(g);
    expect(diagnostic?.reason).toContain("task #1 被阻塞：缺少授权");
    expect(diagnostic?.nextAction).toContain("task #1");
  });

  test("选中 task 只解释其未完成依赖，不枚举未来 phase", () => {
    const g = goal([p(1, "实现", [
      t(1, "前置", "in_progress"),
      t(2, "后续", "pending", { blockedBy: [1] }),
    ], "in_progress")], { planType: "phase" });
    const diagnostic = derivePlanFrontierDiagnostic(g, { kind: "task", id: 2 });
    expect(diagnostic?.reason).toContain("等待依赖 #1(in_progress) 完成");
    expect(diagnostic?.nextAction).toContain("先完成依赖 #1(in_progress)");
  });

  test("Goal Plan 在当前 phase 的 task 完成后要求 current revision 的 phase_check", () => {
    const g = goal([p(1, "实现", [t(1, "编码", "done", { evidence: "bun test" })], "in_progress")], {
      planType: "goal",
      plan: { revision: 3, nextId: 2, phases: [p(1, "实现", [t(1, "编码", "done", { evidence: "bun test" })], "in_progress")] },
    });
    const diagnostic = derivePlanFrontierDiagnostic(g);
    expect(diagnostic?.reason).toContain("缺少当前 revision 的 approved phase_check");
    expect(diagnostic?.nextAction).toContain("phase_check");
  });

  test("只解释当前 frontier；未来 phase 的详情指回当前 phase", () => {
    const g = goal([
      p(1, "当前", [t(1, "执行", "in_progress")], "in_progress"),
      p(2, "未来", [t(2, "稍后")], "pending"),
    ], { planType: "phase" });
    const detail = buildPlanStatusDetailLines(g, { kind: "phase", id: 2 }).join("\n");
    expect(detail).toContain("当前 frontier 仍在 phase #1");
    expect(detail).not.toContain("task #2 已就绪");
  });

  test("全部 phase done 后只解释 goal_check 这一项当前完成门", () => {
    const donePhase = p(1, "实现", [t(1, "编码", "done", { evidence: "bun test" })], "done");
    const g = goal([donePhase], { planType: "phase", plan: { revision: 2, nextId: 2, phases: [donePhase] } });
    expect(derivePlanFrontierDiagnostic(g)?.nextAction).toContain("goal_check");
  });
});

describe("最新审核信息只读投影", () => {
  test("phase 只展示该 phase 的最新 CheckRecord 与反馈", () => {
    const phase = p(1, "实现", [t(1, "编码", "done", { evidence: "bun test" })], "in_progress", {
      check: { status: "rejected", report: "旧 check report", modelId: "test/model", checkedAt: 1, revision: 2 },
    });
    const g = goal([phase], {
      planType: "goal",
      plan: { revision: 2, nextId: 2, phases: [phase] },
      phaseFeedbackById: {
        "1": { phaseId: 1, report: "当前 phase 最新反馈", createdAt: 2 },
        "2": { phaseId: 2, report: "未来 phase 历史反馈", createdAt: 1 },
      },
    });
    const observation = deriveLatestAuditObservation(g, { kind: "phase", id: 1 });
    expect(observation?.check?.status).toBe("rejected");
    expect(observation?.feedback).toBe("当前 phase 最新反馈");
    const detail = buildPlanStatusDetailLines(g, { kind: "phase", id: 1 }).join("\n");
    expect(detail).toContain("最新建检：rejected");
    expect(detail).toContain("最新反馈：当前 phase 最新反馈");
    expect(detail).not.toContain("未来 phase 历史反馈");
  });

  test("approved phase check 不把残留 rejected feedback 误显示为最新", () => {
    const phase = p(1, "实现", [t(1, "编码", "done", { evidence: "bun test" })], "in_progress", {
      check: { status: "approved", report: "通过", modelId: "test/model", checkedAt: 2, revision: 2 },
    });
    const g = goal([phase], {
      planType: "goal",
      plan: { revision: 2, nextId: 2, phases: [phase] },
      phaseFeedbackById: { "1": { phaseId: 1, report: "旧 rejected feedback", createdAt: 1 } },
    });
    const observation = deriveLatestAuditObservation(g, { kind: "phase", id: 1 });
    expect(observation?.check?.status).toBe("approved");
    expect(observation?.feedback).toBeUndefined();
  });

  test("approved goal check 不把旧 rejected 声明误显示为最新", () => {
    const donePhase = p(1, "实现", [t(1, "编码", "done", { evidence: "bun test" })], "done");
    const g = goal([donePhase], {
      planType: "phase",
      plan: { revision: 4, nextId: 2, phases: [donePhase] },
      goalCheck: { status: "approved", report: "通过", modelId: "test/model", checkedAt: 4, revision: 4 },
      finalAuditHistory: [{ attempt: 1, report: "旧反馈", summary: "旧失败声明", verification: "旧验证", createdAt: 1 }],
    });
    const observation = deriveLatestAuditObservation(g);
    expect(observation?.check?.status).toBe("approved");
    expect(observation?.latestClaim).toBeUndefined();
    expect(buildPlanStatusListLines(g).map((line) => line.text).join("\n")).not.toContain("旧失败声明");
  });

  test("goal 只展示最新反馈与最新完成声明，内部旧账本不泄露", () => {
    const donePhase = p(1, "实现", [t(1, "编码", "done", { evidence: "bun test" })], "done");
    const g = goal([donePhase], {
      planType: "phase",
      plan: { revision: 4, nextId: 2, phases: [donePhase] },
      goalCheck: { status: "rejected", report: "最新终审反馈", modelId: "test/model", checkedAt: 3, revision: 4 },
      finalFeedback: { report: "最新终审反馈", rejectedCount: 2, createdAt: 3 },
      finalAuditHistory: [
        { attempt: 1, report: "旧报告", summary: "旧完成声明", verification: "旧验证", createdAt: 1 },
        { attempt: 2, report: "最新终审反馈", summary: "最新完成声明", verification: "最新验证", createdAt: 3 },
      ],
    });
    const text = buildPlanStatusListLines(g).map((line) => line.text).join("\n");
    expect(text).toContain("最新反馈：最新终审反馈");
    expect(text).toContain("最新完成声明：第 2 次 · 最新完成声明｜验证：最新验证");
    expect(text).not.toContain("旧完成声明");
    expect(text).not.toContain("旧报告");
  });
});

describe("两层 `/dgoal s` 纯函数", () => {
  test("列表页包含 goal description，并给 phase/task 提供稳定 target", () => {
    const g = goal([p(1, "实现", [t(3, "写测试")], "in_progress")]);
    const lines = buildPlanStatusListLines(g);
    expect(lines[0]).toMatchObject({ type: "description", text: "说明：完成两层状态查询。" });
    expect(getPlanStatusTargets(g)).toEqual([
      { kind: "phase", id: 1 },
      { kind: "task", id: 3 },
    ]);
  });

  test("Task Plan 不暴露内部 phase target", () => {
    const g = goal([p(1, "隐藏 phase", [t(1, "执行")])], { planType: "task" });
    expect(getPlanStatusTargets(g)).toEqual([{ kind: "task", id: 1 }]);
  });

  test("phase/task 详情按字段投影并对缺失运行字段显示无", () => {
    const g = goal([p(1, "实现", [t(2, "写代码", "done", { blockedBy: [1], evidence: "bun test" })], "in_progress")]);
    expect(buildPlanStatusDetailLines(g, { kind: "phase", id: 1 }).join("\n"))
      .toContain("实现 阶段说明");
    const taskDetail = buildPlanStatusDetailLines(g, { kind: "task", id: 2 }).join("\n");
    expect(taskDetail).toContain("所在 phase：#1 实现");
    expect(taskDetail).toContain("依赖：#1");
    expect(taskDetail).toContain("证据：bun test");
    expect(taskDetail).toContain("阻塞原因：无");
  });

  test("选中索引支持上下与 vim 首尾；翻页键留给列表物理滚动", () => {
    expect(computePlanStatusSelection("j", 0, 25)).toBe(1);
    expect(computePlanStatusSelection("k", 0, 25)).toBe(0);
    expect(computePlanStatusSelection("\u001b[6~", 1, 25)).toBeNull();
    expect(computePlanStatusSelection("G", 1, 25)).toBe(24);
    expect(computePlanStatusSelection("g", 24, 25)).toBe(0);
    expect(computePlanStatusSelection("?", 2, 25)).toBeNull();
  });
});

describe("切片 1 · colorize 按 line.type 分配层级基色", () => {
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

  test("phase → text（层级基色，与状态无关）", () => {
    // 四种 status 都应该走 text，不再走 success/warning/muted
    for (const status of ["pending", "in_progress", "done", "blocked"] as const) {
      const out = colorize(lineOf("phase", status, "├─ p"), th);
      expect(out).toContain("<text>");
    }
  });

  test("phase in_progress 不再加 bold（状态只靠字符）", () => {
    const out = colorize(lineOf("phase", "in_progress", "├─ ◐ p"), th);
    expect(out).not.toContain("<bold>");
  });

  test("task → dim（层级基色，与状态无关）", () => {
    for (const status of ["pending", "in_progress", "done", "blocked"] as const) {
      const out = colorize(lineOf("task", status, "│ ○ p"), th);
      expect(out).toContain("<dim>");
    }
  });

  test("task in_progress 不再加 bold（状态只靠字符）", () => {
    const out = colorize(lineOf("task", "in_progress", "◐"), th);
    expect(out).not.toContain("<bold>");
  });

  test("层级区分：phase 是 text，task 是 dim，不混淆", () => {
    const phaseOut = colorize(lineOf("phase", "in_progress", "├─ ◐ p"), th);
    const taskOut = colorize(lineOf("task", "in_progress", "│ ◐ t"), th);
    expect(phaseOut).toContain("<text>");
    expect(phaseOut).not.toContain("<dim>");
    expect(taskOut).toContain("<dim>");
    expect(taskOut).not.toContain("<text>");
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
