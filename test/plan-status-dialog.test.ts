// 切片 4 验收：PlanStatusDialog Component 测试（render + handleInput + 边界 + 缓存）。
// 见 doc/40-版本实施方案/42-v0.4.2-dgoal-s-modal-实施方案.md 切片 4。
import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";

import {
  __setCheckSnapshotForTest,
  __setI18nForTest,
  PlanStatusDialog,
  type GoalState,
  type Phase,
  type Task,
  type TaskPlan,
} from "../index.ts";

beforeAllSetI18n();

// 在 bun:test 的 setup 里调 __setI18nForTest 让 t() 走内置中文。
// 不能直接 top-level await（要 await import），用 helper：
function beforeAllSetI18n() {
  // bun:test 不提供 beforeAll 钩子的简洁形式；用 try 在模块加载时跑
  try {
    __setI18nForTest("zh-CN");
  } catch {
    // 容忍 hook 缺失——如果没设也没事，t() 走中文 fallback
  }
}

// ---- mock theme：最小可识别 fg/bold 输出（colorize 用） ----
function mockTheme(): any {
  return {
    fg: (color: string, s: string) => `<${color}>${s}</${color}>`,
    bold: (s: string) => `<bold>${s}</bold>`,
  };
}

// ---- goal/phase/task 工厂 ----
function t(id: number, subject: string, status: Task["status"] = "pending", extra: Partial<Task> = {}): Task {
  return { id, subject, description: `${subject} 的完整任务说明`, status, ...extra };
}
function p(id: number, subject: string, tasks: Task[], status: Phase["status"] = "pending", extra: Partial<Phase> = {}): Phase {
  return { id, subject, description: `${subject} 的完整阶段说明`, tasks, status, ...extra };
}
function goal(phases: Phase[], overrides: Partial<GoalState> = {}): GoalState {
  const now = Date.now();
  return {
    id: "g1",
    objective: "实施 v0.4.2",
    description: "按已确认边界完成实现并验证。",
    status: "active",
    startedAt: now - 5 * 60 * 1000,
    updatedAt: now - 5 * 60 * 1000,
    iteration: 0,
    plan: { phases, nextId: 100 } as TaskPlan,
    ...overrides,
  };
}

// =============================================================================
// render
// =============================================================================

describe("PlanStatusDialog.render", () => {
  test("返回完整 modal：边框 + heading + body + hint", () => {
    const g = goal([p(1, "p1", [], "in_progress")]);
    const dlg = new PlanStatusDialog(g, mockTheme() as any, () => {});
    const lines = dlg.render(80);
    // 列表页包含 goal description、当前 frontier/下一动作、空行、可选 phase、hint 与边框。
    expect(lines.length).toBeGreaterThanOrEqual(9);
    // 第一行 = 上边框 + 标题（mockTheme 包装为 <border>...<accent>...<bold>title</bold>...</accent>...</border>）
    expect(lines[0]).toContain("dgoal 详细查询 Modal");
    expect(lines[0]).toContain("╭─"); // 上边框起手
    expect(lines[0]).toContain("─╮"); // 上边框收尾
    // 第二行 = heading（钉顶，含 🎯）
    expect(lines[1]).toContain("🎯 实施 v0.4.2");
    expect(lines[1]).toContain("<accent>"); // accent 染色
    expect(lines[1]).toContain("<bold>"); // bold
    expect(lines.join("\n")).toContain("按已确认边界完成实现并验证");
    expect(lines.join("\n")).toContain("当前 frontier");
    expect(lines.join("\n")).toContain("下一合法动作");
    expect(lines.join("\n")).toContain("› ");
    // 最后一行 = 下边框
    expect(lines[lines.length - 1]).toContain("╰─");
    expect(lines[lines.length - 1]).toContain("─╯");
  });

  test("标题走 i18n override，而不是硬编码英文", () => {
    __setI18nForTest({
      t: (key: string) => key.endsWith(".status.dialogTitle") ? "本地化状态弹窗" : key,
    } as any);
    try {
      const g = goal([p(1, "p1", [], "in_progress")]);
      const dlg = new PlanStatusDialog(g, mockTheme() as any, () => {});
      const lines = dlg.render(80);
      expect(lines[0]).toContain("本地化状态弹窗");
      expect(lines[0]).not.toContain("Dgoal Status Modal");
    } finally {
      beforeAllSetI18n();
    }
  });

  test("列表页始终提示选择与 Enter 进入详情", () => {
    const dlg = new PlanStatusDialog(goal([p(1, "p1", [], "in_progress")]), mockTheme() as any, () => {});
    const hint = dlg.render(80).at(-2)!;
    expect(hint).toContain("↑/↓/j/k 选择");
    expect(hint).toContain("Enter 查看");
    expect(hint).toContain("ESC 关闭");
  });

  test("建检运行中时 /dgoal s 展示活性片段而不展示报告正文", () => {
    __setCheckSnapshotForTest({
      liveness: "thinking",
      lastSnippet: "read index.ts",
      idleSecondsLeft: 119,
      idleSecondsTotal: 120,
      attempt: 1,
      attemptTotal: 3,
    });
    try {
      const dlg = new PlanStatusDialog(goal([p(1, "p1", [], "in_progress")]), mockTheme() as any, () => {});
      const lines = dlg.render(80);
      expect(lines.join("\n")).toContain("建检活性");
      expect(lines.join("\n")).toContain("read index.ts");
      expect(lines.join("\n")).toContain("第 1/3 次");
      expect(lines.join("\n")).not.toContain("审核报告正文");
    } finally {
      __setCheckSnapshotForTest(undefined);
    }
  });

  test("超长 goal description 可从开头逐页浏览到末尾和 Plan 列表", () => {
    const description = `BEGIN-${"说明".repeat(500)}-END`;
    const dlg = new PlanStatusDialog(
      goal([p(1, "phase-after-description", [], "in_progress")], { description }),
      mockTheme() as any,
      () => {},
    );
    const seen: string[] = [];
    seen.push(dlg.render(40).join("\n"));
    expect(seen[0]).toContain("BEGIN");
    for (let page = 0; page < 30; page += 1) {
      dlg.handleInput("\u001b[6~");
      seen.push(dlg.render(40).join("\n"));
    }
    const all = seen.join("\n");
    expect(all).toContain("END");
    expect(all).toContain("phase-after-description");
  });

  test("heading 钉顶：scroll 到第二页 heading 仍在第 2 行", () => {
    // 制造 30+ phase 让 scroll 生效
    const phases: Phase[] = [];
    for (let i = 1; i <= 35; i++) {
      phases.push(p(i, `phase${i}`, [], "pending"));
    }
    const dlg = new PlanStatusDialog(goal(phases), mockTheme() as any, () => {});
    // 第一次 render
    const first = dlg.render(80);
    expect(first[1]).toContain("🎯"); // heading 在第 2 行
    // handleInput 模拟滚动
    dlg.handleInput("G"); // jump to end
    const second = dlg.render(80);
    expect(second[1]).toContain("🎯"); // heading 仍钉顶
    expect(second[1]).toContain("<accent>"); // 仍是 accent+bold
  });

  test("非正、极窄与标题临界宽度安全降级且不输出超宽行", () => {
    const plainTheme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
    const dlg = new PlanStatusDialog(goal([p(1, "p1", [], "in_progress")]), plainTheme as any, () => {});
    expect(dlg.render(0)).toEqual([]);
    for (let width = 1; width <= 40; width += 1) {
      expect(dlg.render(width).every((line) => visibleWidth(line) <= width)).toBe(true);
    }
  });

  test("empty goal → 带边框的空 dgoal 状态", () => {
    const dlg = new PlanStatusDialog(undefined, mockTheme() as any, () => {});
    const lines = dlg.render(80);
    expect(lines[0]).toContain("╭─");
    expect(lines.join("\n")).toContain("当前没有进行中的 dgoal");
    expect(lines.join("\n")).toContain("/dgoal <goal>");
    expect(lines.join("\n")).toContain("ESC/Ctrl+C 关闭");
    expect(lines.at(-1)).toContain("╰─");
  });

  test("empty phases → 带边框的 fallback 状态", () => {
    const dlg = new PlanStatusDialog(goal([]), mockTheme() as any, () => {});
    const lines = dlg.render(80);
    expect(lines[0]).toContain("╭─");
    expect(lines.join("\n")).toContain("无 plan");
    expect(lines.join("\n")).toContain("ESC/Ctrl+C 关闭");
    expect(lines.at(-1)).toContain("╰─");
  });

  test("render 缓存命中：相同 (width, elapsedSec, checkSnapshot) 第二次返回 cached", () => {
    const g = goal([p(1, "p1", [], "in_progress")]);
    const dlg = new PlanStatusDialog(g, mockTheme() as any, () => {});
    const first = dlg.render(80);
    const second = dlg.render(80); // 同一秒、同一审核快照
    expect(second).toBe(first); // === 引用相等表示缓存
  });

  test("同一秒审核活性快照变化会使 render cache 失效", () => {
    const realNow = Date.now;
    Date.now = () => 1_000_000;
    __setCheckSnapshotForTest(undefined);
    try {
      const dlg = new PlanStatusDialog(goal([p(1, "p1", [], "in_progress")]), mockTheme() as any, () => {});
      const before = dlg.render(80);
      __setCheckSnapshotForTest({ liveness: "thinking", idleSecondsLeft: 60, idleSecondsTotal: 60 });
      const after = dlg.render(80);
      expect(after).not.toBe(before);
      expect(after.join("\n")).toContain("建检活性");
    } finally {
      __setCheckSnapshotForTest(undefined);
      Date.now = realNow;
    }
  });

  test("handleInput 触发 invalidate 后 render 不再缓存命中", () => {
    const phases: Phase[] = [];
    for (let i = 1; i <= 25; i++) phases.push(p(i, `p${i}`, [], "pending"));
    const dlg = new PlanStatusDialog(goal(phases), mockTheme() as any, () => {});
    const before = dlg.render(80);
    dlg.handleInput("j"); // scroll +1 → invalidate
    const after = dlg.render(80);
    expect(after).not.toBe(before); // 缓存失效
    // 第一行（边框）和第二行（heading）相同
    expect(after[0]).toBe(before[0]); // 上边框相同
    expect(after[1]).toBe(before[1]); // heading 相同
    // 选择标记从 p1 移到 p2。
    expect(before.find((line) => line.includes("› "))).toContain("p1");
    expect(after.find((line) => line.includes("› "))).toContain("p2");
    // 最后一行（下边框）相同
    expect(after[after.length - 1]).toBe(before[before.length - 1]); // 下边框相同
  });
});

// =============================================================================
// handleInput：9 种键 + 边界
// =============================================================================

describe("PlanStatusDialog.handleInput", () => {
  test("ESC → done 调一次", () => {
    let doneCount = 0;
    const dlg = new PlanStatusDialog(goal([p(1, "p1", [], "in_progress")]), mockTheme() as any, () => {
      doneCount++;
    });
    dlg.handleInput("\u001b");
    expect(doneCount).toBe(1);
  });

  test("Ctrl+C → done", () => {
    let doneCount = 0;
    const dlg = new PlanStatusDialog(goal([p(1, "p1", [], "in_progress")]), mockTheme() as any, () => {
      doneCount++;
    });
    dlg.handleInput("\u0003");
    expect(doneCount).toBe(1);
  });

  test("↓ 与 j 按逻辑 plan item 移动选中态", () => {
    const phases = [p(1, "p1", [], "pending"), p(2, "p2", [], "pending"), p(3, "p3", [], "pending")];
    const dlg = new PlanStatusDialog(goal(phases), mockTheme() as any, () => {});
    dlg.handleInput("\u001b[B");
    expect(dlg.render(80).find((line) => line.includes("› "))).toContain("p2");
    dlg.handleInput("j");
    expect(dlg.render(80).find((line) => line.includes("› "))).toContain("p3");
  });

  test("End/G 选中最后一项并滚入可见窗口", () => {
    const phases: Phase[] = [];
    for (let i = 1; i <= 25; i++) phases.push(p(i, `p${i}`, [], "pending"));
    const dlg = new PlanStatusDialog(goal(phases), mockTheme() as any, () => {});
    dlg.handleInput("G");
    expect(dlg.render(80).find((line) => line.includes("› "))).toContain("p25");
  });

  test("Home/g 回到第一项并保留选择位置", () => {
    const phases: Phase[] = [];
    for (let i = 1; i <= 25; i++) phases.push(p(i, `p${i}`, [], "pending"));
    const dlg = new PlanStatusDialog(goal(phases), mockTheme() as any, () => {});
    dlg.handleInput("G");
    dlg.handleInput("g");
    expect(dlg.render(80).find((line) => line.includes("› "))).toContain("p1");
  });

  test("未识别键 → noop（不崩）", () => {
    const dlg = new PlanStatusDialog(goal([p(1, "p1", [], "in_progress")]), mockTheme() as any, () => {});
    expect(() => dlg.handleInput("zzz")).not.toThrow();
  });

  test("空 goal：只响应 ESC/Ctrl+C，其他键 noop", () => {
    let doneCount = 0;
    const dlg = new PlanStatusDialog(undefined, mockTheme() as any, () => {
      doneCount++;
    });
    dlg.handleInput("j"); // noop
    expect(doneCount).toBe(0);
    dlg.handleInput("\u001b"); // exit
    expect(doneCount).toBe(1);
  });
});

describe("PlanStatusDialog 两层导航", () => {
  test("Enter 打开 phase 详情，Esc 返回列表且保留原选择", () => {
    let doneCount = 0;
    const phase = p(1, "实现", [t(1, "写代码")], "blocked", {
      description: "先完成最小垂直切片，再扩大覆盖。",
      blockedReason: "等待依赖恢复",
    });
    const dlg = new PlanStatusDialog(goal([phase]), mockTheme() as any, () => { doneCount += 1; });

    dlg.handleInput("\r");
    const detail = dlg.render(100).join("\n");
    expect(detail).toContain("dgoal 计划项详情");
    expect(detail).toContain("phase #1 · 实现");
    expect(detail).toContain("状态：blocked");
    expect(detail).toContain("先完成最小垂直切片，再扩大覆盖");
    expect(detail).toContain("task 进度：0/1");
    expect(detail).toContain("阻塞原因：等待依赖恢复");

    dlg.handleInput("\u001b");
    const list = dlg.render(100);
    expect(doneCount).toBe(0);
    expect(list[0]).toContain("dgoal 详细查询 Modal");
    expect(list.find((line) => line.includes("› "))).toContain("实现");
  });

  test("task 详情展示 description/status/phase/dependencies/evidence/blockedReason", () => {
    const task = t(2, "修复回归", "blocked", {
      description: "复现后只修根因，不改无关断言。",
      blockedBy: [1],
      evidence: "bun test test/regression.test.ts",
      blockedReason: "依赖 task #1",
    });
    const dlg = new PlanStatusDialog(goal([p(1, "实现", [task], "blocked")]), mockTheme() as any, () => {});
    dlg.handleInput("j"); // phase → task
    dlg.handleInput("\r");
    const detail = dlg.render(100).join("\n");
    expect(detail).toContain("task #2 · 修复回归");
    expect(detail).toContain("状态：blocked");
    expect(detail).toContain("所在 phase：#1 实现");
    expect(detail).toContain("复现后只修根因，不改无关断言");
    expect(detail).toContain("依赖：#1");
    expect(detail).toContain("证据：bun test test/regression.test.ts");
    expect(detail).toContain("阻塞原因：依赖 task #1");
  });

  test("详情页独立滚动，Ctrl+C 直接关闭", () => {
    let doneCount = 0;
    const task = t(1, "长说明", "in_progress", { description: "说明内容".repeat(300) });
    const dlg = new PlanStatusDialog(goal([p(1, "实现", [task], "in_progress")]), mockTheme() as any, () => { doneCount += 1; });
    dlg.handleInput("j");
    dlg.handleInput("\r");
    const first = dlg.render(40).at(-2)!;
    dlg.handleInput("j");
    const second = dlg.render(40).at(-2)!;
    expect(first).not.toBe(second);
    expect(second).toContain("2-21");
    dlg.handleInput("\u0003");
    expect(doneCount).toBe(1);
  });
});

// =============================================================================
// Focusable / Component 接口契约
// =============================================================================

describe("PlanStatusDialog 契约", () => {
  test("实现 Component（render + invalidate + handleInput 都存在）", () => {
    const dlg = new PlanStatusDialog(goal([p(1, "p1", [], "in_progress")]), mockTheme() as any, () => {});
    expect(typeof dlg.render).toBe("function");
    expect(typeof dlg.invalidate).toBe("function");
    expect(typeof dlg.handleInput).toBe("function");
  });

  test("实现 Focusable（focused 字段在）", () => {
    const dlg = new PlanStatusDialog(goal([p(1, "p1", [], "in_progress")]), mockTheme() as any, () => {});
    expect("focused" in dlg).toBe(true);
  });
});

// =============================================================================
// 换行行为（ADR 0008/0009 modal）
// =============================================================================

describe("PlanStatusDialog.render 换行", () => {
  // mockTheme 把颜色包成可见标签，会显著增加 visibleWidth；用 width 80 保证短内容不换行，
  // 只让故意加长内容触发换行。

  test("长 heading objective 超出宽度时自动换行", () => {
    const longObjective = "o".repeat(120);
    const g = goal([p(1, "p1", [], "in_progress")], { objective: longObjective });
    const dlg = new PlanStatusDialog(g, mockTheme() as any, () => {});
    const lines = dlg.render(80);
    const headingLines = lines.slice(1, lines.length - 3); // 上边框之后到底边框之前的前段
    // 找第一个 phase 行作为 body 起点；heading 区块在其前
    const firstPhaseIdx = lines.findIndex((l) => l.includes("├─"));
    expect(firstPhaseIdx).toBeGreaterThan(1);
    expect(lines.slice(1, firstPhaseIdx).length).toBeGreaterThan(1);
    // 所有 o 字符都应出现
    const oCount = lines.join("").split("o").length - 1;
    expect(oCount).toBeGreaterThanOrEqual(longObjective.length);
  });

  test("长 phase subject 超出宽度时自动换行，续行与内容对齐", () => {
    const longSubject = "a".repeat(100);
    const g = goal([p(1, longSubject, [], "in_progress")]);
    const dlg = new PlanStatusDialog(g, mockTheme() as any, () => {});
    const lines = dlg.render(80);
    const phaseStart = lines.findIndex((line) => line.includes("├─ ◐"));
    const body = lines.slice(phaseStart, -2);
    expect(body.length).toBeGreaterThan(1);
    // 首行含树形前缀 + 状态字符；mock theme 标签可能在前
    expect(body[0]).toContain("├─ ◐");
    // 续行按选中标记 + 树形前缀对齐。
    for (let i = 1; i < body.length; i++) {
      expect(body[i]).toMatch(/^ {7}\S/);
    }
    // 所有 a 字符都应出现在 body 里
    const aCount = body.join("").split("a").length - 1;
    expect(aCount).toBeGreaterThanOrEqual(longSubject.length);
  });

  test("长 task subject 超出宽度时自动换行，续行与内容对齐", () => {
    const longSubject = "b".repeat(100);
    const g = goal([p(1, "p1", [t(1, longSubject, "in_progress")], "in_progress")]);
    const dlg = new PlanStatusDialog(g, mockTheme() as any, () => {});
    const lines = dlg.render(80);
    const body = lines.slice(2, -2);
    const taskStart = body.findIndex((l) => l.includes("│"));
    // task 块 = 首行 + 后续 8 空格缩进的续行/结束标签
    let taskEnd = taskStart + 1;
    while (taskEnd < body.length && body[taskEnd].startsWith("        ")) {
      taskEnd++;
    }
    const taskLines = body.slice(taskStart, taskEnd);
    expect(taskLines.length).toBeGreaterThan(1);
    // 首行含 task 树形前缀 + 状态字符
    expect(taskLines[0]).toContain("│    ◐");
    // 续行按两列选中槽位 + task 树形前缀对齐。
    for (let i = 1; i < taskLines.length; i++) {
      expect(taskLines[i]).toMatch(/^ {9}\S/);
    }
    // 所有 b 字符都应出现在 task 行里
    const bCount = taskLines.join("").split("b").length - 1;
    expect(bCount).toBe(longSubject.length);
  });

  test("done task 删除线 ANSI 跨换行保留", () => {
    const longSubject = "c".repeat(80);
    const g = goal([p(1, "p1", [t(1, longSubject, "done")], "done")]);
    const dlg = new PlanStatusDialog(g, mockTheme() as any, () => {});
    const lines = dlg.render(80);
    const body = lines.slice(2, -2);
    const taskStart = body.findIndex((l) => l.includes("│"));
    let taskEnd = taskStart + 1;
    while (taskEnd < body.length && body[taskEnd].startsWith("        ")) {
      taskEnd++;
    }
    const taskLines = body.slice(taskStart, taskEnd);
    const joined = taskLines.join("\n");
    expect(joined).toContain("\u001b[9m");
    expect(joined).toContain("\u001b[29m");
    // 所有 c 字符都应出现在 task 行里（避免 mock theme <accent> 里的 c 干扰）
    const cCount = joined.split("c").length - 1;
    expect(cCount).toBe(longSubject.length);
  });

  test("换行后 j 仍按逻辑 item 选择，不落到续行", () => {
    const longSubject = "x".repeat(100);
    const phases = [p(1, "p1", [t(1, longSubject, "pending")], "pending")];
    const dlg = new PlanStatusDialog(goal(phases), mockTheme() as any, () => {});
    expect(dlg.render(80).find((line) => line.includes("› "))).toContain("p1");
    dlg.handleInput("j");
    const rendered = dlg.render(80);
    const selectedIndex = rendered.findIndex((line) => line.includes("› "));
    expect(rendered[selectedIndex]).toContain("│    ○");
    expect(rendered.slice(selectedIndex, -2).join("")).toContain("x");
  });

  test("elapsed 每秒更新时 heading 变、body 不变", () => {
    const realNow = Date.now;
    const baseTime = realNow();
    Date.now = () => baseTime;
    try {
      const longSubject = "y".repeat(100);
      const g = goal([p(1, "p1", [t(1, longSubject, "in_progress")], "in_progress")]);
      const dlg = new PlanStatusDialog(g, mockTheme() as any, () => {});
      const first = dlg.render(80);
      const firstBody = first.slice(2, -2).join("\n");

      // 推进 2 秒
      Date.now = () => baseTime + 2_000;
      const second = dlg.render(80);
      const secondBody = second.slice(2, -2).join("\n");

      // heading 的 elapsed 应变化
      expect(second[1]).not.toBe(first[1]);
      // body 内容应保持不变（wrappedBody 按 width 缓存，不随 elapsed 重算）
      expect(secondBody).toBe(firstBody);
    } finally {
      Date.now = realNow;
    }
  });
});
