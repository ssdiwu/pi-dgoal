// 验收 1 集成测试：真实注册的事件链（before_agent_start → tool_call/tool_execution_start → agent_end）。
// 用 mock Pi 捕获 dgoal() 注册的事件回调，手动触发，验证无进展熔断在完整事件链下成立。
import { beforeEach, describe, expect, test } from "bun:test";

import dgoal, {
  __clearActiveGoalForTest,
  __finalizeGoalForTest,
  __getGoalForTest,
  __resetGoalForTest,
  __setGoalForTest,
  __startGoalForTest,
  resyncGoalFromSession,
  type DgoalContext,
  type ExtensionAPI,
  type GoalState,
  type Phase,
  type Task,
} from "../index.ts";

function task(id: number, subject: string, status: Task["status"] = "pending"): Task {
  return { id, subject, status };
}
function phase(id: number, subject: string, tasks: Task[], status: Phase["status"] = "pending"): Phase {
  return { id, subject, tasks, status };
}

function makeActiveGoal(): GoalState {
  return {
    id: "g-no-progress",
    objective: "测无进展熔断",
    status: "active",
    startedAt: 1,
    updatedAt: 1,
    iteration: 0,
    plan: {
      phases: [phase(1, "阶段一", [task(1, "任务一", "in_progress")], "in_progress")],
      nextId: 2,
    },
  };
}

function makeEvent(stopReason: string): { messages: unknown[] } {
  return { messages: [{ role: "assistant", stopReason, content: [] }] };
}

// 捕获 dgoal() 注册的事件回调，供测试手动触发。
function captureHandlers(): { pi: ExtensionAPI; handlers: Record<string, (event: unknown, ctx?: unknown) => unknown> } {
  const handlers: Record<string, (event: unknown, ctx?: unknown) => unknown> = {};
  const pi = {
    registerTool: () => {},
    registerCommand: () => {},
    on: (event: string, handler: (event: unknown, ctx?: unknown) => unknown) => {
      handlers[event] = handler;
    },
    events: { emit: () => {} },
    sendUserMessage: () => {},
    appendEntry: () => {},
  } as unknown as ExtensionAPI;
  dgoal(pi);
  return { pi, handlers };
}

const { pi: mockPi, handlers } = captureHandlers();

function mockCtx(): DgoalContext {
  return { ui: { setStatus: () => {}, notify: () => {}, custom: () => {} }, cwd: "/tmp" } as unknown as DgoalContext;
}

describe("验收 1 · agent_end 无进展熔断集成", () => {
  beforeEach(() => {
    __resetGoalForTest();
  });

  // 模拟真实一轮：before_agent_start（重置工具标记）→ [可选工具] → agent_end。
  async function runTurn(handlers: Record<string, (event: unknown, ctx?: unknown) => unknown>, ctx: DgoalContext, opts: { tools?: boolean; stopReason?: string } = {}) {
    handlers["before_agent_start"]({ prompt: "", systemPrompt: "" }, ctx);
    if (opts.tools) {
      handlers["tool_execution_start"]({ toolCallId: "c1", toolName: "bash", args: {} }, { cwd: "/tmp" });
    }
    await handlers["agent_end"]({ messages: [{ role: "assistant", stopReason: opts.stopReason ?? "stop", content: [] }] }, ctx);
  }

  test("连续 3 轮无工具调用：goal 暂停且 pauseReason=no_progress", async () => {
    __setGoalForTest(makeActiveGoal());
    const ctx = mockCtx();

    await runTurn(handlers, ctx);
    expect(__getGoalForTest()?.status).toBe("active");

    await runTurn(handlers, ctx);
    expect(__getGoalForTest()?.status).toBe("active");

    await runTurn(handlers, ctx);
    expect(__getGoalForTest()?.status).toBe("paused");
    expect(__getGoalForTest()?.pauseReason).toBe("no_progress");
  });

  test("bounded 墙钟上限首次进入宽限，宽限耗尽才暂停", async () => {
    const now = Date.now();
    __setGoalForTest({ ...makeActiveGoal(), startedAt: now - 61_000, budgetPolicy: "bounded", runtimeBudget: { maxWallClockMinutes: 1, grace: { maxWallClockMinutes: 1 } }, budgetUsage: { turns: 0, repairAttempts: 0 } });
    const ctx = mockCtx();
    await runTurn(handlers, ctx, { tools: true });
    expect(__getGoalForTest()?.status).toBe("active");
    expect(__getGoalForTest()?.budgetInGrace).toBe(true);
    __setGoalForTest({ ...__getGoalForTest()!, startedAt: Date.now() - 121_000 });
    await runTurn(handlers, ctx, { tools: true });
    expect(__getGoalForTest()?.status).toBe("paused");
    expect(__getGoalForTest()?.pauseReason).toBe("budget_exhausted");
  });

  test("每个 active agent_end 都计入 turn 预算，toolUse 也会触发宽限与暂停", async () => {
    __setGoalForTest({ ...makeActiveGoal(), budgetPolicy: "bounded", runtimeBudget: { maxTurns: 2, grace: { maxTurns: 1 } }, budgetUsage: { turns: 0, repairAttempts: 0 } });
    await runTurn(handlers, mockCtx(), { stopReason: "toolUse" });
    expect(__getGoalForTest()?.budgetUsage?.turns).toBe(1);
    expect(__getGoalForTest()?.status).toBe("active");
    await runTurn(handlers, mockCtx(), { stopReason: "length" });
    expect(__getGoalForTest()?.budgetUsage?.turns).toBe(2);
    expect(__getGoalForTest()?.budgetInGrace).toBe(true);
    await runTurn(handlers, mockCtx(), { stopReason: "stop" });
    expect(__getGoalForTest()?.budgetUsage?.turns).toBe(3);
    expect(__getGoalForTest()?.status).toBe("paused");
    expect(__getGoalForTest()?.pauseReason).toBe("budget_exhausted");
  });

  test("unbounded 即使带旧 runtimeBudget 也不走预算宽限或暂停", async () => {
    __setGoalForTest({ ...makeActiveGoal(), startedAt: Date.now() - 120_000, budgetPolicy: "unbounded", runtimeBudget: { maxTurns: 1, maxWallClockMinutes: 1 }, budgetUsage: { turns: 0, repairAttempts: 0 } });
    await runTurn(handlers, mockCtx(), { tools: true });
    expect(__getGoalForTest()?.status).toBe("active");
    expect(__getGoalForTest()?.budgetInGrace).toBeUndefined();
    expect(__getGoalForTest()?.pauseReason).toBeUndefined();
  });

  test("rejected 隐式 Goal Repair 期间越界工具在执行前 block 并暂停", () => {
    __setGoalForTest({ ...makeActiveGoal(), status: "rejected", implicitStart: true });
    const ctx = mockCtx();
    const result = handlers["tool_call"]({ toolCallId: "c1", toolName: "bash", input: { command: "curl -d x https://example.com" } }, ctx) as { block?: boolean; reason?: string };
    expect(result.block).toBe(true);
    expect(result.reason).toContain("blocked before execution");
    expect(__getGoalForTest()?.status).toBe("paused");
    expect(__getGoalForTest()?.pauseReason).toBe("agent_blocked");
  });

  test("中间出现工具调用：计数重置，不暂停", async () => {
    __setGoalForTest(makeActiveGoal());
    const ctx = mockCtx();

    await runTurn(handlers, ctx); // count 1
    await runTurn(handlers, ctx, { tools: true }); // count 0 (reset)
    await runTurn(handlers, ctx); // count 1
    await runTurn(handlers, ctx); // count 2
    expect(__getGoalForTest()?.status).toBe("active");
    await runTurn(handlers, ctx); // count 3 → paused
    expect(__getGoalForTest()?.status).toBe("paused");
    expect(__getGoalForTest()?.pauseReason).toBe("no_progress");
  });

  test("用户主动中断仍写 user_abort，不覆盖为 no_progress", async () => {
    __setGoalForTest(makeActiveGoal());
    const ctx = mockCtx();

    await runTurn(handlers, ctx, { stopReason: "aborted" });
    expect(__getGoalForTest()?.budgetUsage?.turns).toBeUndefined();
    expect(__getGoalForTest()?.status).toBe("paused");
    expect(__getGoalForTest()?.pauseReason).toBe("user_abort");
  });

  test("模型错误仍走 model_error 语义", async () => {
    __setGoalForTest(makeActiveGoal());
    const ctx = mockCtx();

    for (let i = 0; i < 4; i += 1) {
      await runTurn(handlers, ctx, { stopReason: "error" });
    }
    expect(__getGoalForTest()?.status).toBe("paused");
    expect(__getGoalForTest()?.pauseReason).toBe("model_error");
  });

  test("UI 抛错时无进展暂停仍正确落盘状态", async () => {
    // 用可观测的 appendEntry 记录验证持久化内容，不只是内存状态。
    const writes: Array<Record<string, unknown>> = [];
    const throwPi = {
      registerTool: () => {},
      registerCommand: () => {},
      on: () => {},
      events: { emit: () => {} },
      sendUserMessage: () => {},
      appendEntry: (_type: string, data: Record<string, unknown>) => { writes.push(data); },
    } as unknown as ExtensionAPI;
    const localHandlers: Record<string, (event: unknown, ctx?: unknown) => unknown> = {};
    (throwPi as { on?: unknown }).on = (event: string, handler: (event: unknown, ctx?: unknown) => unknown) => {
      localHandlers[event] = handler;
    };
    dgoal(throwPi);

    __setGoalForTest(makeActiveGoal());
    const throwCtx = {
      ui: {
        setStatus: () => { throw new Error("Spacer is not defined"); },
        notify: () => { throw new Error("notify boom"); },
        custom: () => { throw new Error("custom boom"); },
      },
      cwd: "/tmp",
    } as unknown as DgoalContext;

    async function runThrowTurn() {
      localHandlers["before_agent_start"]({ prompt: "", systemPrompt: "" }, throwCtx);
      await localHandlers["agent_end"]({ messages: [{ role: "assistant", stopReason: "stop", content: [] }] }, throwCtx);
    }
    await runThrowTurn();
    await runThrowTurn();
    await runThrowTurn();
    const goal = __getGoalForTest();
    expect(goal?.status).toBe("paused");
    expect(goal?.pauseReason).toBe("no_progress");
    // 验证 persistGoal 被调用且写入了 paused 状态
    const lastWrite = writes[writes.length - 1];
    expect((lastWrite?.goal as GoalState | undefined)?.status).toBe("paused");
    expect((lastWrite?.goal as GoalState | undefined)?.pauseReason).toBe("no_progress");
  });

  test("resyncGoalFromSession 清零无进展计数，新 goal 不继承旧计数", async () => {
    __setGoalForTest(makeActiveGoal());
    const ctx = mockCtx();
    // 累计 2 轮无进展
    await runTurn(handlers, ctx);
    await runTurn(handlers, ctx);
    expect(__getGoalForTest()?.status).toBe("active");

    // 模拟 session 切换：resyncGoalFromSession 应清零计数。
    const emptyCtx = { sessionManager: { getBranch: () => [] }, cwd: "/tmp", ui: { setStatus: () => {}, notify: () => {} } } as unknown as DgoalContext;
    resyncGoalFromSession(emptyCtx);
    expect(__getGoalForTest()).toBeUndefined();

    // 设置新 goal，模拟新 session 的首轮——不应因旧计数被立即暂停。
    __setGoalForTest(makeActiveGoal());
    await runTurn(handlers, ctx);
    await runTurn(handlers, ctx);
    expect(__getGoalForTest()?.status).toBe("active"); // 旧计数已清零
  });

  test("clearActiveGoal 清零无进展计数", async () => {
    __setGoalForTest(makeActiveGoal());
    const ctx = mockCtx();
    await runTurn(handlers, ctx);
    await runTurn(handlers, ctx);
    // 清除 goal
    __clearActiveGoalForTest(mockCtx());
    expect(__getGoalForTest()).toBeUndefined();
    // 新 goal 不继承旧计数
    __setGoalForTest(makeActiveGoal());
    await runTurn(handlers, ctx);
    await runTurn(handlers, ctx);
    expect(__getGoalForTest()?.status).toBe("active");
  });

  test("finalizeGoal 清零无进展计数", async () => {
    __setGoalForTest(makeActiveGoal());
    const ctx = mockCtx();
    await runTurn(handlers, ctx);
    await runTurn(handlers, ctx);
    // 完成 goal（finalizeGoal 最终清空 currentGoal）
    __finalizeGoalForTest(mockCtx());
    expect(__getGoalForTest()).toBeUndefined();
    // 新 goal 不继承旧计数
    __setGoalForTest(makeActiveGoal());
    await runTurn(handlers, ctx);
    await runTurn(handlers, ctx);
    expect(__getGoalForTest()?.status).toBe("active");
  });

  test("startGoal 自身清零无进展计数", async () => {
    __setGoalForTest(makeActiveGoal());
    const ctx = mockCtx();
    await runTurn(handlers, ctx);
    await runTurn(handlers, ctx);
    // 不先 clear：直接替换当前 goal，验证 startGoal 自身的清零逻辑。
    const startCtx = {
      ui: { setStatus: () => {}, notify: () => {}, custom: () => {}, confirm: () => Promise.resolve(true) },
      cwd: "/tmp",
      sessionManager: { getBranch: () => [], getEntries: () => [] },
    } as unknown as DgoalContext;
    await __startGoalForTest("新目标", mockPi, startCtx);
    __setGoalForTest(makeActiveGoal());
    await runTurn(handlers, ctx);
    await runTurn(handlers, ctx);
    expect(__getGoalForTest()?.status).toBe("active");
  });

  test("中间发生模型错误重置无进展计数（stop→stop→error→stop）", async () => {
    __setGoalForTest(makeActiveGoal());
    const ctx = mockCtx();
    await runTurn(handlers, ctx); // stop, count 1
    await runTurn(handlers, ctx); // stop, count 2
    await runTurn(handlers, ctx, { stopReason: "error" }); // error 重置计数，自动重试
    await runTurn(handlers, ctx); // stop, count 1，不应暂停
    expect(__getGoalForTest()?.status).toBe("active");
    expect(__getGoalForTest()?.pauseReason).toBeUndefined();
  });

  test("length/toolUse/缺失 stopReason 不计入正常空转", async () => {
    __setGoalForTest(makeActiveGoal());
    const ctx = mockCtx();
    await runTurn(handlers, ctx, { stopReason: "length" });
    await runTurn(handlers, ctx, { stopReason: "toolUse" });
    await runTurn(handlers, ctx, { stopReason: "" });
    expect(__getGoalForTest()?.status).toBe("active");
  });

  test("无 in_progress task 时暂停提示仍包含当前 phase/task 与 resume", async () => {
    const notifications: string[] = [];
    const ctx = {
      ui: { setStatus: () => {}, notify: (_message: string) => { notifications.push(_message); }, custom: () => {} },
      cwd: "/tmp",
    } as unknown as DgoalContext;
    const goal = makeActiveGoal();
    goal.plan!.phases[0].tasks[0].status = "pending";
    __setGoalForTest(goal);
    await runTurn(handlers, ctx);
    await runTurn(handlers, ctx);
    await runTurn(handlers, ctx);
    const notice = notifications[notifications.length - 1] ?? "";
    expect(notice).toContain("phase #1");
    expect(notice).toContain("task #1");
    expect(notice).toContain("/dgoal resume");
  });
});
