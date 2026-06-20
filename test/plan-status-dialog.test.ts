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
    expect(lines.at(-1)).toContain("╰─");
  });

  test("empty phases → 带边框的 fallback 状态", () => {
    const dlg = new PlanStatusDialog(goal([]), mockTheme() as any, () => {});
    const lines = dlg.render(80);
    expect(lines[0]).toContain("╭─");
    expect(lines.join("\n")).toContain("无 plan");
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
