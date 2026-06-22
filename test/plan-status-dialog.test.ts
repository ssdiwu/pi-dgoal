// 切片 4 验收：PlanStatusDialog Component 测试（render + handleInput + 边界 + 缓存）。
// 见 doc/40-版本实施方案/42-v0.4.2-dgoal-s-modal-实施方案.md 切片 4。
import { describe, expect, test } from "bun:test";

import {
  __setI18nForTest,
  PlanStatusDialog,
  type LoopGoal,
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
    startedAt: now - 5 * 60 * 1000,
    updatedAt: now - 5 * 60 * 1000,
    iteration: 0,
    plan: { phases, nextId: 100 } as TaskPlan,
    ...overrides,
  };
}

beforeAllSetI18n();

// =============================================================================
// render
// =============================================================================

describe("PlanStatusDialog.render", () => {
  test("返回完整 modal：边框 + heading + body + hint", () => {
    const g = goal([p(1, "p1", [], "in_progress")]);
    const dlg = new PlanStatusDialog(g, mockTheme() as any, () => {});
    const lines = dlg.render(80);
    // 期望：上边框(1) + heading(1) + body(1) + hint(1) + 下边框(1) = 5 行
    expect(lines.length).toBe(5);
    // 第一行 = 上边框 + 标题（mockTheme 包装为 <border>...<accent>...<bold>title</bold>...</accent>...</border>）
    expect(lines[0]).toContain("Dgoal 计划状态 — 顶部浮层");
    expect(lines[0]).toContain("╭─"); // 上边框起手
    expect(lines[0]).toContain("─╮"); // 上边框收尾
    // 第二行 = heading（钉顶，含 🎯）
    expect(lines[1]).toContain("🎯 实施 v0.4.2");
    expect(lines[1]).toContain("<accent>"); // accent 染色
    expect(lines[1]).toContain("<bold>"); // bold
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
      expect(lines[0]).not.toContain("Dgoal Plan Status — Top overlay");
    } finally {
      beforeAllSetI18n();
    }
  });

  test("短 plan 不显示滚动键，只显示关闭提示", () => {
    const dlg = new PlanStatusDialog(goal([p(1, "p1", [], "in_progress")]), mockTheme() as any, () => {});
    const lines = dlg.render(80);
    const hint = lines[lines.length - 2];
    expect(hint).toContain("ESC/Ctrl+C 关闭");
    expect(hint).not.toContain("↓/j");
    expect(hint).not.toContain("PgDn/PgUp");
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

  test("render 缓存命中：相同 (width, elapsedSec) 第二次返回 cached", () => {
    const g = goal([p(1, "p1", [], "in_progress")]);
    const dlg = new PlanStatusDialog(g, mockTheme() as any, () => {});
    const first = dlg.render(80);
    const second = dlg.render(80); // 同一秒
    expect(second).toBe(first); // === 引用相等表示缓存
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
    // 倒数第二行（hint 含新 offset 数字）应该变化
    expect(after[after.length - 2]).not.toBe(before[before.length - 2]); // hint 不同
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

  test("↓ → scroll +1（line 1 之后到 phase 行）", () => {
    const phases: Phase[] = [];
    for (let i = 1; i <= 25; i++) phases.push(p(i, `p${i}`, [], "pending"));
    const dlg = new PlanStatusDialog(goal(phases), mockTheme() as any, () => {});
    const first = dlg.render(80);
    dlg.handleInput("\u001b[B"); // down
    const second = dlg.render(80);
    // hint 行变化：lines N-M 数字
    expect(second[second.length - 2]).not.toBe(first[first.length - 2]);
  });

  test("j → scroll +1（vim）", () => {
    const phases: Phase[] = [];
    for (let i = 1; i <= 25; i++) phases.push(p(i, `p${i}`, [], "pending"));
    const dlg = new PlanStatusDialog(goal(phases), mockTheme() as any, () => {});
    const first = dlg.render(80);
    dlg.handleInput("j");
    const second = dlg.render(80);
    expect(second[second.length - 2]).not.toBe(first[first.length - 2]);
  });

  test("End/G → 跳到 maxOffset（25 phase / maxVisible 20 → end=5, lines 6-25）", () => {
    const phases: Phase[] = [];
    for (let i = 1; i <= 25; i++) phases.push(p(i, `p${i}`, [], "pending"));
    const dlg = new PlanStatusDialog(goal(phases), mockTheme() as any, () => {});
    dlg.handleInput("G");
    const lines = dlg.render(80);
    // 25 phase, maxVisible=20 → maxOffset=5 → 显示 lines 6-25
    expect(lines[lines.length - 2]).toContain(`6-25`);
  });

  test("Home/g → 跳到顶", () => {
    const phases: Phase[] = [];
    for (let i = 1; i <= 25; i++) phases.push(p(i, `p${i}`, [], "pending"));
    const dlg = new PlanStatusDialog(goal(phases), mockTheme() as any, () => {});
    dlg.handleInput("G");
    dlg.handleInput("g");
    const lines = dlg.render(80);
    expect(lines[lines.length - 2]).toContain(`1-`);
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
    const body = lines.slice(2, -2);
    expect(body.length).toBeGreaterThan(1);
    // 首行含树形前缀 + 状态字符；mock theme 标签可能在前
    expect(body[0]).toContain("├─ ◐");
    // 续行缩进 6 列（1 左内边距 + ├─ ○  共 5 列）
    for (let i = 1; i < body.length; i++) {
      expect(body[i]).toMatch(/^ {6}\S/);
    }
    // 所有 a 字符都应出现在 body 里
    const aCount = body.join("").split("a").length - 1;
    expect(aCount).toBe(longSubject.length);
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
    // 续行缩进 8 列（1 左内边距 + │    ○  共 7 列）
    for (let i = 1; i < taskLines.length; i++) {
      expect(taskLines[i]).toMatch(/^ {8}\S/);
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

  test("换行后按物理行滚动：j 下移到同一 task 的续行", () => {
    const longSubject = "x".repeat(100);
    const phases: Phase[] = [];
    for (let i = 1; i <= 10; i++) {
      phases.push(p(i, `p${i}`, [t(i, longSubject, "pending")], "pending"));
    }
    const dlg = new PlanStatusDialog(goal(phases), mockTheme() as any, () => {});
    const first = dlg.render(80);
    const firstBody = first.slice(2, -2);
    expect(firstBody.length).toBeGreaterThan(1);
    // 内容超过 20 行，应显示滚动提示
    expect(first[first.length - 2]).toContain("dgoal");

    dlg.handleInput("j");
    const second = dlg.render(80);
    const secondBody = second.slice(2, -2);

    // 按物理行滚动后，第二屏首行应是第一屏的第二行
    expect(secondBody[0]).toBe(firstBody[1]);
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
