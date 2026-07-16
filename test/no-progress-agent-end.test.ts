// 验收 1 集成测试：真实注册的事件链（before_agent_start → tool_call/tool_execution_start → agent_end）。
// 用 mock Pi 捕获 dgoal() 注册的事件回调，手动触发，验证无进展熔断在完整事件链下成立。
import { beforeEach, describe, expect, test } from "bun:test";

import dgoal, {
  __clearActiveGoalForTest,
  __finalizeGoalForTest,
  __getGoalForTest,
  __getRuntimeStateForTest,
  __resetGoalForTest,
  __setGoalForTest,
  __setRuntimeStateForTest,
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

function makePausedTaskPlanAfterModelError(): GoalState {
  return {
    ...makeActiveGoal(),
    planType: "task",
    status: "paused",
    pauseReason: "model_error",
  };
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

  test("input 事件只把真实用户的明确 dgoal 指令记为一次性授权", async () => {
    handlers["input"]({ source: "extension", text: "请用 dgoal 完成任务" });
    expect(__getRuntimeStateForTest().naturalLanguageStartAuthorized).toBe(false);
    handlers["input"]({ source: "unknown", text: "请用 dgoal 完成任务" });
    expect(__getRuntimeStateForTest().naturalLanguageStartAuthorized).toBe(false);
    handlers["input"]({ source: "interactive", streamingBehavior: "followUp", text: "请用 dgoal 完成任务" });
    expect(__getRuntimeStateForTest().naturalLanguageStartAuthorized).toBe(false);
    handlers["input"]({ source: "interactive", text: "你可以用 dgoal 和 dteam 自己处理掉" });
    expect(__getRuntimeStateForTest().naturalLanguageStartAuthorized).toBe(true);
    expect(__getRuntimeStateForTest().naturalLanguageStartInput).toBe("你可以用 dgoal 和 dteam 自己处理掉");
    const guided = await handlers["before_agent_start"]({ prompt: "你可以用 dgoal 和 dteam 自己处理掉", systemPrompt: "base" }, mockCtx()) as { systemPrompt?: string };
    expect(guided.systemPrompt).toContain("<dgoal_natural_language_start>");
    handlers["input"]({ source: "extension", text: "你可以用 dgoal 和 dteam 自己处理掉" });
    expect(__getRuntimeStateForTest().naturalLanguageStartAuthorized).toBe(false);
    handlers["input"]({ source: "interactive", text: "你可以用 dgoal 和 dteam 自己处理掉" });
    await handlers["before_agent_start"]({ prompt: "已被其它扩展改写成普通问题", systemPrompt: "" }, mockCtx());
    expect(__getRuntimeStateForTest().naturalLanguageStartAuthorized).toBe(false);
    expect(__getRuntimeStateForTest().naturalLanguageStartInput).toBeUndefined();
    handlers["input"]({ source: "interactive", text: "dgoal 是什么？" });
    expect(__getRuntimeStateForTest().naturalLanguageStartAuthorized).toBe(false);
    handlers["input"]({ source: "rpc", text: "请用 dgoal 完成任务" });
    expect(__getRuntimeStateForTest().naturalLanguageStartAuthorized).toBe(true);
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

  test("用户中断显式 Goal Plan 仍写 user_abort，不覆盖为 no_progress", async () => {
    __setGoalForTest(makeActiveGoal());
    const ctx = mockCtx();

    await runTurn(handlers, ctx, { stopReason: "aborted" });
    expect(__getGoalForTest()?.budgetUsage?.turns).toBeUndefined();
    expect(__getGoalForTest()?.status).toBe("paused");
    expect(__getGoalForTest()?.pauseReason).toBe("user_abort");
  });

  test("用户中断 Task Plan 不暂停，下一轮仍注入当前 Plan", async () => {
    __setGoalForTest({ ...makeActiveGoal(), planType: "task" });
    const ctx = mockCtx();

    await runTurn(handlers, ctx, { stopReason: "aborted" });

    expect(__getGoalForTest()).toMatchObject({ status: "active", planType: "task" });
    expect(__getGoalForTest()?.pauseReason).toBeUndefined();
    const guided = await handlers["before_agent_start"]({ prompt: "继续处理", systemPrompt: "base" }, ctx) as { systemPrompt?: string };
    expect(guided.systemPrompt).toContain("<dgoal_goal>");
    expect(guided.systemPrompt).toContain("当前是 Task Plan");
  });

  test("第 5 次连续模型错误才暂停，且暂停清理 pendingProposal、通知只报告实际 4 次 retry", async () => {
    const notifications: string[] = [];
    const ctx = {
      ...mockCtx(),
      ui: { ...mockCtx().ui, notify: (message: string) => { notifications.push(message); } },
    } as DgoalContext;
    const goal = makeActiveGoal();
    __setGoalForTest(goal);
    __setRuntimeStateForTest({ pendingProposal: { goalId: goal.id, proposal: { objective: "stale" } as never } });

    for (let i = 0; i < 4; i += 1) await runTurn(handlers, ctx, { stopReason: "error" });
    expect(__getGoalForTest()?.status).toBe("active");
    await runTurn(handlers, ctx, { stopReason: "error" });
    expect(__getGoalForTest()?.status).toBe("paused");
    expect(__getGoalForTest()?.pauseReason).toBe("model_error");
    expect(__getRuntimeStateForTest().pendingProposal).toBeUndefined();
    expect(notifications.at(-1)).toContain("已重试 4 次");
  });

  test("成功工具推进重置连续模型错误，下一次错误从 1/5 重新计数", async () => {
    __setGoalForTest(makeActiveGoal());
    const ctx = mockCtx();
    await runTurn(handlers, ctx, { stopReason: "error" });
    await runTurn(handlers, ctx, { stopReason: "error" });
    expect(__getRuntimeStateForTest().consecutiveErrors).toBe(2);
    handlers["tool_execution_end"]({ toolCallId: "progress", toolName: "bash", args: {}, isError: false });
    expect(__getRuntimeStateForTest().consecutiveErrors).toBe(0);
    await runTurn(handlers, ctx, { stopReason: "error" });
    expect(__getRuntimeStateForTest().consecutiveErrors).toBe(1);
    expect(__getGoalForTest()?.status).toBe("active");
  });

  test("新的 agent turn 会清除 model_error 后过期的 Task Plan，并恢复轻量默认指引", async () => {
    __setGoalForTest(makePausedTaskPlanAfterModelError());
    const guided = await handlers["before_agent_start"]({ prompt: "处理另一件事", systemPrompt: "base" }, mockCtx()) as { systemPrompt?: string };
    expect(__getGoalForTest()).toBeUndefined();
    expect(guided.systemPrompt).toContain("<task_plan_default>");
    expect(guided.systemPrompt).not.toContain("<dgoal_goal>");
  });

  test("model_error 后的显式 Phase/Goal Plan 保持 paused，不会被新 turn 静默清除", async () => {
    __setGoalForTest({ ...makePausedTaskPlanAfterModelError(), planType: "goal" });
    await handlers["before_agent_start"]({ prompt: "处理另一件事", systemPrompt: "base" }, mockCtx());
    expect(__getGoalForTest()).toMatchObject({ status: "paused", pauseReason: "model_error", planType: "goal" });
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

  test("resyncGoalFromSession 清零错误与无进展计数，新 goal 不继承旧计数", async () => {
    __setGoalForTest(makeActiveGoal());
    __setRuntimeStateForTest({ consecutiveErrors: 4 });
    const ctx = mockCtx();
    // 累计 2 轮无进展
    await runTurn(handlers, ctx);
    await runTurn(handlers, ctx);
    expect(__getGoalForTest()?.status).toBe("active");

    // 模拟 session 切换：resyncGoalFromSession 应清零计数。
    const emptyCtx = { sessionManager: { getBranch: () => [] }, cwd: "/tmp", ui: { setStatus: () => {}, notify: () => {} } } as unknown as DgoalContext;
    resyncGoalFromSession(emptyCtx);
    expect(__getGoalForTest()).toBeUndefined();
    expect(__getRuntimeStateForTest().consecutiveErrors).toBe(0);

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
