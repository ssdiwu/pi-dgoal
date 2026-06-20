import { describe, expect, test } from "bun:test";

import {
  __resetGoalForTest,
  __setGoalForTest,
  __showStatusForTest,
  PlanStatusDialog,
  type LoopGoal,
  type Phase,
  type TaskPlan,
} from "../index.ts";

function goal(phases: Phase[] = []): LoopGoal {
  return {
    id: "g-show-status",
    objective: "实施 v0.4.2",
    status: "active",
    startedAt: 1,
    updatedAt: 1,
    iteration: 3,
    plan: { phases, nextId: 100 } as TaskPlan,
  };
}

function makeCtx(mode = "tui") {
  const calls = {
    setStatus: [] as Array<[string, string | undefined]>,
    notify: [] as Array<[string, string]>,
    custom: [] as Array<unknown[]>,
  };
  const ctx = {
    mode,
    ui: {
      setStatus: (key: string, value: string | undefined) => calls.setStatus.push([key, value]),
      notify: (message: string, level: string) => calls.notify.push([message, level]),
      custom: (...args: unknown[]) => {
        calls.custom.push(args);
        return Promise.resolve();
      },
    },
  } as any;
  return { ctx, calls };
}

describe("showStatus 回归", () => {
  test("无 currentGoal：TUI 模式清空状态栏并展示空状态 modal", async () => {
    __resetGoalForTest();
    const { ctx, calls } = makeCtx();

    __showStatusForTest(ctx);
    await Promise.resolve();

    expect(calls.setStatus).toEqual([["dgoal", undefined]]);
    expect(calls.notify).toHaveLength(0);
    expect(calls.custom).toHaveLength(1);
    const [factory, options] = calls.custom[0] as [(...args: unknown[]) => PlanStatusDialog, any];
    expect(options.overlayOptions.anchor).toBe("top-center");
    const component = factory({}, { fg: (_c: string, s: string) => s, bold: (s: string) => s }, {}, () => {});
    const lines = component.render(80);
    expect(lines.join("\n")).toContain("当前没有进行中的 dgoal");
    expect(lines.join("\n")).toContain("/dgoal <goal>");
  });

  test("无 currentGoal：非 TUI 模式降级 notify no dgoal", () => {
    __resetGoalForTest();
    const { ctx, calls } = makeCtx("json");

    __showStatusForTest(ctx);

    expect(calls.setStatus).toEqual([["dgoal", undefined]]);
    expect(calls.custom).toHaveLength(0);
    expect(calls.notify).toHaveLength(1);
    expect(calls.notify[0][0]).toContain("当前没有进行中的 dgoal");
    expect(calls.notify[0][1]).toBe("info");
  });

  test("有 currentGoal：TUI 模式走 ctx.ui.custom + top-center overlay 配置", async () => {
    __setGoalForTest(goal([{ id: 1, subject: "phase", status: "in_progress", tasks: [] }] as Phase[]));
    const { ctx, calls } = makeCtx();

    __showStatusForTest(ctx);
    await Promise.resolve();

    expect(calls.custom).toHaveLength(1);
    const [factory, options] = calls.custom[0] as [(...args: unknown[]) => unknown, any];
    expect(options).toEqual({
      overlay: true,
      overlayOptions: {
        anchor: "top-center",
        width: "100%",
        maxHeight: "85%",
        margin: 1,
      },
    });
    const component = factory({}, { fg: (_c: string, s: string) => s, bold: (s: string) => s }, {}, () => {});
    expect(component).toBeInstanceOf(PlanStatusDialog);
  });

  test("ctx.ui.custom 同步 throw：showStatus 自己吞掉并回退 notify", () => {
    __setGoalForTest(goal([{ id: 1, subject: "phase", status: "in_progress", tasks: [] }] as Phase[]));
    const { ctx, calls } = makeCtx();
    ctx.ui.custom = () => {
      throw new Error("sync boom");
    };

    const errors: unknown[][] = [];
    const realError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    try {
      expect(() => __showStatusForTest(ctx)).not.toThrow();
      expect(errors).toHaveLength(1);
      expect(String(errors[0][0])).toContain("[dgoal] /dgoal s modal failed:");
      expect(String(errors[0][1])).toContain("sync boom");
      expect(calls.notify).toHaveLength(1);
      expect(calls.notify[0][0]).toContain("目标：实施 v0.4.2");
      expect(calls.notify[0][1]).toBe("info");
    } finally {
      console.error = realError;
    }
  });

  test("ctx.ui.custom Promise reject：showStatus 不向上抛并回退 notify", async () => {
    __setGoalForTest(goal([{ id: 1, subject: "phase", status: "in_progress", tasks: [] }] as Phase[]));
    const { ctx, calls } = makeCtx();
    ctx.ui.custom = () => Promise.reject(new Error("async boom"));

    const errors: unknown[][] = [];
    const realError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    try {
      expect(() => __showStatusForTest(ctx)).not.toThrow();
      await Promise.resolve();
      await Promise.resolve();
      expect(errors).toHaveLength(1);
      expect(String(errors[0][0])).toContain("[dgoal] /dgoal s modal failed:");
      expect(String(errors[0][1])).toContain("async boom");
      expect(calls.notify).toHaveLength(1);
      expect(calls.notify[0][0]).toContain("目标：实施 v0.4.2");
      expect(calls.notify[0][1]).toBe("info");
    } finally {
      console.error = realError;
    }
  });
});
