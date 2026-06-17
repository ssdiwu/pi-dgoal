// 切片 1：Task Plan 数据模型 + 持久化往返 + 向后兼容
// 见 doc/40-版本实施方案/41-v0.2.0-TaskPlan与建检循环实施方案.md
import { describe, expect, test } from "bun:test";

import {
  __resetGoalForTest,
  __setApiForTest,
  isLoopGoal,
  loadGoal,
  persistGoal,
  type LoopGoal,
  type Phase,
  type Task,
  type TaskPlan,
} from "../index.ts";

// 构造一个带 plan 的 goal（0.2.0 形态）
function makeGoalWithPlan(overrides: Partial<LoopGoal> = {}): LoopGoal {
  const task: Task = {
    id: 1,
    subject: "修登录测试",
    activeForm: "正在修登录测试",
    status: "in_progress",
    evidence: "npm test auth 全过",
  };
  const phase: Phase = {
    id: 1,
    subject: "修复 auth 模块",
    status: "in_progress",
    tasks: [task],
  };
  const plan: TaskPlan = { phases: [phase], nextId: 2 };
  return {
    id: "goal-1",
    objective: "修好测试",
    status: "active",
    startedAt: 1000,
    updatedAt: 2000,
    iteration: 3,
    plan,
    verification: "全量测试通过",
    ...overrides,
  };
}

// 构造一个旧形态 goal（0.1.x，无 plan/verification/pauseReason/rejectedCount）
function makeLegacyGoal(): LoopGoal {
  return {
    id: "legacy-1",
    objective: "旧目标",
    status: "active",
    startedAt: 1000,
    updatedAt: 2000,
    iteration: 1,
    contextSummary: "旧背景",
  };
}

// mock ctx：getBranch 返回给定 entries
function makeCtx(entries: Array<{ type?: string; customType?: string; data?: unknown }>) {
  return {
    cwd: "/tmp",
    ui: {
      confirm: async () => true,
      notify: () => {},
      setStatus: () => {},
    },
    sessionManager: { getBranch: () => entries },
  };
}

describe("切片1 · isLoopGoal 向后兼容", () => {
  test("接受 0.2.0 带 plan 的 goal", () => {
    expect(isLoopGoal(makeGoalWithPlan())).toBe(true);
  });

  test("接受 0.1.x 旧 goal（无 plan 字段）", () => {
    expect(isLoopGoal(makeLegacyGoal())).toBe(true);
  });

  test("拒绝缺少必填字段的值", () => {
    expect(isLoopGoal(null)).toBe(false);
    expect(isLoopGoal({ id: "x" })).toBe(false);
    expect(isLoopGoal({ id: "x", objective: "o", status: "active", startedAt: 1 })).toBe(false);
  });

  test("plan 内部结构不进 isLoopGoal 硬校验（由 reducer 保证）", () => {
    // 即便 plan 内部是脏数据，isLoopGoal 仍只校验 goal 顶层必填字段
    const goal = makeGoalWithPlan({ plan: { phases: [], nextId: 1 } as TaskPlan });
    expect(isLoopGoal(goal)).toBe(true);
  });
});

describe("切片1 · persist/load 往返", () => {
  test("带 plan 的 goal persist 后 load 能完整恢复三层", () => {
    __resetGoalForTest();
    let captured: { type: string; data: { goal: LoopGoal | null } } | undefined;
    __setApiForTest({
      appendEntry: (type, data) => {
        captured = { type, data: data as { goal: LoopGoal | null } };
      },
    });

    const original = makeGoalWithPlan();
    persistGoal(original);

    // persistGoal 写入 captured
    expect(captured?.type).toBe("dgoal-state");
    expect(captured?.data.goal).not.toBeNull();

    // 用写入的 entry 构造 ctx，loadGoal 应恢复完整 plan
    const ctx = makeCtx([
      { type: "custom", customType: "dgoal-state", data: captured!.data },
    ]);
    const restored = loadGoal(ctx as never);

    expect(restored).not.toBeUndefined();
    expect(restored!.id).toBe("goal-1");
    expect(restored!.verification).toBe("全量测试通过");
    expect(restored!.plan).toBeDefined();
    expect(restored!.plan!.phases).toHaveLength(1);
    expect(restored!.plan!.phases[0].subject).toBe("修复 auth 模块");
    expect(restored!.plan!.phases[0].tasks).toHaveLength(1);
    expect(restored!.plan!.phases[0].tasks[0].subject).toBe("修登录测试");
    expect(restored!.plan!.phases[0].tasks[0].evidence).toBe("npm test auth 全过");
    expect(restored!.plan!.nextId).toBe(2);
  });

  test("persistGoal(null) 写入空 goal，loadGoal 返回 undefined", () => {
    __resetGoalForTest();
    let captured: { goal: LoopGoal | null } | undefined;
    __setApiForTest({
      appendEntry: (_type, data) => {
        captured = data as { goal: LoopGoal | null };
      },
    });

    persistGoal(null);
    expect(captured!.goal).toBeNull();

    const ctx = makeCtx([{ type: "custom", customType: "dgoal-state", data: captured! }]);
    expect(loadGoal(ctx as never)).toBeUndefined();
  });
});

describe("切片1 · 旧 entry 向后兼容", () => {
  test("0.1.x entry（无 plan/verification/pauseReason/rejectedCount）仍可 loadGoal", () => {
    const legacy = makeLegacyGoal();
    const ctx = makeCtx([
      { type: "custom", customType: "dgoal-state", data: { goal: legacy } },
    ]);
    const restored = loadGoal(ctx as never);

    expect(restored).not.toBeUndefined();
    expect(restored!.id).toBe("legacy-1");
    expect(restored!.objective).toBe("旧目标");
    expect(restored!.contextSummary).toBe("旧背景");
    // 0.2.0 字段在旧 entry 上不存在
    expect(restored!.plan).toBeUndefined();
    expect(restored!.verification).toBeUndefined();
  });

  test("complete/pending 状态的 goal 不被 loadGoal 恢复（沿用 0.1.x 行为）", () => {
    const completed = makeGoalWithPlan({ status: "complete" });
    const pending = makeGoalWithPlan({ status: "pending", id: "p-1" });
    const ctx = makeCtx([
      { type: "custom", customType: "dgoal-state", data: { goal: completed } },
      { type: "custom", customType: "dgoal-state", data: { goal: pending } },
    ]);
    // last-write-wins 取最后一条（pending），但 pending 被过滤 → undefined
    expect(loadGoal(ctx as never)).toBeUndefined();
  });

  test("非 dgoal-state customType 的 entry 被忽略", () => {
    const goal = makeGoalWithPlan();
    const ctx = makeCtx([
      { type: "custom", customType: "other-type", data: { goal } },
      { type: "message", message: { role: "user" } },
    ]);
    expect(loadGoal(ctx as never)).toBeUndefined();
  });
});

describe("切片1 · 三层内容数据结构", () => {
  test("Task 支持 blockedBy 依赖图（涌现分解）", () => {
    const t1: Task = { id: 1, subject: "A", status: "completed" };
    const t2: Task = { id: 2, subject: "B", status: "in_progress", blockedBy: [1] };
    const t3: Task = {
      id: 3,
      subject: "B回归",
      status: "pending",
      blockedBy: [2],
      blockedReason: undefined,
    };
    const phase: Phase = {
      id: 1,
      subject: "阶段",
      status: "in_progress",
      tasks: [t1, t2, t3],
    };
    const plan: TaskPlan = { phases: [phase], nextId: 4 };
    const goal = makeGoalWithPlan({ plan });
    expect(isLoopGoal(goal)).toBe(true);
    expect(goal.plan!.phases[0].tasks[2].blockedBy).toEqual([2]);
  });

  test("Task blocked 带 reason，evidence 为可复验形态", () => {
    const task: Task = {
      id: 1,
      subject: "需外部权限",
      status: "blocked",
      blockedReason: "缺 prod token",
      evidence: undefined,
    };
    const phase: Phase = { id: 1, subject: "p", status: "blocked", tasks: [task] };
    const goal = makeGoalWithPlan({ plan: { phases: [phase], nextId: 2 } });
    expect(goal.plan!.phases[0].tasks[0].blockedReason).toBe("缺 prod token");
  });
});
